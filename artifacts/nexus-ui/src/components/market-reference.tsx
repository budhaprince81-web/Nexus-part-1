/**
 * Market reference panel.
 *
 * Shows a *real* quote from the configured data provider, always accompanied by
 * its source, fetch time and freshness. The panel can copy a price into the
 * calculator, but it can never place an order — there is no order path at all.
 *
 * Copy is kept local to this component (bilingual) so the trading page's own
 * translation table stays untouched.
 */

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Info, LineChart, Radio, Search } from 'lucide-react';
import { useLangContext } from '@/hooks/use-language';
import { useMarketStatus, useQuote } from '@/hooks/use-market';

const COPY = {
  en: {
    tag: 'LIVE MARKET REFERENCE',
    title: 'Real quotes, honestly labelled.',
    body: 'Look up an instrument to seed your scenario. Data comes from a third-party provider and may be delayed.',
    placeholder: 'Symbol or name (e.g. AAPL, Bitcoin)',
    lookup: 'Look up',
    looking: 'Looking up…',
    source: 'Source',
    fetched: 'Fetched',
    freshness: 'Freshness',
    delayed: 'DELAYED — not a real-time feed',
    realtime: 'REAL-TIME',
    lastDay: 'Trading day',
    change: 'Change',
    useAs: 'Use as',
    entry: 'Entry',
    stop: 'Stop',
    target: 'Target',
    notConfigured: 'No market data provider is configured on the server. Set the provider key in Replit Secrets.',
    disabled: 'Lookups are disabled until a provider is configured.',
    guardrail: 'Read-only. This system cannot place, modify or cancel orders, and nothing here is investment advice.',
    budget: 'Upstream calls in the last 24h',
    empty: 'No quote loaded yet.',
  },
  ne: {
    tag: 'प्रत्यक्ष बजार सन्दर्भ',
    title: 'वास्तविक मूल्य, स्पष्ट रूपमा लेबल गरिएको।',
    body: 'तपाईंको परिदृश्यका लागि उपकरण खोज्नुहोस्। डाटा तेस्रो पक्षबाट आउँछ र ढिलो हुन सक्छ।',
    placeholder: 'सिम्बल वा नाम (जस्तै AAPL)',
    lookup: 'खोज्नुहोस्',
    looking: 'खोज्दै…',
    source: 'स्रोत',
    fetched: 'प्राप्त',
    freshness: 'ताजापन',
    delayed: 'ढिलो — वास्तविक-समय फिड होइन',
    realtime: 'वास्तविक-समय',
    lastDay: 'कारोबार दिन',
    change: 'परिवर्तन',
    useAs: 'प्रयोग गर्नुहोस्',
    entry: 'प्रवेश',
    stop: 'स्टप',
    target: 'लक्ष्य',
    notConfigured: 'सर्भरमा बजार डाटा प्रदायक कन्फिगर गरिएको छैन।',
    disabled: 'प्रदायक कन्फिगर नभएसम्म खोज अक्षम छ।',
    guardrail: 'पढ्ने-मात्र। यो प्रणालीले अर्डर गर्न, परिवर्तन गर्न वा रद्द गर्न सक्दैन।',
    budget: 'पछिल्लो २४ घण्टामा अपस्ट्रिम कलहरू',
    empty: 'अझै कुनै मूल्य लोड गरिएको छैन।',
  },
} as const;

function format(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface MarketReferenceProps {
  /** Copies a looked-up price into one specific calculator field. */
  onUsePrice: (field: 'entry' | 'stop' | 'target', price: number) => void;
}

export default function MarketReference({ onUsePrice }: MarketReferenceProps) {
  const { lang } = useLangContext();
  const copy = COPY[lang === 'ne' ? 'ne' : 'en'];
  const { status, loading: statusLoading } = useMarketStatus();
  const { quote, error, loading, lookup, clear } = useQuote();
  const [symbol, setSymbol] = useState('');

  const freshnessLabel = status?.freshness === 'real-time' ? copy.realtime : copy.delayed;
  const up = (quote?.change ?? 0) >= 0;

  return (
    <section className="cyber-panel p-4 sm:p-5" aria-labelledby="market-ref-heading">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-primary/60">
            <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.tag}
          </p>
          <h2 id="market-ref-heading" className="mt-1 text-lg font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{copy.body}</p>
        </div>
        {status && (
          <div className="flex flex-col items-start gap-1 font-mono text-[10px] text-muted-foreground sm:items-end">
            <span className="inline-flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-primary/70" aria-hidden="true" />
              {status.configured ? `${status.provider} · ${freshnessLabel}` : copy.disabled}
            </span>
            {status.configured && (
              <span>{copy.budget}: {status.requestsLast24h}/{status.dailyBudget}</span>
            )}
          </div>
        )}
      </div>

      {!statusLoading && status && !status.configured ? (
        <p className="flex items-start gap-2 border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200/90">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {copy.notConfigured}
        </p>
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup(symbol);
            }}
          >
            <div className="min-w-[200px] flex-1">
              <label htmlFor="market-symbol" className="sr-only">{copy.placeholder}</label>
              <input
                id="market-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                placeholder={copy.placeholder}
                autoComplete="off"
                className="w-full border border-primary/20 bg-background/60 px-3 py-2 font-mono text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <button
              type="submit"
              disabled={loading || symbol.trim() === ''}
              className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 px-4 py-2 font-mono text-xs tracking-wider text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {loading ? copy.looking : copy.lookup}
            </button>
            {quote && (
              <button
                type="button"
                onClick={clear}
                className="border border-primary/15 px-3 py-2 font-mono text-xs text-muted-foreground transition hover:text-foreground"
              >
                ×
              </button>
            )}
          </form>

          {error && (
            <p role="alert" className="mt-3 border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </p>
          )}

          {quote && (
            <div className="mt-4 border-t border-primary/10 pt-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-mono text-lg font-semibold text-foreground">{quote.symbol}</span>
                <span className="font-mono text-2xl font-bold text-foreground">{format(quote.price)}</span>
                {quote.change !== null && (
                  <span className={`inline-flex items-center gap-1 font-mono text-sm ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    {up ? '+' : ''}{format(quote.change)} ({format(quote.changePercent)}%)
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-primary/40 uppercase">{copy.source}</dt>
                  <dd>
                    <a href={quote.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted hover:text-foreground">
                      {quote.source}
                    </a>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-primary/40 uppercase">{copy.freshness}</dt>
                  <dd className={quote.freshness === 'real-time' ? 'text-emerald-300' : 'text-amber-300/90'}>
                    {quote.freshness === 'real-time' ? copy.realtime : copy.delayed}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-primary/40 uppercase">{copy.fetched}</dt>
                  <dd><time dateTime={quote.fetchedAt}>{new Date(quote.fetchedAt).toLocaleString()}</time></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-primary/40 uppercase">{copy.lastDay}</dt>
                  <dd>{quote.latestTradingDay ?? '—'}</dd>
                </div>
              </dl>

              {quote.price !== null && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase text-primary/40">{copy.useAs}</span>
                  {([
                    ['entry', copy.entry],
                    ['stop', copy.stop],
                    ['target', copy.target],
                  ] as const).map(([field, label]) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => onUsePrice(field, quote.price as number)}
                      className="border border-primary/20 px-3 py-1.5 font-mono text-[11px] text-foreground/90 transition hover:border-primary/40 hover:bg-primary/10"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/50" aria-hidden="true" />
                {copy.guardrail}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
