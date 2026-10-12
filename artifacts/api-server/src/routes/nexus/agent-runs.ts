/**
 * Autonomous task API — NEXUS agent runs and JARVIS delegation.
 *
 * Runs execute asynchronously: the POST returns immediately with the run
 * record and the client follows progress by polling the run resource. Every
 * state transition is persisted, so a run survives a page reload.
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { agentRuns, db, pendingActions } from "@workspace/db";
import { complete } from "../../ai/index.ts";
import {
  createRunRecord,
  loadRunRecord,
  setRunControl,
} from "../../ai/agent-store.ts";
import { getAgentRuntime } from "../../ai/runtime-singleton.ts";
import { respondAiError } from "../ai-error.ts";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

const MAX_GOAL_LENGTH = 4000;

function readString(value: unknown, max = MAX_GOAL_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function serializeRun(row: typeof agentRuns.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    goal: row.goal,
    status: row.status,
    control: row.control,
    plan: row.plan,
    steps: row.steps,
    result: row.result,
    error: row.error,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

async function loadRunRow(id: string) {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row ?? null;
}

/**
 * Starts a run in the background. Deliberately does not await the loop: the HTTP
 * request must return promptly, and the run keeps going (and persisting) on its
 * own. Failures are logged and recorded in the run row.
 */
function launch(runId: string): void {
  const runtime = getAgentRuntime();
  void runtime
    .runToCompletion(runId)
    .catch((err) => {
      void logNexusEvent(
        "error",
        `Agent run ${runId} crashed: ${err instanceof Error ? err.message : "unknown error"}`,
        "agents",
      );
    });
}

async function createAndLaunch(
  kind: "nexus" | "jarvis",
  goal: string,
): Promise<typeof agentRuns.$inferSelect> {
  const created = await createRunRecord(kind, goal);
  await logNexusEvent(
    "info",
    `${kind === "jarvis" ? "JARVIS" : "NEXUS"} run started: ${goal.slice(0, 80)}`,
    "agents",
    { runId: created.id, kind },
  );
  launch(created.id);
  const row = await loadRunRow(created.id);
  return row!;
}

// POST /nexus/agents/run — plan and execute a goal autonomously
router.post("/nexus/agents/run", async (req, res): Promise<void> => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const goal = readString(raw.goal);
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const context = readString(raw.context, 20000);

  try {
    if (context) {
      // Context is appended to the goal so the planner can use it.
      const row = await createAndLaunch("nexus", `${goal}\n\nContext:\n${context}`);
      res.status(202).json(serializeRun(row));
      return;
    }
    const row = await createAndLaunch("nexus", goal);
    res.status(202).json(serializeRun(row));
  } catch (err) {
    respondAiError(req, res, err, "Failed to start agent run");
  }
});

// GET /nexus/agents/runs — recent runs
router.get("/nexus/agents/runs", async (req, res): Promise<void> => {
  const kind = req.query.kind === "jarvis" ? "jarvis" : req.query.kind === "nexus" ? "nexus" : null;
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20;

  const query = db.select().from(agentRuns);
  const rows = kind
    ? await query.where(eq(agentRuns.kind, kind)).orderBy(desc(agentRuns.createdAt)).limit(limit)
    : await query.orderBy(desc(agentRuns.createdAt)).limit(limit);

  res.json(rows.map(serializeRun));
});

// GET /nexus/agents/runs/:id
router.get("/nexus/agents/runs/:id", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(serializeRun(row));
});

// POST /nexus/agents/runs/:id/pause
router.post("/nexus/agents/runs/:id/pause", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  await setRunControl(row.id, "pause");
  await logNexusEvent("info", `Run ${row.id} paused by operator`, "agents");
  res.json(serializeRun((await loadRunRow(row.id))!));
});

// POST /nexus/agents/runs/:id/resume
router.post("/nexus/agents/runs/:id/resume", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  await setRunControl(row.id, "run");
  getAgentRuntime().clearControl(row.id);
  launch(row.id);
  await logNexusEvent("info", `Run ${row.id} resumed by operator`, "agents");
  res.json(serializeRun((await loadRunRow(row.id))!));
});

// POST /nexus/agents/runs/:id/cancel
router.post("/nexus/agents/runs/:id/cancel", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  getAgentRuntime().cancel(row.id);
  await setRunControl(row.id, "cancel");
  // Any approval still blocking this run is void (and denied) once cancelled.
  try {
    await db
      .update(pendingActions)
      .set({ resolvedAt: new Date(), approved: false, executionOutput: "Run cancelled by operator." })
      .where(
        and(
          isNull(pendingActions.resolvedAt),
          sql`${pendingActions.params}->>'runId' = ${row.id}`,
        ),
      );
  } catch {
    // The approval row may already be resolved; cancellation still proceeds.
  }
  await logNexusEvent("warn", `Run ${row.id} cancelled by operator`, "agents");
  res.json(serializeRun((await loadRunRow(row.id))!));
});

// ---------------------------------------------------------------- JARVIS ---

// POST /nexus/jarvis/assign — NEXUS delegates a validated task to JARVIS
router.post("/nexus/jarvis/assign", async (req, res): Promise<void> => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const task = readString(raw.task);
  if (!task) {
    res.status(400).json({ error: "task is required" });
    return;
  }
  try {
    const row = await createAndLaunch("jarvis", task);
    res.status(202).json(serializeRun(row));
  } catch (err) {
    respondAiError(req, res, err, "Failed to assign task to JARVIS");
  }
});

// GET /nexus/jarvis/tasks
router.get("/nexus/jarvis/tasks", async (req, res): Promise<void> => {
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20;
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.kind, "jarvis"))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  res.json(rows.map(serializeRun));
});

// GET /nexus/jarvis/tasks/:id
router.get("/nexus/jarvis/tasks/:id", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row || row.kind !== "jarvis") {
    res.status(404).json({ error: "JARVIS task not found" });
    return;
  }
  res.json(serializeRun(row));
});

// GET /nexus/jarvis/status — distinct status indicator for the subordinate
router.get("/nexus/jarvis/status", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      goal: agentRuns.goal,
      updatedAt: agentRuns.updatedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.kind, "jarvis"))
    .orderBy(desc(agentRuns.createdAt))
    .limit(50);

  const active = rows.filter((row) =>
    ["planning", "running", "awaiting_approval", "paused"].includes(row.status),
  );
  res.json({
    name: "JARVIS",
    capability: "subordinate-assistant",
    totalTasks: rows.length,
    activeTasks: active.length,
    completedTasks: rows.filter((row) => row.status === "completed").length,
    failedTasks: rows.filter((row) => ["failed", "blocked", "cancelled"].includes(row.status)).length,
    currentTask: active[0] ? { id: active[0].id, goal: active[0].goal, status: active[0].status } : null,
    lastUpdated: rows[0] ? rows[0].updatedAt.toISOString() : null,
  });
});

// POST /nexus/jarvis/tasks/:id/verify — NEXUS inspects and validates JARVIS output
router.post("/nexus/jarvis/tasks/:id/verify", async (req, res): Promise<void> => {
  const row = await loadRunRow(req.params.id);
  if (!row || row.kind !== "jarvis") {
    res.status(404).json({ error: "JARVIS task not found" });
    return;
  }
  if (!row.result) {
    res.status(409).json({ error: "This task has not produced a result yet" });
    return;
  }

  try {
    const completion = await complete({
      content: [
        "You are NEXUS reviewing work delegated to your subordinate JARVIS.",
        `Task: ${row.goal}`,
        `JARVIS result:\n${row.result.slice(0, 8000)}`,
        "",
        "Judge whether the result actually fulfils the task, using only the text above.",
        'Respond with JSON only: {"verdict":"satisfied"|"unsatisfied","notes":"brief justification"}',
      ].join("\n"),
      system:
        "You are rigorous and never assume unstated work was completed. If the " +
        "result does not evidence the task being done, say unsatisfied.",
      maxTokens: 500,
      temperature: 0,
      tier: "balanced",
    });

    const text = completion.text;
    const verdict = /"verdict"\s*:\s*"satisfied"/i.test(text) ? "satisfied" : "unsatisfied";
    const notes = text.slice(0, 1000);

    await db
      .update(agentRuns)
      .set({
        result: `${row.result}\n\n---\nNEXUS verification (${new Date().toISOString()}): ${verdict}\n${notes}`,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, row.id));

    await logNexusEvent(
      verdict === "satisfied" ? "info" : "warn",
      `NEXUS verified JARVIS task ${row.id}: ${verdict}`,
      "agents",
      { taskId: row.id, verdict, provider: completion.provider },
    );

    res.json({
      taskId: row.id,
      verdict,
      notes,
      provider: completion.provider,
      model: completion.model,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    respondAiError(req, res, err, "Failed to verify JARVIS task");
  }
});

export default router;
