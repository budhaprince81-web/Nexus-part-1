/**
 * NEXUS Vision Agent
 * Analyzes images, documents, and screen captures via Claude's vision API.
 * Supports: image analysis, OCR, document understanding, object detection, UI element detection.
 */
import { Router, type IRouter } from "express";
import { complete, extractJson, hasConfiguredProvider, imagePart, textPart } from "../../ai/index.ts";
import { respondAiError } from "../ai-error.ts";
import { desc } from "drizzle-orm";
import { db, visionAnalyses } from "@workspace/db";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";
import { markAgentActive, markAgentIdle } from "./agents";

const router: IRouter = Router();
const VALID_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const VALID_MODES = ["describe", "ocr", "detect_ui", "document", "screen_read", "custom"] as const;

function buildVisionPrompt(mode: string, customPrompt?: string): string {
  const modes: Record<string, string> = {
    describe: `You are NEXUS Vision Agent. Analyze this image comprehensively and provide:
1. A detailed description of what you see
2. List of all objects/elements detected (comma separated)  
3. Any text visible in the image (OCR)
4. Scene context and key insights
5. Confidence score (0-100)

Format your response as JSON: {
  "description": "...",
  "objects": ["obj1", "obj2"],
  "extractedText": "...",
  "confidence": 95,
  "insights": "..."
}`,
    ocr: `You are NEXUS OCR Agent. Extract all text from this image with perfect accuracy.
Return as JSON: {
  "description": "Document/image with text content",
  "objects": ["text_block", "document"],
  "extractedText": "...all extracted text, preserving structure...",
  "confidence": 98,
  "insights": "Text extraction complete"
}`,
    detect_ui: `You are NEXUS UI Detection Agent. Analyze this UI screenshot and identify:
1. All interactive elements (buttons, inputs, links, dropdowns)
2. Layout structure
3. Text content
4. Navigation elements
5. Suggested automation steps

Return as JSON: {
  "description": "UI screenshot analysis",
  "objects": ["button:Submit", "input:email", "nav:menu"],
  "extractedText": "...visible text...",
  "confidence": 90,
  "insights": "Detected N interactive elements. Automation possible via..."
}`,
    document: `You are NEXUS Document Agent. Analyze this document and extract:
1. Document type and structure
2. All text content (OCR)
3. Key information (dates, names, amounts, etc.)
4. Summary of content

Return as JSON: {
  "description": "Document type and overview",
  "objects": ["heading", "paragraph", "table", "signature"],
  "extractedText": "...full document text...",
  "confidence": 95,
  "insights": "Document summary and key extracted data"
}`,
    screen_read: `You are NEXUS Screen Reader. Read this screen and describe:
1. What application/website is shown
2. Current state and content
3. Any notifications or alerts
4. Suggested next actions for automation

Return as JSON: {
  "description": "Screen description",
  "objects": ["app:...", "window:...", "notification:..."],
  "extractedText": "...visible text...",
  "confidence": 92,
  "insights": "Screen context and automation suggestions"
}`,
    custom: customPrompt || "Analyze this image and describe what you see.",
  };
  return modes[mode] || modes.describe;
}

// POST /nexus/vision/analyze
router.post("/nexus/vision/analyze", async (req, res): Promise<void> => {
  const { imageBase64, mimeType = "image/jpeg", prompt = "", mode = "describe" } = req.body || {};
  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }
  const resolvedMime = VALID_MIMES.includes(mimeType) ? mimeType : "image/jpeg";
  const resolvedMode = VALID_MODES.includes(mode) ? mode : "describe";
  if (!hasConfiguredProvider()) {
    res.status(503).json({
      error:
        "Vision agent is unavailable: no AI provider is configured on the server. " +
        "Add ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or " +
        "OPENROUTER_API_KEY in Replit Secrets.",
      code: "no_provider_configured",
    });
    return;
  }
  markAgentActive("Vision");

  try {
    const systemPrompt = buildVisionPrompt(resolvedMode, prompt);
    const isCustom = resolvedMode === "custom";

    // Multimodal request through the engine. Providers that cannot accept
    // images report a bad_request, and the engine falls back to one that can.
    const completion = await complete({
      content: [
        imagePart(resolvedMime, imageBase64),
        textPart(isCustom ? prompt || "Analyze this image." : systemPrompt),
      ],
      system: isCustom ? "You are NEXUS Vision Agent, an expert image analyst." : undefined,
      maxTokens: 1500,
      tier: "reasoning",
    });

    const rawText = completion.text;

    // Parse JSON response
    let analysis = {
      description: rawText,
      objects: [] as string[],
      extractedText: null as string | null,
      confidence: 90,
      insights: "",
    };

    if (!isCustom) {
      const parsed = extractJson<{
        description?: string;
        objects?: unknown;
        extractedText?: string | null;
        confidence?: number;
        insights?: string;
      }>(rawText);
      if (parsed) {
        analysis = {
          description: parsed.description || rawText,
          objects: Array.isArray(parsed.objects) ? (parsed.objects as string[]) : [],
          extractedText: parsed.extractedText || null,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 90,
          insights: parsed.insights || "",
        };
      }
    }

    const id = randomUUID();
    await db.insert(visionAnalyses).values({
      id,
      prompt: isCustom ? (prompt || "analyze") : resolvedMode,
      description: analysis.description,
      objects: analysis.objects,
      extractedText: analysis.extractedText,
      confidence: analysis.confidence,
      mimeType: resolvedMime,
      metadata: {
        mode: resolvedMode,
        insights: analysis.insights,
        provider: completion.provider,
        model: completion.model,
      },
    });

    await logNexusEvent("info", `Vision analysis complete: ${mode} mode, ${analysis.objects.length} objects detected`, "vision");

    res.json({
      id,
      description: analysis.description,
      objects: analysis.objects,
      extractedText: analysis.extractedText,
      confidence: analysis.confidence,
      insights: analysis.insights,
      mode: resolvedMode,
      provider: completion.provider,
      providerLabel: completion.providerLabel,
      model: completion.model,
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    await logNexusEvent("error", "Vision analysis failed", "vision", {
      code: err instanceof Error ? err.name : "unknown",
    });
    respondAiError(req, res, err, "Vision agent failed");
  } finally {
    markAgentIdle("Vision");
  }
});

// GET /nexus/vision/history
router.get("/nexus/vision/history", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(visionAnalyses)
    .orderBy(desc(visionAnalyses.createdAt))
    .limit(20);
  res.json(rows.map(r => ({
    id: r.id,
    prompt: r.prompt,
    description: r.description.slice(0, 200),
    objects: r.objects,
    confidence: r.confidence,
    createdAt: r.createdAt,
  })));
});

export default router;
