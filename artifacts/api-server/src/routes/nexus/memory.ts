import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, memoryRecords } from "@workspace/db";
import {
  SearchMemoryQueryParams,
  SearchMemoryResponse,
  StoreMemoryBody,
  StoreMemoryResponse,
  DeleteMemoryParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

// GET /nexus/memory?q=...
router.get("/nexus/memory", async (req, res): Promise<void> => {
  const query = SearchMemoryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Missing query parameter q" });
    return;
  }

  const limit =
    typeof query.data.limit === "number" ? query.data.limit : 20;
  const q = query.data.q.toLowerCase();

  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      or(
        ilike(memoryRecords.content, `%${q}%`),
        ilike(memoryRecords.namespace, `%${q}%`),
      ),
    )
    .limit(limit);

  res.json(
    SearchMemoryResponse.parse(
      rows.map((r) => ({
        id: r.id,
        content: r.content,
        namespace: r.namespace,
        tags: r.tags ?? [],
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
});

// POST /nexus/memory
router.post("/nexus/memory", async (req, res): Promise<void> => {
  const parsed = StoreMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  const [record] = await db
    .insert(memoryRecords)
    .values({
      id,
      content: parsed.data.content,
      namespace: parsed.data.namespace,
      tags: parsed.data.tags ?? [],
    })
    .returning();

  await logNexusEvent(
    "info",
    `Memory stored in namespace "${record.namespace}": ${record.content.slice(0, 80)}...`,
    "memory",
  );

  res.status(201).json(
    StoreMemoryResponse.parse({
      id: record.id,
      content: record.content,
      namespace: record.namespace,
      tags: record.tags ?? [],
      createdAt: record.createdAt.toISOString(),
    }),
  );
});

// DELETE /nexus/memory/:id
router.delete("/nexus/memory/:id", async (req, res): Promise<void> => {
  const params = DeleteMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(memoryRecords)
    .where(eq(memoryRecords.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Memory record not found" });
    return;
  }

  await logNexusEvent("info", `Memory record deleted: ${params.data.id}`, "memory");
  res.sendStatus(204);
});

export default router;
