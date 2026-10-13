/**
 * NEXUS News / source retrieval API.
 *
 * Returns current articles with their real URLs so an answer can be checked by
 * a human. Article text is sanitised and explicitly marked as untrusted: it is
 * data to cite, never instructions to follow.
 */

import { Router, type IRouter } from "express";
import { NewsError, newsStatus, searchArticles } from "../../lib/news.ts";

const router: IRouter = Router();

function newsErrorStatus(kind: NewsError["kind"]): number {
  switch (kind) {
    case "not_configured":
      return 503;
    case "invalid_key":
      return 502;
    case "rate_limit":
      return 429;
    case "bad_request":
      return 400;
    default:
      return 502;
  }
}

// GET /nexus/news/status
router.get("/nexus/news/status", (_req, res): void => {
  res.json({
    ...newsStatus(),
    note: "Headlines are third-party content and may lag reality by minutes.",
  });
});

// GET /nexus/news/search?q=...&language=en&pageSize=8
router.get("/nexus/news/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q === "") {
    res.status(400).json({ error: "q query parameter is required", code: "bad_request" });
    return;
  }
  const language = typeof req.query.language === "string" ? req.query.language : "en";
  const pageSizeRaw = Number(req.query.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.trunc(pageSizeRaw) : 8;

  try {
    const result = await searchArticles(q, { language, pageSize });
    res.json(result);
  } catch (err) {
    if (err instanceof NewsError) {
      res.status(newsErrorStatus(err.kind)).json({ error: err.message, code: err.kind });
      return;
    }
    res.status(500).json({ error: "News search failed.", code: "internal" });
  }
});

export default router;
