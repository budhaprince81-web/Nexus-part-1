/**
 * Market data — Alpha Vantage.
 *
 * Design rules (they exist because this data can move money):
 *  - The API key is read from the server environment only. Alpha Vantage accepts
 *    the credential solely as a query parameter, so the request URL is never
 *    logged, echoed into an error message, or attached to a thrown error.
 *  - Every payload carries `source`, `fetchedAt` and `freshness` so the UI can
 *    never present stale numbers as if they were live.
 *  - The free tier allows ~25 requests/day, so results are cached and identical
 *    concurrent requests are de-duplicated instead of being sent twice.
 *  - When the provider refuses (bad key, daily limit, unknown symbol) we surface
 *    a typed error. We never invent a price and never fall back to "random" data.
 */

import { fetchWithTimeout, sleep } from "../ai/http.ts";
import { KeyPool, parseApiKeys } from "../ai/keys.ts";

export type Freshness = "real-time" | "delayed" | "historical" | "unavailable";

export type MarketErrorKind =
  | "not_configured"
  | "invalid_key"
  | "rate_limit"
  | "budget_exhausted"
  | "bad_symbol"
  | "unsupported"
  | "unavailable"
  | "malformed";

export class MarketDataError extends Error {
  readonly kind: MarketErrorKind;
  readonly status: number | null;

  constructor(kind: MarketErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "MarketDataError";
    this.kind = kind;
    this.status = status;
  }
}

export interface DataProvenance {
  /** Human-readable provider name shown next to every number. */
  source: string;
  sourceUrl: string;
  /** ISO timestamp of when *we* fetched it. */
  fetchedAt: string;
  /** How current the numbers are — never claim "real-time" without a live feed. */
  freshness: Freshness;
  /** Whether this app can place orders. Always false — there is no broker. */
  liveTradingEnabled: boolean;
}

export interface MarketQuote extends DataProvenance {
  symbol: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  latestTradingDay: string | null;
}

export interface DailyPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DailySeries extends DataProvenance {
  symbol: string;
  points: DailyPoint[];
}

export interface FxRate extends DataProvenance {
  from: string;
  to: string;
  rate: number | null;
  lastRefreshed: string | null;
}

const SOURCE = "Alpha Vantage";
const SOURCE_URL = "https://www.alphavantage.co/documentation/";
const BASE = process.env.ALPHA_VANTAGE_BASE_URL ?? "https://www.alphavantage.co";
/** Free tier is EOD/delayed; intraday entitlements are separate and opt-in. */
const PREMIUM_INTRADAY = process.env.ALPHA_VANTAGE_INTRADAY === "true";

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

// Read per call (not at import) so a rotated secret or a tuned limit takes
// effect without a restart — and so tests can drive them directly.
const quoteTtlMs = () => intFromEnv("MARKET_QUOTE_TTL_MS", 5 * 60_000);
const seriesTtlMs = () => intFromEnv("MARKET_SERIES_TTL_MS", 60 * 60_000);
const requestTimeoutMs = () => intFromEnv("MARKET_TIMEOUT_MS", 12_000);
/** Rolling 24h ceiling so we cannot silently burn the whole free-tier quota. */
const dailyBudget = () => intFromEnv("MARKET_DAILY_BUDGET", 24);
/** Rounds of (all keys) attempted after a transient rate limit. 1 = no retry. */
const rateLimitRounds = () => intFromEnv("MARKET_RATE_LIMIT_ROUNDS", 3);
const rateLimitBackoffMs = () => intFromEnv("MARKET_RATE_LIMIT_BACKOFF_MS", 1500);
/**
 * Alpha Vantage free keys allow only ~1 request/second and reject bursts with an
 * `Information` notice. Upstream calls are therefore serialised with this
 * minimum gap. 0 disables pacing (used by the unit tests).
 */
const minIntervalMs = () => {
  const raw = process.env.MARKET_MIN_INTERVAL_MS;
  if (raw === undefined || raw === "") return 1100;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 1100;
};

/** Timestamp of the last upstream call, plus a serialising chain. */
let lastCallAt = 0;
let callChain: Promise<void> = Promise.resolve();

/**
 * Waits until at least `minIntervalMs()` has passed since the previous upstream
 * call. Chained (not just clamped) so two concurrent lookups queue behind each
 * other instead of both observing the same "now" and firing together.
 */
async function paceUpstreamCall(): Promise<void> {
  const gap = minIntervalMs();
  const wait = callChain.then(async () => {
    const sinceLast = Date.now() - lastCallAt;
    if (gap > 0 && sinceLast < gap) {
      await new Promise((resolve) => setTimeout(resolve, gap - sinceLast));
    }
    lastCallAt = Date.now();
  });
  callChain = wait.then(
    () => undefined,
    () => undefined,
  );
  await wait;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
/** In-flight requests, so two callers asking for the same symbol issue one call. */
const inFlight = new Map<string, Promise<unknown>>();
const requestLog: number[] = [];

/** Splits credentials so a comma-separated env value also gives failover here. */
function keyPool(): KeyPool {
  return new KeyPool(parseApiKeys(process.env.ALPHA_VANTAGE_API_KEY));
}

export function isMarketDataConfigured(): boolean {
  return keyPool().configured;
}

/** Number of upstream calls we have made in the last 24h (our own accounting). */
export function requestsInLastDay(): number {
  const cutoff = Date.now() - 86_400_000;
  while (requestLog.length > 0 && requestLog[0] < cutoff) requestLog.shift();
  return requestLog.length;
}

export function marketDataStatus(): {
  configured: boolean;
  provider: string;
  docsUrl: string;
  freshness: Freshness;
  liveTradingEnabled: boolean;
  requestsLast24h: number;
  dailyBudget: number;
  cacheSeconds: { quote: number; series: number };
} {
  return {
    configured: isMarketDataConfigured(),
    provider: SOURCE,
    docsUrl: SOURCE_URL,
    freshness: "delayed",
    liveTradingEnabled: false,
    requestsLast24h: requestsInLastDay(),
    dailyBudget: dailyBudget(),
    cacheSeconds: { quote: Math.round(quoteTtlMs() / 1000), series: Math.round(seriesTtlMs() / 1000) },
  };
}

function provenance(): DataProvenance {
  return {
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    freshness: PREMIUM_INTRADAY ? "real-time" : "delayed",
    liveTradingEnabled: false,
  };
}

function normaliseSymbol(raw: unknown): string {
  if (typeof raw !== "string") throw new MarketDataError("bad_symbol", "A ticker symbol is required.");
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-:]{1,24}$/.test(symbol)) {
    throw new MarketDataError("bad_symbol", "Symbol must be 1-24 characters of letters, digits, '.', '-' or ':'.");
  }
  return symbol;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (cleaned === "" || cleaned.toLowerCase() === "none" || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Alpha Vantage reports problems in the *body* with HTTP 200:
 * `Note` (rate limit), `Information` (invalid key / premium), `Error Message`.
 */
function raiseForProviderPayload(record: Record<string, unknown> | null, context: string): void {
  if (!record) throw new MarketDataError("malformed", `${SOURCE} returned an unreadable ${context} payload.`);
  const note = typeof record.Note === "string" ? record.Note : null;
  const information = typeof record.Information === "string" ? record.Information : null;
  const errorMessage = typeof record["Error Message"] === "string" ? record["Error Message"] : null;

  if (errorMessage) {
    throw new MarketDataError("bad_symbol", `Market data request rejected: ${context}. ${errorMessage}`);
  }
  if (note && /rate limit|per day|per minute|call frequency|spreading out/i.test(note)) {
    throw new MarketDataError(
      "rate_limit",
      `${SOURCE} daily/minute request limit reached. Cached values remain available; try again later.`,
    );
  }
  if (information) {
    // Order matters: the throttle notice also mentions "premium", so an
    // invalid-key test must run first or every rate limit would look like a bad
    // credential.
    if (/invalid api key|apikey is invalid|invalid or incorrect|claim your free api key|not entitled/i.test(information)) {
      throw new MarketDataError("invalid_key", `${SOURCE} rejected the credential.`);
    }
    if (/premium|rate limit|spreading out|per day|per second|per minute|call frequency|subscribe/i.test(information)) {
      throw new MarketDataError(
        "rate_limit",
        `${SOURCE} request limit reached (free keys allow ~1 request/second and ~25/day). ` +
          "Cached values remain available; try again shortly.",
      );
    }
    throw new MarketDataError("rate_limit", `${SOURCE} returned an informational limit message.`);
  }
}

/** One paced, classified request to Alpha Vantage using a specific key. */
async function singleAlphaVantageCall(
  apiKey: string,
  params: Record<string, string>,
  context: string,
): Promise<Record<string, unknown>> {
  const url = `${BASE}/query?${new URLSearchParams({ ...params, apikey: apiKey })}`;

  await paceUpstreamCall();
  requestLog.push(Date.now());
  const { response, clear } = await fetchWithTimeout(url, { method: "GET" }, requestTimeoutMs());
  const text = await response.text();
  clear();

  if (!response.ok) {
    throw new MarketDataError(
      response.status === 401 || response.status === 403 ? "invalid_key" : "unavailable",
      `${SOURCE} responded with HTTP ${response.status} for ${context}.`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = text.trim() === "" ? null : JSON.parse(text);
  } catch {
    throw new MarketDataError("malformed", `${SOURCE} returned a non-JSON ${context} payload.`);
  }

  const record = asRecord(json);
  raiseForProviderPayload(record, context);
  if (!record) throw new MarketDataError("malformed", `${SOURCE} returned an empty ${context} payload.`);
  return record;
}

async function callAlphaVantage(params: Record<string, string>, context: string): Promise<Record<string, unknown>> {
  const pool = keyPool();
  if (!pool.configured) {
    throw new MarketDataError(
      "not_configured",
      "Market data is not configured. Set ALPHA_VANTAGE_API_KEY in Replit Secrets.",
    );
  }
  if (requestsInLastDay() >= dailyBudget()) {
    throw new MarketDataError(
      "budget_exhausted",
      `Local market-data safety budget reached (${dailyBudget()} upstream calls in 24h). ` +
        "Cached values remain available.",
    );
  }

  const keys = pool.rotation();
  if (keys.length === 0) {
    throw new MarketDataError("not_configured", "No market data credential is available.");
  }

  // Two nested loops: the inner one rotates credentials, the outer one retries
  // the whole rotation after a *transient* rate limit. Alpha Vantage free keys
  // allow roughly one request per second, so a burst legitimately needs a retry
  // rather than being reported as a hard failure.
  const rounds = rateLimitRounds();
  let lastError: unknown = null;

  for (let round = 0; round < rounds; round += 1) {
    if (round > 0) await sleep(rateLimitBackoffMs());

    for (let i = 0; i < keys.length; i += 1) {
      try {
        const record = await singleAlphaVantageCall(keys[i], params, context);
        return record;
      } catch (err) {
        lastError = err;
        const kind = err instanceof MarketDataError ? err.kind : "unavailable";
        // Credential-shaped failures are worth trying with the next key.
        if (kind === "invalid_key" || kind === "rate_limit") continue;
        if (err instanceof MarketDataError) throw err;
        throw new MarketDataError("unavailable", `Could not reach ${SOURCE} for ${context}.`);
      }
    }

    const kind = lastError instanceof MarketDataError ? lastError.kind : null;
    // Only a rate limit is worth another whole round; a bad key will stay bad.
    if (kind !== "rate_limit") break;
  }

  throw lastError instanceof MarketDataError
    ? lastError
    : new MarketDataError("unavailable", `${SOURCE} request failed for ${context}.`);
}

/** TTL cache plus single-flight de-duplication. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function parseGlobalQuote(record: Record<string, unknown>): Omit<MarketQuote, keyof DataProvenance> {
  const quote = asRecord(record["Global Quote"]);
  if (!quote) {
    throw new MarketDataError("bad_symbol", "No quote data returned for that symbol. Check the ticker.");
  }
  const symbol = typeof quote["01. symbol"] === "string" ? quote["01. symbol"] : "";
  const price = toNumber(quote["05. price"]);
  const previousClose = toNumber(quote["08. previous close"]);
  const change = toNumber(quote["09. change"]);
  const changePercent = toNumber(quote["10. change percent"]);

  if (!symbol || price === null) {
    throw new MarketDataError("bad_symbol", "The provider returned an incomplete quote for that symbol.");
  }

  return {
    symbol,
    price,
    open: toNumber(quote["02. open"]),
    high: toNumber(quote["03. high"]),
    low: toNumber(quote["04. low"]),
    previousClose,
    change,
    changePercent,
    volume: toNumber(quote["06. volume"]),
    latestTradingDay: typeof quote["07. latest trading day"] === "string" ? quote["07. latest trading day"] : null,
  };
}

/** Latest available price for one symbol. Cached; never presented as real-time. */
export async function getQuote(rawSymbol: string): Promise<MarketQuote> {
  const symbol = normaliseSymbol(rawSymbol);
  return cached(`quote:${symbol}`, quoteTtlMs(), async () => {
    const record = await callAlphaVantage({ function: "GLOBAL_QUOTE", symbol }, `quote for ${symbol}`);
    return { ...parseGlobalQuote(record), ...provenance() };
  });
}

/** Daily OHLCV series (most recent `outputsize` sessions). */
export async function getDailySeries(rawSymbol: string, compact = true): Promise<DailySeries> {
  const symbol = normaliseSymbol(rawSymbol);
  const size = compact ? "compact" : "full";
  return cached(`daily:${symbol}:${size}`, seriesTtlMs(), async () => {
    const record = await callAlphaVantage(
      { function: "TIME_SERIES_DAILY", symbol, outputsize: size },
      `daily series for ${symbol}`,
    );
    const series = asRecord(record["Time Series (Daily)"]);
    if (!series) {
      throw new MarketDataError("bad_symbol", "No daily history returned for that symbol.");
    }
    const points: DailyPoint[] = Object.entries(series)
      .map(([date, raw]) => {
        const row = asRecord(raw);
        return {
          date,
          open: toNumber(row?.["1. open"]) ?? 0,
          high: toNumber(row?.["2. high"]) ?? 0,
          low: toNumber(row?.["3. low"]) ?? 0,
          close: toNumber(row?.["4. close"]) ?? 0,
          volume: toNumber(row?.["5. volume"]) ?? 0,
        };
      })
      .filter((point) => point.close > 0)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, compact ? 100 : 5000);

    return { symbol, points, ...provenance() };
  });
}

/** Spot FX rate, e.g. USD → NPR. */
export async function getFxRate(rawFrom: string, rawTo: string): Promise<FxRate> {
  const from = normaliseSymbol(rawFrom);
  const to = normaliseSymbol(rawTo);
  return cached(`fx:${from}:${to}`, seriesTtlMs(), async () => {
    const record = await callAlphaVantage(
      { function: "CURRENCY_EXCHANGE_RATE", from_currency: from, to_currency: to },
      `FX rate ${from}/${to}`,
    );
    const rate = asRecord(record["Realtime Currency Exchange Rate"]);
    if (!rate) {
      throw new MarketDataError("unsupported", `No FX rate available for ${from}/${to}. Use ISO currency codes.`);
    }
    return {
      from,
      to,
      rate: toNumber(rate["5. Exchange Rate"]),
      lastRefreshed: typeof rate["6. Last Refreshed"] === "string" ? rate["6. Last Refreshed"] : null,
      ...provenance(),
    };
  });
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
  matchScore: number | null;
}

/** Resolves free text ("apple", "tesla") to real tickers via SYMBOL_SEARCH. */
export async function searchSymbols(rawKeywords: string): Promise<SymbolMatch[]> {
  const keywords = typeof rawKeywords === "string" ? rawKeywords.trim() : "";
  if (keywords === "") throw new MarketDataError("bad_symbol", "A search term is required.");
  return cached(`symbols:${keywords.toLowerCase()}`, seriesTtlMs(), async () => {
    const record = await callAlphaVantage(
      { function: "SYMBOL_SEARCH", keywords },
      `symbol search for "${keywords}"`,
    );
    const matches = Array.isArray(record.bestMatches) ? record.bestMatches : [];
    return matches
      .map((raw) => {
        const row = asRecord(raw);
        const symbol = typeof row?.["1. symbol"] === "string" ? row["1. symbol"] : "";
        if (symbol === "") return null;
        return {
          symbol,
          name: typeof row?.["2. name"] === "string" ? row["2. name"] : "",
          type: typeof row?.["3. type"] === "string" ? row["3. type"] : "",
          region: typeof row?.["4. region"] === "string" ? row["4. region"] : "",
          currency: typeof row?.["8. currency"] === "string" ? row["8. currency"] : "",
          matchScore: toNumber(row?.["9. matchScore"]),
        } satisfies SymbolMatch;
      })
      .filter((match): match is SymbolMatch => match !== null)
      .slice(0, 10);
  });
}

/**
 * Accepts either a ticker or a plain-English name and returns a real quote.
 *
 * "AAPL" hits the quote endpoint directly; "apple" falls back to a symbol
 * search so the agent does not need to guess tickers. If nothing resolves we
 * throw — we never fabricate a price.
 */
export async function resolveQuote(input: string): Promise<{ quote: MarketQuote; resolvedFrom: string | null }> {
  const text = typeof input === "string" ? input.trim() : "";
  if (text === "") throw new MarketDataError("bad_symbol", "A ticker or company name is required.");

  // The free tier only allows ~25 calls/day, so we do not spend one guessing:
  // ticker-shaped input hits the quote endpoint first, anything else is treated
  // as a name and goes straight to symbol search.
  // 1-4 characters is the overwhelming majority of listed tickers, and a short
  // all-caps string is almost never a company name. Anything longer is treated
  // as a name, which saves a wasted quote call every time.
  const upper = text.toUpperCase();
  const looksLikeTicker = /^[A-Z]{1,4}$/.test(upper) || /^[A-Z]{1,4}[.\-][A-Z0-9]{1,4}$/.test(upper);

  if (looksLikeTicker) {
    try {
      return { quote: await getQuote(text), resolvedFrom: null };
    } catch (err) {
      if (!(err instanceof MarketDataError) || err.kind !== "bad_symbol") throw err;
    }
  }

  const matches = await searchSymbols(text);
  const best = matches[0];
  if (best) {
    return { quote: await getQuote(best.symbol), resolvedFrom: best.name || best.symbol };
  }

  // A name search can come back empty while the string is still a valid symbol.
  if (!looksLikeTicker) {
    return { quote: await getQuote(text), resolvedFrom: null };
  }
  throw new MarketDataError("bad_symbol", `No listed instrument matched "${text}".`);
}

/** Test helper: clears the cache so a unit test starts from a clean slate. */
export function resetMarketCache(): void {
  cache.clear();
  inFlight.clear();
  requestLog.length = 0;
  lastCallAt = 0;
  callChain = Promise.resolve();
}
