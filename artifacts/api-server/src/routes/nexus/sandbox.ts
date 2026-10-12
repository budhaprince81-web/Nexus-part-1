/**
 * NEXUS Sandbox route.
 *
 * The actual execution lives in `../../lib/sandbox-exec.ts` so that the agent
 * runtime shares the exact same guardrails instead of re-implementing them.
 */
import { Router, type IRouter } from "express";
import { db, sandboxRuns } from "@workspace/db";
import { RunSandboxBody, RunSandboxResponse } from "@workspace/api-zod";
import { executeSandbox, type SandboxLanguage } from "../../lib/sandbox-exec.ts";
import { markAgentActive, markAgentIdle } from "./agents";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

const ALLOWED_LANGUAGES: SandboxLanguage[] = ["python", "javascript", "typescript", "bash"];

// POST /nexus/sandbox/run
router.post("/nexus/sandbox/run", async (req, res): Promise<void> => {
  const parsed = RunSandboxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, timeoutMs = 10000 } = parsed.data;
  if (!ALLOWED_LANGUAGES.includes(parsed.data.language as SandboxLanguage)) {
    res.status(400).json({
      error: `Unsupported language. Allowed: ${ALLOWED_LANGUAGES.join(", ")}`,
    });
    return;
  }

  markAgentActive("Sandbox");
  try {
    const result = await executeSandbox({
      code,
      language: parsed.data.language as SandboxLanguage,
      timeoutMs,
    });

    await db.insert(sandboxRuns).values({
      code,
      language: parsed.data.language,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
      blocked: result.blocked,
      blockReason: result.blockReason,
    });

    await logNexusEvent(
      result.blocked || result.exitCode !== 0 ? "warn" : "info",
      `Sandbox run: ${parsed.data.language} | exit=${result.exitCode} | ${result.executionTimeMs}ms`,
      "sandbox",
      { exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, blocked: result.blocked },
    );

    res.json(RunSandboxResponse.parse(result));
  } finally {
    markAgentIdle("Sandbox");
  }
});

export default router;
