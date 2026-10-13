/**
 * NEXUS Market Data API.
 *
 * Deliberately read-only. There is no order endpoint, no brokerage session and
 * no write path of any kind: the operator can look at a real quote or a real
 * daily series, and nothing here can move money.
 *
 * Every response carries provenance (source, URL, fetch time, freshness) so the
 * UI cannot render a delayed number as though it were live.
 */

import { Router, type IRouter } from "express";
import {
  MarketDataError,
  getDailySeries,
  getFxRate,
  getQuote,
  marketDataStatus,
} from "../../lib/market-data.ts";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

function marketErrorStatus(kind: MarketDataError["kind"]): number {
  switch (kind) {
    case "not_configured":
      return 503;
    case "invalid_key":
      return 502;
    case "rate_limit":
    case "budget_exhausted":
      return 429;
    case "bad_symbol":
    case "unsupported":
      return 400;
    default:
      return 502;
  }
}

function respondMarketError(err: unknown, res: import("express").Response): void {
  if (err instanceof MarketDataError) {
    res.status(marketErrorStatus(err.kind)).json({ error: err.message, code: err.kind });
    return;
  }
  res.status(500).json({ error: "Market data request failed.", code: "internal" });
}

function readSymbol(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

// GET /nexus/market/status
router.get("/nexus/market/status", (_req, res): void => {
  res.json({
    ...marketDataStatus(),
    disclaimer:
      "Prices are supplied by a third-party data provider and may be delayed. " +
      "Nothing here is investment advice, and this system cannot place orders.",
  });
});

// GET /nexus/market/quote?symbol=AAPL
router.get("/nexus/market/quote", async (req, res): Promise<void> => {
  const symbol = readSymbol(req.query.symbol);
  if (symbol === "") {
    res.status(400).json({ error: "symbol query parameter is required", code: "bad_symbol" });
    return;
  }
  try {
    const quote = await getQuote(symbol);
    res.json(quote);
  } catch (err) {
    if (!(err instanceof MarketDataError) || err.kind !== "not_configured") {
      await logNexusEvent(
        "warn",
        `Market quote unavailable for ${symbol.toUpperCase()}`,
        "market",
        { code: err instanceof MarketDataError ? err.kind : "internal" },
      );
    }
    respondMarketError(err, res);
  }
});

// GET /nexus/market/history?symbol=AAPL&full=1
router.get("/nexus/market/history", async (req, res): Promise<void> => {
  const symbol = readSymbol(req.query.symbol);
  if (symbol === "") {
    res.status(400).json({ error: "symbol query parameter is required", code: "bad_symbol" });
    return;
  }
  const compact = readSymbol(req.query.full) !== "1";
  try {
    const series = await getDailySeries(symbol, compact);
    res.json(series);
  } catch (err) {
    respondMarketError(err, res);
  }
});

// GET /nexus/market/fx?from=USD&to=NPR
router.get("/nexus/market/fx", async (req, res): Promise<void> => {
  const from = readSymbol(req.query.from);
  const to = readSymbol(req.query.to);
  if (from === "" || to === "") {
    res.status(400).json({ error: "from and to query parameters are required", code: "bad_request" });
    return;
  }
  try {
    const rate = await getFxRate(from, to);
    res.json(rate);
  } catch (err) {
    respondMarketError(err, res);
  }
});

export default router;
