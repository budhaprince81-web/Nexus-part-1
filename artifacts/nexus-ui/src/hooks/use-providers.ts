import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'groq'
  | 'openrouter'
  | 'gemini'
  | 'ollama'
  | 'mock';

export type ModelTier = 'fast' | 'balanced' | 'reasoning';

export interface ProviderMetrics {
  requests: number;
  successes: number;
  failures: number;
  errorsByKind: Record<string, number>;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt: string | null;
  lastError: string | null;
  available: boolean;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  envVar: string;
  docsUrl: string;
  models: Record<ModelTier, string>;
  capabilities: { streaming: boolean; vision: boolean; jsonMode: boolean };
  metrics: ProviderMetrics;
}

export interface ProvidersPayload {
  providers: ProviderStatus[];
  configuredProviders: ProviderId[];
  defaultProvider: ProviderId | null;
  fallbackProviders: ProviderId[];
  mockProviderEnabled: boolean;
  aiAvailable: boolean;
}

export interface ProbeResult {
  provider: ProviderId;
  ok: boolean;
  latencyMs: number | null;
  model: string | null;
  error: string | null;
  errorKind: string | null;
}

/**
 * Polls provider configuration and telemetry. The endpoint reports *whether*
 * a provider is configured and never returns credential values.
 */
export function useProviders(pollMs = 15000) {
  const [data, setData] = useState<ProvidersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const payload = await apiGet<ProvidersPayload>('/api/providers');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load provider status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (pollMs <= 0) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh };
}

export function probeProvider(provider: ProviderId): Promise<ProbeResult> {
  return apiPost<ProbeResult>('/api/providers/probe', { provider }, 45000);
}

export function reloadProviders(): Promise<ProvidersPayload> {
  return apiPost<ProvidersPayload>('/api/providers/reload');
}
