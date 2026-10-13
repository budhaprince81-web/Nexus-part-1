/**
 * Market-data tests.
 *
 * Every case drives the real service against a stubbed `fetch`, which is the
 * exact boundary a real Alpha Vantage call crosses. The point of most of these
 * is that the service must *never* invent or mislabel a price.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { MarketDataError, getQuote, marketDataStatus, resetMarketCache, resolveQuote, searchSymbols } from "./market-data.ts";

type FetchArgs = { url: string; init: RequestInit };

function installFetch(handler: (args: FetchArgs) => Response | Promise<Response>): FetchArgs[] {
  const calls: FetchArgs[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const args: FetchArgs = { url, init: init ?? {} };
    calls.push(args);
    return handler(args);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GLOBAL_QUOTE = {
  "Global Quote": {
    "01. symbol": "AAPL",
    "02. open": "228.3100",
    "03. high": "229.2850",
    "04. low": "224.7700",
    "05. price": "227.0200",
    "06. volume": "2764896",
    "07. latest trading day": "2026-10-12",
    "08. previous close": "225.0000",
    "09. change": "2.0200",
    "10. change percent": "0.8978%",
  },
};

beforeEach(() => {
  resetMarketCache();
  // Pacing exists to respect the provider's ~1 req/second free-tier limit; the
  // tests stub the network, so disable it to keep the suite fast.
  process.env.MARKET_MIN_INTERVAL_MS = "0";
  process.env.MARKET_RATE_LIMIT_BACKOFF_MS = "1";
  delete process.env.MARKET_RATE_LIMIT_ROUNDS;
  process.env.ALPHA_VANTAGE_API_KEY = "TESTKEY1";
  delete process.env.MARKET_DAILY_BUDGET;
  delete process.env.MARKET_QUOTE_TTL_MS;
});

test("status reports configured without leaking the key", () => {
  const status = marketDataStatus();
  assert.equal(status.configured, true);
  assert.equal(status.liveTradingEnabled, false);
  assert.equal(status.freshness, "delayed");
  assert.equal(JSON.stringify(status).includes("TESTKEY1"), false);
});

test("getQuote parses a real payload and attaches provenance", async () => {
  const calls = installFetch(() => json(GLOBAL_QUOTE));
  const quote = await getQuote("aapl");

  assert.equal(calls.length, 1);
  assert.equal(quote.symbol, "AAPL");
  assert.equal(quote.price, 227.02);
  assert.equal(quote.previousClose, 225);
  assert.equal(quote.change, 2.02);
  assert.equal(quote.changePercent, 0.8978);
  assert.equal(quote.volume, 2764896);
  assert.equal(quote.latestTradingDay, "2026-10-12");
  // Provenance is mandatory, and this app can never trade.
  assert.equal(quote.source, "Alpha Vantage");
  assert.equal(quote.sourceUrl.startsWith("https://"), true);
  assert.equal(quote.freshness, "delayed");
  assert.equal(quote.liveTradingEnabled, false);
  assert.ok(!Number.isNaN(Date.parse(quote.fetchedAt)));
  // The symbol is upper-cased before it reaches the provider.
  assert.match(decodeURIComponent(calls[0].url), /symbol=AAPL/);
});

test("identical lookups are cached and never sent twice", async () => {
  const calls = installFetch(() => json(GLOBAL_QUOTE));
  await getQuote("AAPL");
  await getQuote("AAPL");
  assert.equal(calls.length, 1);
});

test("concurrent identical lookups share a single upstream request", async () => {
  const calls = installFetch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return json(GLOBAL_QUOTE);
  });
  const [a, b] = await Promise.all([getQuote("AAPL"), getQuote("AAPL")]);
  assert.equal(calls.length, 1);
  assert.equal(a.price, b.price);
});

test("a daily-limit Note becomes a rate_limit error, not a fake price", async () => {
  installFetch(() => json({ Note: "Thank you! Our standard API rate limit is 25 requests per day." }));
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.ok(err instanceof MarketDataError);
    assert.equal(err.kind, "rate_limit");
    return true;
  });
});

test("an invalid-key Information payload becomes invalid_key", async () => {
  installFetch(() => json({ Information: "the parameter apikey is invalid or incorrect" }));
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "invalid_key");
    return true;
  });
});

test("an unknown symbol surfaces as bad_symbol", async () => {
  installFetch(() => json({ "Error Message": "Invalid API call. Please retry or visit the documentation." }));
  await assert.rejects(getQuote("ZZZZ"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "bad_symbol");
    return true;
  });
});

test("a malformed numeric payload is rejected rather than silently zeroed", async () => {
  installFetch(() => json({ "Global Quote": { "01. symbol": "AAPL", "05. price": "" } }));
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "bad_symbol");
    return true;
  });
});

test("the second key in the pool is used when the first is rejected", async () => {
  process.env.ALPHA_VANTAGE_API_KEY = "BADKEY,GOODKEY";
  const calls = installFetch(({ url }) => {
    const key = new URL(url).searchParams.get("apikey");
    if (key === "BADKEY") return json({ Information: "the parameter apikey is invalid or incorrect" });
    return json(GLOBAL_QUOTE);
  });

  const quote = await getQuote("AAPL");
  assert.equal(quote.price, 227.02);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get("apikey"), "GOODKEY");
});

test("the local safety budget stops upstream calls before the quota is burned", async () => {
  process.env.MARKET_DAILY_BUDGET = "1";
  const calls = installFetch(() => json(GLOBAL_QUOTE));
  await getQuote("AAPL");
  await assert.rejects(getQuote("MSFT"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "budget_exhausted");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("searchSymbols maps best matches and tolerates junk rows", async () => {
  installFetch(() =>
    json({
      bestMatches: [
        { "1. symbol": "AAPL", "2. name": "Apple Inc", "3. type": "Equity", "4. region": "United States", "8. currency": "USD", "9. matchScore": "0.7273" },
        { "2. name": "no symbol row" },
      ],
    }),
  );
  const matches = await searchSymbols("apple");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].symbol, "AAPL");
  assert.equal(matches[0].matchScore, 0.7273);
});

test("resolveQuote falls back from a name to the best matching ticker", async () => {
  const calls = installFetch(({ url }) => {
    const fn = new URL(url).searchParams.get("function");
    if (fn === "GLOBAL_QUOTE") {
      const symbol = new URL(url).searchParams.get("symbol");
      if (symbol !== "AAPL") return json({ "Error Message": "Invalid API call." });
      return json(GLOBAL_QUOTE);
    }
    return json({ bestMatches: [{ "1. symbol": "AAPL", "2. name": "Apple Inc" }] });
  });

  const { quote, resolvedFrom } = await resolveQuote("apple");
  assert.equal(quote.symbol, "AAPL");
  assert.equal(resolvedFrom, "Apple Inc");
  assert.equal(calls.length, 2);
});

test("a ticker-shaped input goes straight to the quote endpoint (one call)", async () => {
  const calls = installFetch(() => json(GLOBAL_QUOTE));
  const { quote, resolvedFrom } = await resolveQuote("AAPL");
  assert.equal(quote.symbol, "AAPL");
  assert.equal(resolvedFrom, null);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("function"), "GLOBAL_QUOTE");
});

test("resolveQuote refuses when nothing matches instead of guessing", async () => {
  installFetch(({ url }) => {
    const fn = new URL(url).searchParams.get("function");
    if (fn === "GLOBAL_QUOTE") return json({ "Error Message": "Invalid API call." });
    return json({ bestMatches: [] });
  });
  await assert.rejects(resolveQuote("not-a-real-company-xyz"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "bad_symbol");
    return true;
  });
});

test("a transient rate limit is retried (paced) instead of failing the call", async () => {
  process.env.MARKET_RATE_LIMIT_BACKOFF_MS = "1";
  let attempt = 0;
  const calls = installFetch(() => {
    attempt += 1;
    if (attempt === 1) {
      return json({ Information: "Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second)." });
    }
    return json(GLOBAL_QUOTE);
  });

  const quote = await getQuote("AAPL");
  assert.equal(quote.price, 227.02);
  assert.equal(calls.length, 2);
});

test("a persistent rate limit still surfaces as rate_limit after bounded retries", async () => {
  process.env.MARKET_RATE_LIMIT_BACKOFF_MS = "1";
  process.env.MARKET_RATE_LIMIT_ROUNDS = "2";
  const calls = installFetch(() =>
    json({ Information: "Thank you for using Alpha Vantage! (1 request per second)" }),
  );
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "rate_limit");
    return true;
  });
  // Bounded: one call per round, no unbounded retry loop.
  assert.equal(calls.length, 2);
});

test("a missing credential produces not_configured, never a fabricated quote", async () => {
  process.env.ALPHA_VANTAGE_API_KEY = "";
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "not_configured");
    return true;
  });
});

test("an HTTP 401 becomes invalid_key", async () => {
  installFetch(() => json({}, 401));
  await assert.rejects(getQuote("AAPL"), (err: unknown) => {
    assert.equal((err as MarketDataError).kind, "invalid_key");
    return true;
  });
});
