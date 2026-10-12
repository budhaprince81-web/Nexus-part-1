import { Router, type IRouter } from "express";
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

  const executionOutput = body.data.approved
    ? `Action "${action.actionType}" was approved and logged. Execution simulation complete.`
    : `Action "${action.actionType}" was denied by user.`;

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

  res.json(
    ConfirmActionResponse.parse({
      id: params.data.id,
      approved: body.data.approved,
      executionOutput,
    }),
  );
});

export default router;
