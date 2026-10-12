/**
 * Error taxonomy for the AI engine.
 *
 * Callers (and the HTTP layer) rely on `kind` to decide whether a failure is
 * worth retrying, whether it is a configuration problem, and what a safe
 * user-facing message should be. Raw provider payloads and credentials are
 * never attached to these errors.
 */

export type ProviderErrorKind =
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "unavailable"
  | "bad_request"
  | "malformed"
  | "aborted"
  | "unknown";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit",
  "timeout",
  "unavailable",
  "unknown",
]);

export function isRetryableKind(kind: ProviderErrorKind): boolean {
  return RETRYABLE.has(kind);
}

export interface ProviderErrorInit {
  provider: string;
  kind: ProviderErrorKind;
  message: string;
  status?: number | null;
  retryAfterMs?: number | null;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.retryable = isRetryableKind(init.kind);
    this.retryAfterMs = init.retryAfterMs ?? null;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }
}

/**
 * Maps an HTTP status (plus a snippet of the body) onto our taxonomy.
 * Deliberately conservative: 4xx auth/bad-request errors are *not* retryable,
 * 429 and 5xx are.
 */
export function classifyHttpStatus(
  status: number,
  bodyText = "",
): { kind: ProviderErrorKind; retryAfterMs: number | null } {
  const body = bodyText.toLowerCase();
  const retryAfterMs = parseRetryAfterMs(bodyText);

  if (status === 401 || status === 403) return { kind: "auth", retryAfterMs };
  if (status === 402) return { kind: "quota", retryAfterMs };
  if (status === 404) {
    // A missing model is a configuration problem, not a transient failure.
    return { kind: "bad_request", retryAfterMs };
  }
  if (status === 408) return { kind: "timeout", retryAfterMs };
  if (status === 413) return { kind: "bad_request", retryAfterMs };
  if (status === 429) {
    if (body.includes("quota") || body.includes("billing") || body.includes("credit")) {
      return { kind: "quota", retryAfterMs };
    }
    return { kind: "rate_limit", retryAfterMs };
  }
  if (status === 400 || status === 422) {
    return { kind: "bad_request", retryAfterMs };
  }
  if (status >= 500) return { kind: "unavailable", retryAfterMs };
  return { kind: "unknown", retryAfterMs };
}

/** Best-effort parse of a `retry-after` value (seconds or HTTP date). */
function parseRetryAfterMs(bodyText: string): number | null {
  const match = bodyText.match(/retry[-_ ]after"?\s*[:=]\s*"?(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return null;
  return Math.min(Math.max(seconds, 0), 30) * 1000;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Raised when a streamed response cannot be parsed into text. */
export class MalformedResponseError extends ProviderError {
  constructor(provider: string, detail: string) {
    super({ provider, kind: "malformed", message: detail, status: null });
  }
}

/** Raised when *no* provider could answer — carries a per-provider summary. */
export class AllProvidersFailedError extends Error {
  readonly attempts: Array<{ provider: string; kind: ProviderErrorKind; message: string }>;

  constructor(attempts: Array<{ provider: string; kind: ProviderErrorKind; message: string }>) {
    const summary = attempts
      .map((a) => `${a.provider}(${a.kind})`)
      .join(", ");
    super(`All configured AI providers failed: ${summary || "none configured"}`);
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

/** Raised when the request is fine but no provider has credentials configured. */
export class NoProvidersConfiguredError extends Error {
  readonly configuredEnvVars: string[];

  constructor(configuredEnvVars: string[]) {
    super(
      "No AI provider is configured. Set at least one provider API key " +
        "(for example ANTHROPIC_API_KEY or GROQ_API_KEY) in Replit Secrets.",
    );
    this.name = "NoProvidersConfiguredError";
    this.configuredEnvVars = configuredEnvVars;
  }
}
