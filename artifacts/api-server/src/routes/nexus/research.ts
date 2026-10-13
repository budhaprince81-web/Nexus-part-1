/**
 * NEXUS Research Agent
 * Performs deep research using Claude's knowledge base.
 * Provides structured summaries, key points, and actionable insights.
 * Supports standard and deep research modes.
 */
import { Router, type IRouter } from "express";
import { complete, hasConfiguredProvider, extractJson } from "../../ai/index.ts";
import { respondAiError } from "../ai-error.ts";
import { desc } from "drizzle-orm";
import { db, researchResults } from "@workspace/db";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";
import { markAgentActive, markAgentIdle } from "./agents";
import { formatUntrustedSources, isNewsConfigured, searchArticles, type NewsArticle } from "../../lib/news.ts";

const router: IRouter = Router();

const RESEARCH_PROMPTS: Record<string, string> = {
  quick: `Research this topic quickly. Give a 2-3 paragraph summary with 3-5 key points.`,
  standard: `Research this topic thoroughly. Provide:
- Comprehensive overview
- Current state of the field
- Key concepts and terminology
- Important insights and findings
- Practical applications
- 5-8 key points`,
  deep: `Conduct deep research on this topic. Provide:
- Detailed background and context
- Technical depth and nuance
- Multiple perspectives and viewpoints
- Current research and developments
- Limitations and open questions
- Expert-level insights
- 8-12 key points
- Practical recommendations`,
  expert: `Perform expert-level research analysis. Provide:
- Advanced technical analysis
- Critical evaluation of existing knowledge
- Identification of gaps and controversies
- Synthesis of multiple domains
- Future directions and implications
- 10-15 key points
- Actionable recommendations
- Potential risks and mitigation`,
};

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  summary: "Format as an accessible summary suitable for any audience.",
  report: "Format as a structured report with clear sections.",
  analysis: "Format as an analytical deep-dive with evidence and reasoning.",
  technical: "Format for a technical audience with precise terminology.",
};

// POST /nexus/research
router.post("/nexus/research", async (req, res): Promise<void> => {
  const { query, depth = "standard", format = "summary", language = "en" } = req.body || {};
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    res.status(400).json({ error: "query must be at least 3 characters" });
    return;
  }
  const resolvedDepth = ["quick", "standard", "deep", "expert"].includes(depth) ? depth : "standard";
  const resolvedFormat = ["summary", "report", "analysis", "technical"].includes(format) ? format : "summary";
  const resolvedLang = ["en", "ne"].includes(language) ? language : "en";
  if (!hasConfiguredProvider()) {
    res.status(503).json({
      error:
        "Research agent is unavailable: no AI provider is configured on the server. " +
        "Add ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or " +
        "OPENROUTER_API_KEY in Replit Secrets.",
      code: "no_provider_configured",
    });
    return;
  }

  markAgentActive("Research");

  try {
    const langInstruction = resolvedLang === "ne"
      ? "Respond in Nepali (नेपाली) language."
      : "Respond in English.";

    const systemPrompt = `You are NEXUS Research Agent — an expert researcher with knowledge across all fields.
Your research is accurate, well-structured, and actionable.
${langInstruction}
${FORMAT_INSTRUCTIONS[resolvedFormat]}

Always respond with valid JSON in this exact structure:
{
  "summary": "...comprehensive summary...",
  "keyPoints": ["point 1", "point 2", "..."],
  "sources": ["Source/Reference 1", "Source/Reference 2", "..."],
  "technicalDetails": "...for technical audiences...",
  "practicalApplications": "...how to apply this...",
  "relatedTopics": ["topic1", "topic2"]
}`;

    // --- Source grounding -------------------------------------------------
    // When a news provider is configured we retrieve *real* current articles
    // first and hand them to the model as explicitly untrusted source material.
    // The citations we return are then the real URLs, never model inventions.
    let grounding: {
      used: boolean;
      provider: string | null;
      fetchedAt: string | null;
      freshness: "delayed" | null;
      articleCount: number;
      note: string;
    } = {
      used: false,
      provider: null,
      fetchedAt: null,
      freshness: null,
      articleCount: 0,
      note: "No live source provider is configured, so this answer is model knowledge only.",
    };
    let groundedArticles: NewsArticle[] = [];
    let sourceBlock = "";

    if (isNewsConfigured()) {
      try {
        const retrieved = await searchArticles(query, { pageSize: resolvedDepth === "quick" ? 5 : 8, language: resolvedLang });
        groundedArticles = retrieved.articles;
        if (groundedArticles.length > 0) {
          sourceBlock = formatUntrustedSources(retrieved);
          grounding = {
            used: true,
            provider: retrieved.source,
            fetchedAt: retrieved.fetchedAt,
            freshness: retrieved.freshness,
            articleCount: groundedArticles.length,
            note:
              "Answer is grounded in the retrieved articles listed below. Article text is " +
              "third-party and may be incomplete, paywalled or inaccurate.",
          };
        } else {
          grounding.note = `No current articles matched this query on ${retrieved.source}.`;
        }
      } catch (err) {
        grounding.note = `Live source retrieval failed (${
          err instanceof Error ? err.name : "unknown"
        }), so this answer is model knowledge only.`;
        await logNexusEvent("warn", "Research source retrieval failed", "research", {
          code: err instanceof Error ? err.name : "unknown",
        });
      }
    }

    const userPrompt = [
      `Research Query: ${query}`,
      "",
      `Depth: ${resolvedDepth}`,
      RESEARCH_PROMPTS[resolvedDepth],
      sourceBlock
        ? `\n${sourceBlock}\n\nGround your answer in the source material above and cite its URLs. ` +
          "If the sources do not cover something, say so explicitly instead of guessing."
        : "",
      "",
      "Provide comprehensive research on this topic.",
    ]
      .filter((line) => line !== "")
      .join("\n");

    // Routed through the multi-provider engine: this works with whichever
    // provider is configured, and falls back automatically on failure.
    const completion = await complete({
      content: userPrompt,
      system: systemPrompt,
      maxTokens: 3000,
      tier: "reasoning",
    });

    const rawText = completion.text;

    let result = {
      summary: rawText,
      keyPoints: [] as string[],
      sources: [] as string[],
      technicalDetails: "",
      practicalApplications: "",
      relatedTopics: [] as string[],
    };

    const parsedResult = extractJson<{
      summary?: string;
      keyPoints?: unknown;
      sources?: unknown;
      technicalDetails?: string;
      practicalApplications?: string;
      relatedTopics?: unknown;
    }>(rawText);

    if (parsedResult) {
      result = {
        summary: parsedResult.summary || rawText,
        keyPoints: Array.isArray(parsedResult.keyPoints) ? (parsedResult.keyPoints as string[]) : [],
        sources: Array.isArray(parsedResult.sources) ? (parsedResult.sources as string[]) : [],
        technicalDetails: parsedResult.technicalDetails || "",
        practicalApplications: parsedResult.practicalApplications || "",
        relatedTopics: Array.isArray(parsedResult.relatedTopics) ? (parsedResult.relatedTopics as string[]) : [],
      };
    }

    // Real, citable sources win. The model's own citations are kept but clearly
    // labelled as unverified so the UI can render them differently.
    const verifiedSources = groundedArticles.map((article) => ({
      title: article.title,
      url: article.url,
      source: article.source,
      publishedAt: article.publishedAt,
    }));
    const modelSources = result.sources.map((entry) => ({ title: String(entry), url: null, source: null, publishedAt: null }));

    const id = randomUUID();
    await db.insert(researchResults).values({
      id,
      query,
      summary: result.summary,
      keyPoints: result.keyPoints,
      sources: verifiedSources.length > 0 ? [...verifiedSources.map((s) => s.url), ...verifiedSources.map((s) => s.title)] : result.sources,
      depth: resolvedDepth,
    });

    await logNexusEvent("info", `Research complete: "${query.slice(0, 60)}" (${depth} depth, ${result.keyPoints.length} key points)`, "research");

    res.json({
      id,
      query,
      depth: resolvedDepth,
      summary: result.summary,
      keyPoints: result.keyPoints,
      sources: result.sources,
      // Additive fields — existing clients keep working untouched.
      verifiedSources,
      unverifiedModelSources: modelSources,
      grounding,
      technicalDetails: result.technicalDetails,
      practicalApplications: result.practicalApplications,
      relatedTopics: result.relatedTopics,
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    await logNexusEvent("error", "Research request failed", "research", {
      code: err instanceof Error ? err.name : "unknown",
    });
    respondAiError(req, res, err, "Research agent failed");
  } finally {
    markAgentIdle("Research");
  }
});

// GET /nexus/research/history
router.get("/nexus/research/history", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(researchResults)
    .orderBy(desc(researchResults.createdAt))
    .limit(20);
  res.json(rows.map(r => ({
    id: r.id,
    query: r.query,
    depth: r.depth,
    summaryPreview: r.summary.slice(0, 200),
    keyPoints: r.keyPoints.slice(0, 3),
    createdAt: r.createdAt,
  })));
});

export default router;
