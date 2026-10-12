/**
 * NEXUS Coding Agent
 * Builds complete, production-ready projects from natural language descriptions.
 * Streams file generation events via SSE. Supports 15+ languages and frameworks.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic, isAnthropicConfigured } from "@workspace/integrations-anthropic-ai";
import { db, codingSessions } from "@workspace/db";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";
import { markAgentActive, markAgentIdle } from "./agents";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

function buildCodingSystemPrompt(style: string): string {
  return `You are NEXUS Coding Agent — the world's most advanced AI software engineer.
Your mission: Generate COMPLETE, PRODUCTION-READY code. Never use placeholders. Never skip implementations.

Rules:
1. Generate ALL files needed for a fully working project
2. Every file must be complete — no "// TODO" or "..." shortcuts
3. Include proper error handling, typing, logging, and documentation
4. Follow ${style === "enterprise" ? "enterprise" : style === "production" ? "production" : "clean"} code standards
5. Add proper README.md with setup instructions
6. Code must run immediately after setup

Response format — output ONLY valid JSON:
{
  "projectName": "my-project",
  "summary": "What this project does and how it works",
  "setupInstructions": "How to install and run",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "language": "typescript",
      "content": "...complete file content..."
    }
  ]
}`;
}

// POST /nexus/coding/build — SSE streaming code generation
router.post("/nexus/coding/build", async (req: Request, res: Response): Promise<void> => {
  const { requirement, language = "", framework = "", projectName: reqProjectName = "", style = "production" } = req.body || {};
  if (!requirement || typeof requirement !== "string" || requirement.trim().length < 5) {
    res.status(400).json({ error: "requirement must be at least 5 characters" });
    return;
  }
  const resolvedStyle = ["minimal", "production", "enterprise"].includes(style) ? style : "production";
  if (!isAnthropicConfigured()) {
    res.status(503).json({
      error:
        "Coding agent is unavailable: ANTHROPIC_API_KEY is not configured on the server.",
    });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (type: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const sessionId = randomUUID();
  markAgentActive("Coder");

  try {
    sendEvent("thinking", { message: "Analyzing requirements and planning architecture..." });

    // Create session record
    await db.insert(codingSessions).values({
      id: sessionId,
      requirement,
      projectName: reqProjectName || "nexus-project",
      framework: framework || "auto",
      language: language || "auto",
      files: [],
      status: "building",
      totalFiles: 0,
    });

    const langHint = language ? `Primary language: ${language}.` : "";
    const fwHint = framework ? `Framework: ${framework}.` : "";
    const nameHint = reqProjectName ? `Project name: ${reqProjectName}.` : "";

    const userPrompt = `Build this: ${requirement}

${langHint} ${fwHint} ${nameHint}

Generate a complete, working project with all necessary files. Include:
- Main application code
- Configuration files (package.json, tsconfig.json, requirements.txt, etc.)
- README.md with setup and run instructions
- Any needed utility/helper files
- Basic tests if applicable`;

    sendEvent("thinking", { message: "Generating complete project files..." });

    const stream = await anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      system: buildCodingSystemPrompt(resolvedStyle),
      messages: [{ role: "user", content: userPrompt }],
    });

    let fullResponse = "";
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        fullResponse += chunk.delta.text;
        // Send progress indicator
        if (fullResponse.length % 500 < 30) {
          sendEvent("progress", { message: "Writing code...", chars: fullResponse.length });
        }
      }
    }

    // Parse the JSON response
    let generatedFiles: GeneratedFile[] = [];
    let projectName = reqProjectName || "nexus-project";
    let summary = "";

    try {
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        generatedFiles = Array.isArray(parsed.files) ? parsed.files : [];
        projectName = parsed.projectName || projectName;
        summary = parsed.summary || "";

        // Send each file as an event
        for (const file of generatedFiles) {
          sendEvent("file", {
            path: file.path,
            language: file.language || "text",
            content: file.content,
            size: file.content.length,
          });
        }

        if (parsed.setupInstructions) {
          sendEvent("instructions", { message: parsed.setupInstructions });
        }
      } else {
        // Fallback: treat entire response as main file
        generatedFiles = [{
          path: `${projectName}/main.${language || "txt"}`,
          content: fullResponse,
          language: language || "text",
        }];
        sendEvent("file", { path: generatedFiles[0].path, language: language || "text", content: fullResponse, size: fullResponse.length });
      }
    } catch {
      // Fallback to raw response
      generatedFiles = [{ path: "output.txt", content: fullResponse, language: "text" }];
      sendEvent("file", { path: "output.txt", language: "text", content: fullResponse, size: fullResponse.length });
    }

    // Update session record
    await db.update(codingSessions)
      .set({
        projectName,
        files: generatedFiles as any,
        status: "complete",
        totalFiles: generatedFiles.length,
        summary,
      })
      .where(eq(codingSessions.id, sessionId));

    await logNexusEvent("info", `Coding session complete: ${generatedFiles.length} files generated for "${requirement.slice(0, 60)}"`, "coder");

    sendEvent("done", {
      sessionId,
      projectName,
      totalFiles: generatedFiles.length,
      summary,
      message: `✅ Project complete! Generated ${generatedFiles.length} files.`,
    });

    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Code generation failed";
    await logNexusEvent("error", `Coding error: ${msg}`, "coder");

    try {
      await db.update(codingSessions)
        .set({ status: "error" })
        .where(eq(codingSessions.id, sessionId));
    } catch {}

    sendEvent("error", { message: msg });
    res.end();
  } finally {
    markAgentIdle("Coder");
  }
});

// GET /nexus/coding/sessions
router.get("/nexus/coding/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({
      id: codingSessions.id,
      requirement: codingSessions.requirement,
      projectName: codingSessions.projectName,
      framework: codingSessions.framework,
      language: codingSessions.language,
      status: codingSessions.status,
      totalFiles: codingSessions.totalFiles,
      summary: codingSessions.summary,
      createdAt: codingSessions.createdAt,
    })
    .from(codingSessions)
    .orderBy(desc(codingSessions.createdAt))
    .limit(20);

  res.json(sessions.map(s => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  })));
});

// GET /nexus/coding/sessions/:id
router.get("/nexus/coding/sessions/:id", async (req, res): Promise<void> => {
  const session = await db
    .select()
    .from(codingSessions)
    .where(eq(codingSessions.id, req.params.id))
    .limit(1);

  if (!session.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const s = session[0];
  res.json({
    id: s.id,
    requirement: s.requirement,
    projectName: s.projectName,
    framework: s.framework,
    language: s.language,
    files: s.files,
    status: s.status,
    totalFiles: s.totalFiles,
    summary: s.summary,
    createdAt: s.createdAt.toISOString(),
  });
});

export default router;
