/**
 * NEXUS Task Manager
 * Full CRUD task management with priorities, tags, and status tracking.
 * Integrated with the notification system.
 */
import { Router, type IRouter } from "express";
import { db, tasks } from "@workspace/db";
import { eq, desc, or, ilike } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

// GET /nexus/tasks
router.get("/nexus/tasks", async (req, res): Promise<void> => {
  const { status, priority, q } = req.query as Record<string, string>;

  let query = db.select().from(tasks).$dynamic();

  if (status) {
    query = query.where(eq(tasks.status, status));
  }
  if (priority) {
    query = query.where(eq(tasks.priority, priority));
  }
  if (q) {
    query = query.where(
      or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`))
    );
  }

  const rows = await query.orderBy(desc(tasks.createdAt)).limit(100);

  res.json(rows.map(t => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    dueDate: t.dueDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  })));
});

// POST /nexus/tasks
router.post("/nexus/tasks", async (req, res): Promise<void> => {
  const { title, description, priority = "medium", tags = [], dueDate } = req.body || {};
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  {
  const id = randomUUID();
  const resolvedPriority = VALID_PRIORITIES.includes(priority) ? priority : "medium";

  const [task] = await db.insert(tasks).values({
    id,
    title: title.trim(),
    description,
    priority: resolvedPriority,
    tags: Array.isArray(tags) ? tags : [],
    dueDate: dueDate ? new Date(dueDate) : undefined,
    status: "pending",
  }).returning();

  await logNexusEvent("info", `Task created: "${title}" [${priority}]`, "tasks");

  res.status(201).json({
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  });
  }
});

// PATCH /nexus/tasks/:id
router.patch("/nexus/tasks/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const body = req.body || {};

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = VALID_PRIORITIES.includes(body.priority) ? body.priority : "medium";
  if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags : [];
  if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.status !== undefined) {
    updates.status = VALID_STATUSES.includes(body.status) ? body.status : "pending";
  }

  if (body.status === "completed") {
    updates.completedAt = new Date();
  }

  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!existing.length) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const [updated] = await db.update(tasks)
    .set(updates as any)
    .where(eq(tasks.id, id))
    .returning();

  if (body.status === "completed") {
    await logNexusEvent("info", `Task completed: "${updated.title}"`, "tasks");
  }

  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    dueDate: updated.dueDate?.toISOString() ?? null,
    completedAt: updated.completedAt?.toISOString() ?? null,
  });
});

// DELETE /nexus/tasks/:id
router.delete("/nexus/tasks/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!existing.length) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  await db.delete(tasks).where(eq(tasks.id, id));
  await logNexusEvent("info", `Task deleted: "${existing[0].title}"`, "tasks");
  res.status(204).end();
});

// GET /nexus/tasks/stats
router.get("/nexus/tasks/stats", async (_req, res): Promise<void> => {
  const all = await db.select().from(tasks);
  const stats = {
    total: all.length,
    pending: all.filter(t => t.status === "pending").length,
    in_progress: all.filter(t => t.status === "in_progress").length,
    completed: all.filter(t => t.status === "completed").length,
    cancelled: all.filter(t => t.status === "cancelled").length,
    critical: all.filter(t => t.priority === "critical").length,
    high: all.filter(t => t.priority === "high").length,
    overdue: all.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed").length,
  };
  res.json(stats);
});

export default router;
