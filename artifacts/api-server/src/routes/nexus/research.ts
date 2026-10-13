/**
 * NEXUS Research Agent
 * Performs deep research using Claude's knowledge base.
 * Provides structured summaries, key points, and actionable insights.
 * Supports standard and deep research modes.
 */
import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { anthropic, isAnthropicConfigured } from "@workspace/integrations-anthropic-ai";
import { db, researchResults } from "@workspace/db";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";
import { markAgentActive, markAgentIdle } from "./agents";

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
  if (!isAnthropicConfigured()) {
    res.status(503).json({
      error:
        "Research agent is unavailable: ANTHROPIC_API_KEY is not configured on the server.",
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

    const userPrompt = `Research Query: ${query}

Depth: ${resolvedDepth}
${RESEARCH_PROMPTS[resolvedDepth]}

Provide comprehensive research on this topic.`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";

    let result = {
      summary: rawText,
      keyPoints: [] as string[],
      sources: [] as string[],
      technicalDetails: "",
      practicalApplications: "",
      relatedTopics: [] as string[],
    };

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const p = JSON.parse(jsonMatch[0]);
        result = {
          summary: p.summary || rawText,
          keyPoints: Array.isArray(p.keyPoints) ? p.keyPoints : [],
          sources: Array.isArray(p.sources) ? p.sources : [],
          technicalDetails: p.technicalDetails || "",
          practicalApplications: p.practicalApplications || "",
          relatedTopics: Array.isArray(p.relatedTopics) ? p.relatedTopics : [],
        };
      }
    } catch {}

    const id = randomUUID();
    await db.insert(researchResults).values({
      id,
      query,
      summary: result.summary,
      keyPoints: result.keyPoints,
      sources: result.sources,
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
      technicalDetails: result.technicalDetails,
      practicalApplications: result.practicalApplications,
      relatedTopics: result.relatedTopics,
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Research failed";
    await logNexusEvent("error", `Research error: ${msg}`, "research");
    res.status(500).json({ error: msg });
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
