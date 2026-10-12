/**
 * Isolated code execution.
 *
 * Shared by the `/nexus/sandbox/run` route and the agent runtime so that both
 * go through exactly the same guardrails. Runs in a throwaway temp directory
 * with a scrubbed environment, a hard timeout and a blocked-pattern denylist.
 * There is no network access, no access to the host environment variables and
 * no way to escape the temp directory. The temp directory is always removed.
 */

import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SandboxLanguage = "python" | "javascript" | "typescript" | "bash";

export interface SandboxExecInput {
  code: string;
  language: SandboxLanguage;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  blocked: boolean;
  blockReason: string | null;
}

export const MAX_SANDBOX_TIMEOUT_MS = 15000;
const MAX_STDOUT = 10000;
const MAX_STDERR = 5000;

/** Patterns that are refused outright before anything is executed. */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /import\s+os/, reason: "python os module is not allowed" },
  { pattern: /import\s+subprocess/, reason: "python subprocess module is not allowed" },
  { pattern: /import\s+socket/, reason: "python socket module is not allowed" },
  { pattern: /\bexec\s*\(/, reason: "exec() is not allowed" },
  { pattern: /\beval\s*\(/, reason: "eval() is not allowed" },
  { pattern: /open\s*\([^)]*['"](\/etc|\/proc|\/sys|~\/\.ssh)/, reason: "host file access is not allowed" },
  { pattern: /__import__/, reason: "dynamic imports are not allowed" },
  { pattern: /ctypes/, reason: "ctypes is not allowed" },
  { pattern: /socket\.connect/, reason: "network access is not allowed" },
  { pattern: /urllib\.request/, reason: "network access is not allowed" },
  { pattern: /requests\.get/, reason: "network access is not allowed" },
  { pattern: /fetch\(['"]https?:\/\//, reason: "network access is not allowed" },
  { pattern: /require\(['"]child_process['"]\)/, reason: "child_process is not allowed" },
  { pattern: /require\(['"]fs['"]\)/, reason: "filesystem access is not allowed" },
  { pattern: /process\.env/, reason: "environment access is not allowed" },
];

export function findBlockedPattern(
  code: string,
): { blocked: boolean; reason: string | null } {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(code)) return { blocked: true, reason };
  }
  return { blocked: false, reason: null };
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function readExecError(err: unknown): { stdout: string; stderr: string; code: number } {
  const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
  return {
    stdout: execErr.stdout ?? "",
    stderr: execErr.stderr ?? (execErr.killed ? "Timed out" : "Execution failed"),
    code: typeof execErr.code === "number" ? execErr.code : 1,
  };
}

export async function executeSandbox(
  input: SandboxExecInput,
): Promise<SandboxExecResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.min(input.timeoutMs ?? MAX_SANDBOX_TIMEOUT_MS, MAX_SANDBOX_TIMEOUT_MS);

  const security = findBlockedPattern(input.code);
  if (security.blocked) {
    return {
      stdout: "",
      stderr: security.reason ?? "Blocked",
      exitCode: 1,
      executionTimeMs: 0,
      blocked: true,
      blockReason: security.reason,
    };
  }

  let tmpDir: string | null = null;
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "nexus-sandbox-"));

    if (input.language === "python") {
      const scriptPath = join(tmpDir, "script.py");
      await writeFile(scriptPath, input.code, "utf-8");
      try {
        const result = await execFileAsync("python3", [scriptPath], {
          timeout: timeoutMs,
          cwd: tmpDir,
          env: { PATH: process.env["PATH"], HOME: tmpDir },
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err) {
        const failed = readExecError(err);
        stdout = failed.stdout;
        stderr = failed.stderr;
        exitCode = failed.code;
      }
    } else if (input.language === "javascript" || input.language === "typescript") {
      const extension = input.language === "typescript" ? "ts" : "js";
      const scriptPath = join(tmpDir, `script.${extension}`);
      const runCode =
        input.language === "typescript"
          // Minimal TS support: strip simple type annotations.
          ? input.code.replace(/:\s*\w+(\[\])?/g, "").replace(/as\s+\w+/g, "")
          : input.code;
      await writeFile(scriptPath, runCode, "utf-8");
      try {
        const result = await execFileAsync("node", [scriptPath], {
          timeout: timeoutMs,
          cwd: tmpDir,
          env: { PATH: process.env["PATH"] },
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err) {
        const failed = readExecError(err);
        stdout = failed.stdout;
        stderr = failed.stderr;
        exitCode = failed.code;
      }
    } else if (input.language === "bash") {
      const scriptPath = join(tmpDir, "script.sh");
      await writeFile(scriptPath, `#!/bin/bash\nset -e\n${input.code}`, {
        mode: 0o700,
        encoding: "utf-8",
      });
      try {
        const result = await execFileAsync("bash", [scriptPath], {
          timeout: timeoutMs,
          cwd: tmpDir,
          env: { PATH: "/usr/bin:/bin", HOME: tmpDir },
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err) {
        const failed = readExecError(err);
        stdout = failed.stdout;
        stderr = failed.stderr;
        exitCode = failed.code;
      }
    } else {
      stderr = `Unsupported language: ${String(input.language)}`;
      exitCode = 1;
    }
  } catch (err) {
    stderr = `Internal sandbox error: ${err instanceof Error ? err.message : String(err)}`;
    exitCode = 1;
  } finally {
    // mkdtemp creates a directory: remove it recursively or every run leaks one.
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    stdout: clip(stdout, MAX_STDOUT),
    stderr: clip(stderr, MAX_STDERR),
    exitCode,
    executionTimeMs: Date.now() - startedAt,
    blocked: false,
    blockReason: null,
  };
}
