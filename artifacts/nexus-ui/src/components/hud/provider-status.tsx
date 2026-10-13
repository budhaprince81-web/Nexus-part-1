import React, { useState } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { Cpu, RefreshCw, Zap, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  probeProvider,
  reloadProviders,
  useProviders,
  type ProviderId,
  type ProviderStatus,
} from '@/hooks/use-providers';

function healthOf(provider: ProviderStatus): 'offline' | 'ready' | 'degraded' {
  if (!provider.configured) return 'offline';
  if (provider.metrics.failures > 0 && !provider.metrics.available) return 'degraded';
  return 'ready';
}

function HealthDot({ health }: { health: 'offline' | 'ready' | 'degraded' }) {
  const color =
    health === 'ready' ? 'bg-emerald-400' : health === 'degraded' ? 'bg-amber-400' : 'bg-primary/25';
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {health === 'ready' && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className={cn('relative inline-flex rounded-full h-2 w-2', color)} />
    </span>
  );
}

/**
 * Live provider panel: which vendors are configured, which models each tier
 * maps to, and real latency/token/error telemetry. Probes a provider on demand
 * with a tiny real request — it never reports success without a real response.
 */
export function ProviderStatusPanel({ compact = false }: { compact?: boolean }) {
  const { data, error, loading, refresh } = useProviders(compact ? 30000 : 15000);
  const [probing, setProbing] = useState<ProviderId | null>(null);
  const [probeResult, setProbeResult] = useState<Record<string, string>>({});
  const [reloading, setReloading] = useState(false);

  const handleProbe = async (id: ProviderId) => {
    setProbing(id);
    try {
      const result = await probeProvider(id);
      setProbeResult((current) => ({
        ...current,
        [id]: result.ok
          ? `OK · ${result.latencyMs}ms · ${result.model ?? 'model'}`
          : `FAILED · ${result.errorKind ?? 'error'} · ${result.error ?? 'unknown'}`,
      }));
    } catch (err) {
      setProbeResult((current) => ({
        ...current,
        [id]: `FAILED · ${err instanceof Error ? err.message : 'unknown error'}`,
      }));
    } finally {
      setProbing(null);
      void refresh();
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await reloadProviders();
      await refresh();
    } finally {
      setReloading(false);
    }
  };

  return (
    <CyberPanel className={cn('flex flex-col gap-3', compact && 'gap-2')}>
      <div className="flex items-center justify-between border-b border-primary/20 pb-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <h3 className="font-mono text-xs text-primary uppercase tracking-widest">
            AI Providers
          </h3>
        </div>
        <button
          onClick={() => void handleReload()}
          disabled={reloading}
          className="text-primary/40 hover:text-primary transition-colors disabled:opacity-40"
          title="Re-read provider configuration from the server environment"
          aria-label="Reload provider configuration"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', reloading && 'animate-spin')} />
        </button>
      </div>

      {loading && !data && (
        <div className="font-mono text-[10px] text-primary/40 uppercase animate-pulse">
          Scanning provider mesh…
        </div>
      )}

      {error && !data && (
        <div className="font-mono text-[10px] text-destructive uppercase flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {error}
        </div>
      )}

      {data && (
        <>
          {!data.aiAvailable && (
            <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/5 p-2">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="font-mono text-[10px] text-amber-300/90 leading-relaxed">
                No AI provider configured. Add one of{' '}
                {data.providers
                  .filter((provider) => provider.id !== 'mock')
                  .map((provider) => provider.envVar)
                  .join(', ')}{' '}
                in Replit Secrets to enable reasoning.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {data.providers
              .filter((provider) => provider.id !== 'mock' || data.mockProviderEnabled)
              .map((provider) => {
                const health = healthOf(provider);
                const isDefault = data.defaultProvider === provider.id;
                return (
                  <div
                    key={provider.id}
                    className="flex flex-col gap-1 border border-primary/10 hover:border-primary/30 px-2 py-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <HealthDot health={health} />
                        <span className="font-mono text-[11px] text-primary/90 truncate">
                          {provider.label}
                        </span>
                        {isDefault && <CyberBadge variant="success">DEFAULT</CyberBadge>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {provider.configured ? (
                          <span className="font-mono text-[9px] text-primary/40">
                            {provider.metrics.avgLatencyMs !== null
                              ? `${provider.metrics.avgLatencyMs}ms`
                              : 'idle'}
                          </span>
                        ) : (
                          <span className="font-mono text-[9px] text-primary/30 uppercase">
                            {provider.envVar}
                          </span>
                        )}
                        <button
                          onClick={() => void handleProbe(provider.id)}
                          disabled={!provider.configured || probing !== null}
                          className="text-primary/40 hover:text-primary transition-colors disabled:opacity-30"
                          title={provider.configured ? 'Send a real test request' : 'Not configured'}
                          aria-label={`Test ${provider.label}`}
                        >
                          <Zap className={cn('w-3 h-3', probing === provider.id && 'animate-pulse')} />
                        </button>
                      </div>
                    </div>

                    {!compact && (
                      <div className="font-mono text-[9px] text-primary/35 truncate">
                        {provider.models.fast} · {provider.models.reasoning}
                        {provider.metrics.successes > 0 && (
                          <>
                            {' '}
                            · {provider.metrics.successes} ok · {provider.metrics.inputTokens +
                              provider.metrics.outputTokens}{' '}
                            tok
                          </>
                        )}
                        {provider.metrics.failures > 0 && ` · ${provider.metrics.failures} failed`}
                      </div>
                    )}

                    {probeResult[provider.id] && (
                      <div
                        className={cn(
                          'font-mono text-[9px] truncate',
                          probeResult[provider.id].startsWith('OK')
                            ? 'text-emerald-400'
                            : 'text-destructive',
                        )}
                      >
                        {probeResult[provider.id]}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {!compact && (
            <div className="border-t border-primary/10 pt-2 flex flex-col gap-1">
              <div className="flex items-center justify-between font-mono text-[9px] text-primary/40 uppercase">
                <span>Fallback chain</span>
                <span>
                  {data.fallbackProviders.length > 0
                    ? data.fallbackProviders.join(' → ')
                    : 'auto (any configured)'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[9px] text-primary/30 uppercase">
                <CheckCircle2 className="w-3 h-3 text-emerald-500/60" />
                Keys stay server-side; this panel never receives credential values.
              </div>
            </div>
          )}
        </>
      )}
    </CyberPanel>
  );
}
