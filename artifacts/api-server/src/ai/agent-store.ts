/**
 * Drizzle-backed persistence for the agent runtime.
 *
 * Keeps the runtime itself storage-agnostic (and therefore unit-testable) while
 * giving production a durable audit trail of every plan, step and result.
 */

import { randomUUID } from "crypto";
import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { agentRuns, db, memoryRecords, pendingActions } from "@workspace/db";
import type {
  ApprovalRequest,
  PlanStep,
  RunKind,
  RunRecord,
  RunStatus,
  RunStep,
  RunStore,
} from "./agent-runtime.ts";

const APPROVAL_TTL_MS = 60 * 60 * 1000;

export function approvalIdFor(runId: string, stepId: string): string {
  return `${runId}:${stepId}`;
}

export function rowToRunRecord(row: typeof agentRuns.$inferSelect): RunRecord {
  return {
    id: row.id,
    kind: (row.kind === "jarvis" ? "jarvis" : "nexus") as RunKind,
    goal: row.goal,
    status: row.status as RunStatus,
    plan: Array.isArray(row.plan) ? (row.plan as PlanStep[]) : [],
    steps: Array.isArray(row.steps) ? (row.steps as RunStep[]) : [],
    result: row.result,
    error: row.error,
    control: row.control === "pause" || row.control === "cancel" ? row.control : "run",
    provider: row.provider,
    model: row.model,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function createDrizzleRunStore(): RunStore {
  return {
    async get(id: string): Promise<RunRecord | null> {
      const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
      return row ? rowToRunRecord(row) : null;
    },

    async save(run: RunRecord): Promise<void> {
      const terminal =
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "blocked" ||
        run.status === "cancelled";
      await db
        .update(agentRuns)
        .set({
          status: run.status,
          plan: run.plan,
          steps: run.steps,
          result: run.result,
          error: run.error,
          provider: run.provider,
          model: run.model,
          updatedAt: new Date(),
          completedAt: terminal ? new Date() : null,
        })
        .where(eq(agentRuns.id, run.id));
    },

    async requestApproval(runId: string, request: ApprovalRequest): Promise<void> {
      await db
        .insert(pendingActions)
        .values({
          id: approvalIdFor(runId, request.id),
          actionType: request.actionType,
          target: request.target,
          description: request.description,
          requestedBy: "nexus-agent-runtime",
          riskLevel: request.riskLevel,
          params: { ...request.params, runId, stepId: request.id },
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        })
        .onConflictDoNothing();
    },

    async approvalsFor(runId: string): Promise<Record<string, boolean>> {
      const rows = await db
        .select({
          id: pendingActions.id,
          approved: pendingActions.approved,
        })
        .from(pendingActions)
        .where(
          and(
            isNotNull(pendingActions.resolvedAt),
            sql`${pendingActions.params}->>'runId' = ${runId}`,
          ),
        );
      const decisions: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.approved === null) continue;
        // The step id is everything after the run id prefix.
        const stepId = row.id.startsWith(`${runId}:`) ? row.id.slice(runId.length + 1) : row.id;
        decisions[stepId] = row.approved;
      }
      return decisions;
    },

    async searchMemory(query: string, limit: number): Promise<string[]> {
      if (!query.trim()) return [];
      const rows = await db
        .select({ content: memoryRecords.content, namespace: memoryRecords.namespace })
        .from(memoryRecords)
        .where(ilike(memoryRecords.content, `%${escapeLike(query.trim())}%`))
        .orderBy(desc(memoryRecords.createdAt))
        .limit(Math.min(limit, 25));
      return rows.map((row) => (row.namespace ? `[${row.namespace}] ${row.content}` : row.content));
    },
  };
}

export async function createRunRecord(
  kind: RunKind,
  goal: string,
  id: string = randomUUID(),
): Promise<RunRecord> {
  const [row] = await db.insert(agentRuns).values({ id, kind, goal }).returning();
  return rowToRunRecord(row);
}

export async function loadRunRecord(id: string): Promise<RunRecord | null> {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row ? rowToRunRecord(row) : null;
}

export async function setRunControl(
  id: string,
  control: "run" | "pause" | "cancel",
): Promise<void> {
  await db
    .update(agentRuns)
    .set({ control, updatedAt: new Date() })
    .where(eq(agentRuns.id, id));
}
