/**
 * Process-wide agent runtime instance wired to the real database, the real
 * provider engine, the real sandbox executor and the real data providers.
 *
 * The data tools are wired here (not inside `agent-runtime.ts`) so the runtime
 * itself stays dependency-free and unit-testable without network access.
 */

import { createAgentRuntime, type AgentRuntime } from "./agent-runtime.ts";
import { createDrizzleRunStore } from "./agent-store.ts";
import { executeSandbox } from "../lib/sandbox-exec.ts";
import { formatUntrustedSources, searchArticles } from "../lib/news.ts";
import { MarketDataError, resolveQuote } from "../lib/market-data.ts";
import { logNexusEvent } from "../routes/nexus/logs";

function num(value: number | null, digits = 2): string {
  return value === null ? "unavailable" : value.toFixed(digits);
}

/**
 * Formats a real quote for a step's output, with provenance attached.
 * If the instrument cannot be resolved we say so instead of guessing.
 */
async function marketQuoteFor(input: string): Promise<string> {
  try {
    const { quote, resolvedFrom } = await resolveQuote(input);
    const direction = quote.change === null ? "" : quote.change >= 0 ? "up" : "down";
    return [
      `MARKET DATA — ${quote.freshness.toUpperCase()} · source: ${quote.source} (${quote.sourceUrl})`,
      `Fetched at ${quote.fetchedAt}`,
      `Instrument: ${quote.symbol}${resolvedFrom ? ` — resolved from "${input}" (${resolvedFrom})` : ""}`,
      `Latest trading day: ${quote.latestTradingDay ?? "unknown"}`,
      `Price: ${num(quote.price)}`,
      `Open / High / Low: ${num(quote.open)} / ${num(quote.high)} / ${num(quote.low)}`,
      `Previous close: ${num(quote.previousClose)}`,
      quote.change !== null
        ? `Change: ${direction} ${num(quote.change)} (${num(quote.changePercent)}%)`
        : "Change: unavailable",
      `Volume: ${quote.volume === null ? "unavailable" : quote.volume.toLocaleString("en-US")}`,
      "",
      "Caveats: third-party data, may be delayed or adjusted. Not investment advice.",
      "This system cannot place, modify or cancel orders.",
    ].join("\n");
  } catch (err) {
    if (err instanceof MarketDataError) return `MARKET DATA UNAVAILABLE (${err.kind}): ${err.message}`;
    return "MARKET DATA UNAVAILABLE: the market data provider could not be reached.";
  }
}

/** Fetches current articles and returns them as a boundary-marked untrusted block. */
async function newsSearchFor(query: string): Promise<string> {
  try {
    const result = await searchArticles(query, { pageSize: 6 });
    if (result.articles.length === 0) {
      return `No current articles matched "${query}" (source: ${result.source}).`;
    }
    return `${formatUntrustedSources(result)}\n\nRetrieved ${result.fetchedAt} via ${result.source}.`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "news retrieval failed";
    return `WEB ARTICLE RETRIEVAL UNAVAILABLE: ${message}`;
  }
}

let runtime: AgentRuntime | null = null;

export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    runtime = createAgentRuntime({
      store: createDrizzleRunStore(),
      runSandbox: (input) => executeSandbox(input),
      marketQuote: (symbol) => marketQuoteFor(symbol),
      newsSearch: (query) => newsSearchFor(query),
      log: (event) => {
        void logNexusEvent(event.level, event.message, "agents", event.meta).catch(() => undefined);
      },
    });
  }
  return runtime;
}
