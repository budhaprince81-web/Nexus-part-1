import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, logEntries } from "@workspace/db";
import { GetRecentLogsQueryParams, GetRecentLogsResponse } from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

export async function logNexusEvent(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  source: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(logEntries).values({
      id: randomUUID(),
      level,
      message,
      source,
      metadata,
      timestamp: new Date(),
    });
  } catch {
    // Don't throw if logging fails
  }
}

// GET /nexus/logs
router.get("/nexus/logs", async (req, res): Promise<void> => {
  const query = GetRecentLogsQueryParams.safeParse(req.query);
  const limit = query.success && query.data.limit ? query.data.limit : 50;

  const rows = await db
    .select()
    .from(logEntries)
    .orderBy(desc(logEntries.timestamp))
    .limit(limit);

  res.json(
    GetRecentLogsResponse.parse(
      rows.map((r) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        source: r.source,
        timestamp: r.timestamp.toISOString(),
        metadata: r.metadata ?? {},
      })),
    ),
  );
});

export default router;
