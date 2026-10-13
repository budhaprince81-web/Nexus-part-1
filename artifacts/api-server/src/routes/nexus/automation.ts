/**
 * NEXUS Automation Agent
 * Performs safe, sandboxed desktop automation operations:
 * - File system operations (read/write/create/move/delete/list)
 * - Directory management
 * - System information gathering
 * - Clipboard operations (when possible)
 * All destructive operations require explicit confirmation via the pending actions system.
 */
import { Router, type IRouter } from "express";
import { db, automationLogs, pendingActions } from "@workspace/db";
import { desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";
import { markAgentActive, markAgentIdle } from "./agents";
import { promises as fs, existsSync, realpathSync } from "fs";
import { join, dirname, resolve, relative, isAbsolute, extname } from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const router: IRouter = Router();

// Safe root — restrict automation to a workspace directory
const SAFE_ROOT = resolve(process.cwd(), "nexus-workspace");

// Ensure workspace exists
fs.mkdir(SAFE_ROOT, { recursive: true }).catch(() => {});

const VALID_OPERATIONS = ["read", "write", "create", "delete", "move", "copy", "list", "mkdir", "search", "info", "clipboard_write"] as const;

type SafeResult = { success: boolean; output: string; error?: string; data?: unknown };

function assertInsideRoot(candidate: string): void {
  // `relative` is separator-aware: a plain prefix check would wrongly accept
  // sibling directories such as "nexus-workspace-evil".
  const rel = relative(SAFE_ROOT, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path traversal detected — access denied");
  }
}

function safePath(p: string): string {
  if (typeof p !== "string" || p.length === 0 || p.includes("\0")) {
    throw new Error("Invalid path");
  }
  const full = resolve(SAFE_ROOT, p.replace(/^\/+/, ""));
  assertInsideRoot(full);

  // Block symlink escapes by resolving the closest existing ancestor.
  let ancestor = full;
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) {
    ancestor = dirname(ancestor);
  }
  assertInsideRoot(realpathSync(ancestor));
  return full;
}

const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".sh", ".ps1", ".cmd", ".msi", ".dmg"]);
const BLOCKED_PATTERNS = [/\/etc\//, /\/proc\//, /\/sys\//, /C:\\Windows/i, /system32/i];

function validatePath(p: string): void {
  const ext = extname(p).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`File type ${ext} not allowed for security reasons`);
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(p)) {
      throw new Error("Access to system paths is restricted");
    }
  }
}

function runWithInput(
  file: string,
  args: string[],
  input: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", rejectPromise);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : rejectPromise(new Error(`${file} exited with code ${code}`)),
    );
    child.stdin.end(input, "utf-8");
  });
}

async function executeOperation(
  operation: string,
  path: string,
  content?: string,
  destination?: string,
  query?: string,
  recursive?: boolean,
): Promise<SafeResult> {
  validatePath(path);

  switch (operation) {
    case "read": {
      const fullPath = safePath(path);
      const data = await fs.readFile(fullPath, "utf-8");
      return { success: true, output: data };
    }

    case "write":
    case "create": {
      const fullPath = safePath(path);
      await fs.mkdir(dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content || "", "utf-8");
      return { success: true, output: `File written: ${path} (${(content || "").length} bytes)` };
    }

    case "delete": {
      const fullPath = safePath(path);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        if (recursive) {
          await fs.rm(fullPath, { recursive: true, force: true });
          return { success: true, output: `Directory deleted: ${path}` };
        } else {
          await fs.rmdir(fullPath);
          return { success: true, output: `Empty directory deleted: ${path}` };
        }
      } else {
        await fs.unlink(fullPath);
        return { success: true, output: `File deleted: ${path}` };
      }
    }

    case "move": {
      if (!destination) throw new Error("Destination required for move");
      validatePath(destination);
      const src = safePath(path);
      const dst = safePath(destination);
      await fs.mkdir(dirname(dst), { recursive: true });
      await fs.rename(src, dst);
      return { success: true, output: `Moved: ${path} → ${destination}` };
    }

    case "copy": {
      if (!destination) throw new Error("Destination required for copy");
      validatePath(destination);
      const src = safePath(path);
      const dst = safePath(destination);
      await fs.mkdir(dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      return { success: true, output: `Copied: ${path} → ${destination}` };
    }

    case "list": {
      const fullPath = safePath(path);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        isDir: e.isDirectory(),
      }));
      return { success: true, output: `Listed ${items.length} items in ${path}`, data: items };
    }

    case "mkdir": {
      const fullPath = safePath(path);
      await fs.mkdir(fullPath, { recursive: true });
      return { success: true, output: `Directory created: ${path}` };
    }

    case "search": {
      if (!query || typeof query !== "string" || query.length > 200) {
        throw new Error("A search query of 1-200 characters is required");
      }
      const fullPath = safePath(path);
      // execFile passes arguments as an argv array (no shell), so the query
      // cannot inject commands.
      const { stdout } = (await execFileAsync(
        "find",
        [fullPath, "-maxdepth", "5", "-name", `*${query}*`],
        { timeout: 10_000, maxBuffer: 2_000_000 },
      ).catch(() => ({ stdout: "" }))) as { stdout: string };
      const matches = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(0, 50)
        .map((match) => relative(SAFE_ROOT, match));
      return { success: true, output: `Found ${matches.length} matches`, data: matches };
    }

    case "info": {
      const fullPath = safePath(path);
      const stat = await fs.stat(fullPath);
      const info = {
        path,
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        created: stat.birthtime,
        modified: stat.mtime,
        mode: stat.mode.toString(8),
      };
      return { success: true, output: `File info retrieved`, data: info };
    }

    case "clipboard_write": {
      // Best-effort clipboard (Linux: xclip/xsel, macOS: pbcopy).
      // The text is piped over stdin — it is never interpolated into a shell.
      const text = content || "";
      try {
        if (process.platform === "darwin") {
          await runWithInput("pbcopy", [], text);
        } else {
          try {
            await runWithInput("xclip", ["-selection", "clipboard"], text);
          } catch {
            await runWithInput("xsel", ["--clipboard", "--input"], text);
          }
        }
        return { success: true, output: `Clipboard updated (${text.length} chars)` };
      } catch {
        return { success: false, output: "Clipboard unavailable in this environment", error: "No clipboard access" };
      }
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

// POST /nexus/automation/file
router.post("/nexus/automation/file", async (req, res): Promise<void> => {
  const { operation, path: filePath, content, destination, query, recursive = false } = req.body || {};
  if (!operation || !VALID_OPERATIONS.includes(operation)) {
    res.status(400).json({ error: `operation must be one of: ${VALID_OPERATIONS.join(", ")}` });
    return;
  }
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const isDestructive = ["delete", "move"].includes(operation);

  markAgentActive("Automation");

  // Destructive operations require pending action confirmation
  if (isDestructive) {
    const pendingId = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await db.insert(pendingActions).values({
      id: pendingId,
      actionType: operation.toUpperCase(),
      target: filePath,
      description: `${operation.toUpperCase()} operation on: ${filePath}${destination ? ` → ${destination}` : ""}`,
      requestedBy: "Automation",
      riskLevel: "high",
      params: { operation, path: filePath, destination, recursive },
      expiresAt,
    });

    markAgentIdle("Automation");
    res.status(202).json({
      pending: true,
      pendingId,
      message: `Destructive operation queued for confirmation: ${operation} on ${filePath}`,
    });
    return;
  }

  try {
    const result = await executeOperation(operation, filePath, content, destination, query, recursive);

    await db.insert(automationLogs).values({
      id: randomUUID(),
      operation,
      target: filePath,
      success: result.success,
      output: result.output,
      errorMessage: result.error,
    });

    await logNexusEvent(
      result.success ? "info" : "warn",
      `Automation: ${operation} on ${filePath} — ${result.output}`,
      "automation"
    );

    res.json({ success: result.success, output: result.output, data: result.data ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Automation failed";

    await db.insert(automationLogs).values({
      id: randomUUID(),
      operation,
      target: filePath,
      success: false,
      errorMessage: msg,
    });

    await logNexusEvent("error", `Automation error: ${msg}`, "automation");
    res.status(400).json({ success: false, output: msg, data: null });
  } finally {
    markAgentIdle("Automation");
  }
});

// GET /nexus/automation/workspace — list files in the NEXUS workspace
router.get("/nexus/automation/workspace", async (_req, res): Promise<void> => {
  try {
    const list = async (dir: string, depth = 0): Promise<unknown[]> => {
      if (depth > 3) return [];
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const result = [];
      for (const e of entries) {
        const item: Record<string, unknown> = { name: e.name, type: e.isDirectory() ? "dir" : "file" };
        if (e.isDirectory() && depth < 2) {
          item.children = await list(join(dir, e.name), depth + 1);
        }
        result.push(item);
      }
      return result;
    };
    const tree = await list(SAFE_ROOT);
    res.json({ root: SAFE_ROOT, tree });
  } catch {
    res.json({ root: SAFE_ROOT, tree: [] });
  }
});

// GET /nexus/automation/logs
router.get("/nexus/automation/logs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(automationLogs)
    .orderBy(desc(automationLogs.createdAt))
    .limit(30);
  res.json(rows);
});

export default router;
