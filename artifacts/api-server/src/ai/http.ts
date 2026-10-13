/**
 * HTTP helpers shared by every provider adapter: bounded request timeouts and
 * bounded exponential backoff with jitter. Nothing here retries indefinitely,
 * and non-retryable failures (auth, bad request, quota) surface immediately so
 * we never burn someone's quota on a doomed loop.
 */

import { classifyHttpStatus, isAbortError, ProviderError } from "./errors.ts";

export interface RetryPolicy {
  /** Number of *additional* attempts after the first one. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Hard ceiling for one HTTP attempt. */
  timeoutMs: number;
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Read on every request (not cached at import time) so that rotating a secret
 * or changing a limit takes effect without a restart.
 */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxRetries: intFromEnv("NEXUS_AI_MAX_RETRIES", 2, 0, 5),
    baseDelayMs: intFromEnv("NEXUS_AI_RETRY_BASE_MS", 300, 50, 5000),
    maxDelayMs: intFromEnv("NEXUS_AI_RETRY_MAX_MS", 4000, 100, 30000),
    timeoutMs: intFromEnv("NEXUS_AI_TIMEOUT_MS", 60000, 100, 300000),
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError({ provider: "engine", kind: "aborted", message: "Request aborted" }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError({ provider: "engine", kind: "aborted", message: "Request aborted" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter, honouring an explicit retry-after. */
export function backoffDelay(attempt: number, policy: RetryPolicy, retryAfterMs?: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs);
  }
  const exponential = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, policy.maxDelayMs);
  // Full jitter keeps a fleet of retries from synchronising into a thundering herd.
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

/**
 * Wraps `fetch` with a hard timeout. The returned response body can still be
 * consumed after the timeout aborts — for streams we expose the controller so
 * the caller can keep it alive while reading.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ response: Response; controller: AbortController; clear: () => void }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const clear = () => {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, controller, clear };
  } catch (err) {
    clear();
    if (timedOut) {
      throw new ProviderError({
        provider: "http",
        kind: "timeout",
        message: `Request timed out after ${timeoutMs}ms`,
        cause: err,
      });
    }
    if (isAbortError(err)) {
      throw new ProviderError({ provider: "http", kind: "aborted", message: "Request aborted", cause: err });
    }
    throw new ProviderError({
      provider: "http",
      kind: "unavailable",
      message: "Network error while contacting the AI provider",
      cause: err,
    });
  }
}

export interface JsonRequestOptions {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  policy?: RetryPolicy;
  /** Label used in error messages, e.g. "chat completion". */
  label?: string;
}

/**
 * Performs a JSON POST with bounded retries for transient failures only.
 * Returns the parsed JSON body plus the response (callers may need headers).
 */
export async function postJsonWithRetry(
  options: JsonRequestOptions,
): Promise<{ json: unknown; response: Response }> {
  const policy = options.policy ?? defaultRetryPolicy();
  const label = options.label ?? "request";
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new ProviderError({ provider: options.provider, kind: "aborted", message: "Request aborted" });
    }

    try {
      const { response, clear } = await fetchWithTimeout(
        options.url,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...options.headers },
          body: JSON.stringify(options.body),
        },
        policy.timeoutMs,
        options.signal,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        clear();
        const { kind, retryAfterMs } = classifyHttpStatus(response.status, text);
        const error = new ProviderError({
          provider: options.provider,
          kind,
          status: response.status,
          retryAfterMs,
          message: `${options.provider} ${label} failed with HTTP ${response.status}`,
        });
        if (!error.retryable || attempt === policy.maxRetries) throw error;
        lastError = error;
        await sleep(backoffDelay(attempt, policy, retryAfterMs), options.signal);
        continue;
      }

      const text = await response.text();
      clear();
      try {
        return { json: text.trim() === "" ? null : JSON.parse(text), response };
      } catch (err) {
        throw new ProviderError({
          provider: options.provider,
          kind: "malformed",
          status: response.status,
          message: `${options.provider} returned a response that was not valid JSON`,
          cause: err,
        });
      }
    } catch (err) {
      const providerError =
        err instanceof ProviderError
          ? err
          : new ProviderError({
              provider: options.provider,
              kind: "unknown",
              message: `${options.provider} ${label} failed`,
              cause: err,
            });

      if (providerError.kind === "malformed" || providerError.kind === "aborted") throw providerError;
      if (!providerError.retryable || attempt === policy.maxRetries) throw providerError;
      lastError = providerError;
      await sleep(backoffDelay(attempt, policy, providerError.retryAfterMs), options.signal);
    }
  }

  throw lastError ?? new ProviderError({
    provider: options.provider,
    kind: "unknown",
    message: `${options.provider} ${label} failed`,
  });
}
