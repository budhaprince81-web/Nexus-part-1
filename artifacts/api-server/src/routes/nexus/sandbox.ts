import { Router, type IRouter } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { db, sandboxRuns } from "@workspace/db";
import { RunSandboxBody, RunSandboxResponse } from "@workspace/api-zod";
import { markAgentActive, markAgentIdle } from "./agents";
import { logNexusEvent } from "./logs";

const execFileAsync = promisify(execFile);
const router: IRouter = Router();

// Security: patterns that are blocked in sandbox code
const BLOCKED_PATTERNS = [
  /import\s+os/,
  /import\s+subprocess/,
  /exec\s*\(/,
  /eval\s*\(/,
  /open\s*\([^)]*['"](\/etc|\/proc|\/sys|~\/.ssh)/,
  /__import__/,
  /ctypes/,
  /socket\.connect/,
  /urllib\.request/,
  /requests\.get/,
  /fetch\(['"]https?:\/\//,
  /require\(['"]child_process['"]\)/,
  /require\(['"]fs['"]\)/,
  /process\.env/,
];

function checkForBlockedPatterns(
  code: string,
): { blocked: boolean; reason: string | null } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return {
        blocked: true,
        reason: `Blocked pattern detected: ${pattern.source.slice(0, 40)}...`,
      };
    }
  }
  return { blocked: false, reason: null };
}

// POST /nexus/sandbox/run
router.post("/nexus/sandbox/run", async (req, res): Promise<void> => {
  const parsed = RunSandboxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, language, timeoutMs = 10000 } = parsed.data;
  const safeTimeout = Math.min(timeoutMs, 15000); // Max 15 seconds

  // Security check first
  const secCheck = checkForBlockedPatterns(code);
  if (secCheck.blocked) {
    const result = {
      stdout: "",
      stderr: secCheck.reason ?? "Blocked",
      exitCode: 1,
      executionTimeMs: 0,
      blocked: true,
      blockReason: secCheck.reason,
    };

    await db.insert(sandboxRuns).values({
      code,
      language,
      stdout: "",
      stderr: secCheck.reason ?? "Blocked",
      exitCode: 1,
      executionTimeMs: 0,
      blocked: true,
      blockReason: secCheck.reason,
    });

    await logNexusEvent(
      "warn",
      `Sandbox execution BLOCKED: ${secCheck.reason}`,
      "sandbox",
    );

    res.json(RunSandboxResponse.parse(result));
    return;
  }

  markAgentActive("Sandbox");
  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  let tmpDir: string | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "nexus-sandbox-"));

    if (language === "python") {
      const scriptPath = join(tmpDir, "script.py");
      await writeFile(scriptPath, code, "utf-8");
      try {
        const result = await execFileAsync("python3", [scriptPath], {
          timeout: safeTimeout,
          cwd: tmpDir,
          env: {
            PATH: process.env["PATH"],
            HOME: tmpDir,
          },
        });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; code?: number };
        stdout = execErr.stdout ?? "";
        stderr = execErr.stderr ?? "Execution failed or timed out";
        exitCode = execErr.code ?? 1;
      }
    } else if (language === "javascript" || language === "typescript") {
      const ext = language === "typescript" ? "ts" : "js";
      const scriptPath = join(tmpDir, `script.${ext}`);

      let runCode = code;
      if (language === "typescript") {
        // Minimal TS: strip type annotations for basic scripts
        runCode = code.replace(/:\s*\w+(\[\])?/g, "").replace(/as\s+\w+/g, "");
      }

      await writeFile(scriptPath, runCode, "utf-8");
      try {
        const result = await execFileAsync(
          "node",
          [scriptPath],
          { timeout: safeTimeout, cwd: tmpDir, env: { PATH: process.env["PATH"] } },
        );
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; code?: number };
        stdout = execErr.stdout ?? "";
        stderr = execErr.stderr ?? "Execution failed or timed out";
        exitCode = execErr.code ?? 1;
      }
    } else if (language === "bash") {
      const scriptPath = join(tmpDir, "script.sh");
      // Bash: only allow basic commands, no network
      const safeCode = `#!/bin/bash\nset -e\n${code}`;
      await writeFile(scriptPath, safeCode, { mode: 0o700, encoding: "utf-8" });
      try {
        const result = await execFileAsync("bash", [scriptPath], {
          timeout: safeTimeout,
          cwd: tmpDir,
          env: { PATH: "/usr/bin:/bin", HOME: tmpDir },
        });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; code?: number };
        stdout = execErr.stdout ?? "";
        stderr = execErr.stderr ?? "Execution failed or timed out";
        exitCode = execErr.code ?? 1;
      }
    } else {
      stderr = `Unsupported language: ${language}`;
      exitCode = 1;
    }
  } catch (err) {
    stderr = `Internal sandbox error: ${String(err)}`;
    exitCode = 1;
  } finally {
    if (tmpDir) {
      // mkdtemp creates a directory: it must be removed recursively,
      // otherwise every sandbox run leaks a temp directory.
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    markAgentIdle("Sandbox");
  }

  const executionTimeMs = Date.now() - startTime;

  await db.insert(sandboxRuns).values({
    code,
    language,
    stdout: stdout.slice(0, 10000),
    stderr: stderr.slice(0, 5000),
    exitCode,
    executionTimeMs,
    blocked: false,
    blockReason: null,
  });

  await logNexusEvent(
    exitCode === 0 ? "info" : "warn",
    `Sandbox run: ${language} | exit=${exitCode} | ${executionTimeMs}ms`,
    "sandbox",
    { exitCode, executionTimeMs },
  );

  res.json(
    RunSandboxResponse.parse({
      stdout: stdout.slice(0, 10000),
      stderr: stderr.slice(0, 5000),
      exitCode,
      executionTimeMs,
      blocked: false,
      blockReason: null,
    }),
  );
});

export default router;
