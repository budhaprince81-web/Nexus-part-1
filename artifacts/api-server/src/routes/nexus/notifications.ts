/**
 * NEXUS Notification System
 * Real-time notification management with type-based routing and auto-clearing.
 */
import { Router, type IRouter } from "express";
import { db, notifications } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();
const VALID_NOTIF_TYPES = ["info", "success", "warning", "error", "system", "agent", "task"] as const;

// GET /nexus/notifications
router.get("/nexus/notifications", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const rows = await db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  res.json(rows.map(n => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  })));
});

// POST /nexus/notifications — create a notification
router.post("/nexus/notifications", async (req, res): Promise<void> => {
  const { type = "info", title, message, metadata = {} } = req.body || {};
  if (!title || !message) {
    res.status(400).json({ error: "title and message are required" });
    return;
  }
  const resolvedType = VALID_NOTIF_TYPES.includes(type) ? type : "info";

  const [notification] = await db.insert(notifications).values({
    id: randomUUID(),
    type: resolvedType,
    title,
    message,
    metadata: typeof metadata === "object" ? metadata : {},
    read: false,
  }).returning();

  res.status(201).json({
    ...notification,
    createdAt: notification.createdAt.toISOString(),
  });
});

// PATCH /nexus/notifications/:id/read — mark as read
router.patch("/nexus/notifications/:id/read", async (req, res): Promise<void> => {
  const { id } = req.params;
  const existing = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!existing.length) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  const [updated] = await db.update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning();
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

// DELETE /nexus/notifications/:id — dismiss
router.delete("/nexus/notifications/:id", async (req, res): Promise<void> => {
  await db.delete(notifications).where(eq(notifications.id, req.params.id));
  res.status(204).end();
});

// DELETE /nexus/notifications — clear all
router.delete("/nexus/notifications", async (_req, res): Promise<void> => {
  await db.delete(notifications);
  res.status(204).end();
});

// Exported helper for other routes to create notifications
export async function createSystemNotification(
  type: "info" | "success" | "warning" | "error" | "system" | "agent" | "task",
  title: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(notifications).values({
      id: randomUUID(),
      type,
      title,
      message,
      metadata,
      read: false,
    });
  } catch {}
}

export default router;
