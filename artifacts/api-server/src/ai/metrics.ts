/**
 * In-memory provider telemetry: latency, token usage, error counts and
 * availability. Deliberately process-local (no prompts, no responses, and no
 * credentials are ever stored here) — it powers the provider status panel.
 */

import type { ProviderId, ProviderMetrics, Usage } from "./types.ts";

interface InternalMetrics {
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
  consecutiveFailures: number;
}

const store = new Map<ProviderId, InternalMetrics>();

function blank(): InternalMetrics {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    errorsByKind: {},
    lastLatencyMs: null,
    avgLatencyMs: null,
    inputTokens: 0,
    outputTokens: 0,
    lastUsedAt: null,
    lastError: null,
    consecutiveFailures: 0,
  };
}

function entry(provider: ProviderId): InternalMetrics {
  let existing = store.get(provider);
  if (!existing) {
    existing = blank();
    store.set(provider, existing);
  }
  return existing;
}

export function recordAttempt(provider: ProviderId): void {
  entry(provider).requests += 1;
}

export function recordSuccess(provider: ProviderId, latencyMs: number, usage: Usage): void {
  const metrics = entry(provider);
  metrics.successes += 1;
  metrics.consecutiveFailures = 0;
  metrics.lastLatencyMs = latencyMs;
  metrics.lastUsedAt = new Date().toISOString();
  // Exponentially weighted moving average keeps recent latency meaningful.
  metrics.avgLatencyMs =
    metrics.avgLatencyMs === null
      ? latencyMs
      : Math.round(metrics.avgLatencyMs * 0.7 + latencyMs * 0.3);
  if (usage.inputTokens) metrics.inputTokens += usage.inputTokens;
  if (usage.outputTokens) metrics.outputTokens += usage.outputTokens;
}

export function recordFailure(provider: ProviderId, kind: string, message: string): void {
  const metrics = entry(provider);
  metrics.failures += 1;
  metrics.consecutiveFailures += 1;
  metrics.errorsByKind[kind] = (metrics.errorsByKind[kind] ?? 0) + 1;
  metrics.lastError = message;
  metrics.lastUsedAt = new Date().toISOString();
}

export function snapshot(provider: ProviderId, configured: boolean): ProviderMetrics {
  const metrics = store.get(provider) ?? blank();
  return {
    requests: metrics.requests,
    successes: metrics.successes,
    failures: metrics.failures,
    errorsByKind: { ...metrics.errorsByKind },
    lastLatencyMs: metrics.lastLatencyMs,
    avgLatencyMs: metrics.avgLatencyMs,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    lastUsedAt: metrics.lastUsedAt,
    lastError: metrics.lastError,
    // A provider counts as available when it is configured and not in a
    // sustained failure streak.
    available: configured && metrics.consecutiveFailures < 3,
  };
}

export function resetMetrics(): void {
  store.clear();
}
