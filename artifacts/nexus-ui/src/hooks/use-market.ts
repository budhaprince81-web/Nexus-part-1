import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

export interface MarketStatus {
  configured: boolean;
  provider: string;
  docsUrl: string;
  freshness: string;
  liveTradingEnabled: boolean;
  requestsLast24h: number;
  dailyBudget: number;
  cacheSeconds: { quote: number; series: number };
  disclaimer?: string;
}

export interface MarketQuote {
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
  /** Provenance — always rendered next to the number. */
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  freshness: string;
  liveTradingEnabled: boolean;
}

/** Whether a real market-data provider is configured (never returns a key). */
export function useMarketStatus() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await apiGet<MarketStatus>('/api/nexus/market/status');
        if (!cancelled) setStatus(payload);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, loading };
}

/**
 * Looks up one quote on demand. Deliberately *not* polled: the provider's free
 * tier is small, and a delayed number does not need to be re-fetched.
 */
export function useQuote() {
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(async (symbol: string) => {
    const trimmed = symbol.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      setQuote(await apiGet<MarketQuote>(`/api/nexus/market/quote?symbol=${encodeURIComponent(trimmed)}`, 20000));
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : 'Quote lookup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setQuote(null);
    setError(null);
  }, []);

  return { quote, error, loading, lookup, clear };
}
