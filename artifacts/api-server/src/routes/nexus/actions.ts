import { Router, type IRouter } from "express";
import { getAgentRuntime } from "../../ai/runtime-singleton.ts";
import { executeSandbox, type SandboxLanguage } from "../../lib/sandbox-exec.ts";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, pendingActions } from "@workspace/db";
import {
  ConfirmActionParams,
  ConfirmActionBody,
  ConfirmActionResponse,
  ListPendingActionsResponse,
} from "@workspace/api-zod";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

const SANDBOX_LANGUAGES: SandboxLanguage[] = ["python", "javascript", "typescript", "bash"];

/**
 * Executes an approved action for real, or states plainly that no executor is
 * registered. The previous implementation reported "execution simulation
 * complete", which claimed work that had never happened.
 */
async function executeApprovedAction(action: {
  actionType: string;
  params: unknown;
}): Promise<string> {
  const params =
    action.params && typeof action.params === "object"
      ? (action.params as Record<string, unknown>)
      : {};

  const code = typeof params.code === "string" ? params.code : null;
  const language = SANDBOX_LANGUAGES.includes(params.language as SandboxLanguage)
    ? (params.language as SandboxLanguage)
    : "python";

  if (code) {
    const result = await executeSandbox({ code, language });
    return [
      `Executed ${language} code in the sandbox.`,
      `exit code: ${result.exitCode} (${result.executionTimeMs}ms)`,
      result.blocked ? `blocked: ${result.blockReason ?? "yes"}` : null,
      result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
      result.stderr ? `stderr:\n${result.stderr}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  return (
    `Approved. No executor is registered for action type "${action.actionType}", ` +
    `so nothing was executed. Register an executor before using this action type.`
  );
}

// GET /nexus/pending — list non-expired, unresolved pending actions
router.get("/nexus/pending", async (_req, res): Promise<void> => {
  const now = new Date();
  // A single indexed query: unresolved (approved IS NULL), not yet resolved,
  // and not expired.
  const pending = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        isNull(pendingActions.approved),
        isNull(pendingActions.resolvedAt),
        gt(pendingActions.expiresAt, now),
      ),
    );

  res.json(
    ListPendingActionsResponse.parse(
      pending.map((r) => ({
        id: r.id,
        actionType: r.actionType,
        target: r.target,
        description: r.description,
        requestedBy: r.requestedBy,
        riskLevel: r.riskLevel,
        params: r.params ?? {},
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
    ),
  );
});

// POST /nexus/confirm/:id — approve or deny
router.post("/nexus/confirm/:id", async (req, res): Promise<void> => {
  const params = ConfirmActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = ConfirmActionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [action] = await db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.id, params.data.id));

  if (!action) {
    res.status(404).json({ error: "Pending action not found" });
    return;
  }

  let executionOutput: string;
  if (body.data.approved) {
    try {
      executionOutput = await executeApprovedAction({
        actionType: action.actionType,
        params: action.params,
      });
    } catch (err) {
      executionOutput = `Approved, but execution failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`;
    }
  } else {
    executionOutput = `Action "${action.actionType}" was denied by the operator. Nothing was executed.`;
  }

  await db
    .update(pendingActions)
    .set({
      approved: body.data.approved,
      executionOutput,
      resolvedAt: new Date(),
    })
    .where(eq(pendingActions.id, params.data.id));

  await logNexusEvent(
    body.data.approved ? "info" : "warn",
    `Pending action ${body.data.approved ? "APPROVED" : "DENIED"}: ${action.actionType} on ${action.target ?? "system"}`,
    "security",
    { actionId: action.id, riskLevel: action.riskLevel },
  );

  // If this approval was blocking an agent run, let the run continue now that a
  // decision exists. Done in the background so the HTTP response stays fast.
  const runId = (action.params as Record<string, unknown> | null)?.["runId"];
  if (typeof runId === "string" && runId) {
    void getAgentRuntime()
      .runToCompletion(runId)
      .catch(() => undefined);
  }

  res.json(
    ConfirmActionResponse.parse({
      id: params.data.id,
      approved: body.data.approved,
      executionOutput,
    }),
  );
});

export default router;
