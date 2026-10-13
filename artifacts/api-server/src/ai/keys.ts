/**
 * Multi-key credential pool.
 *
 * A single environment variable may hold several comma/whitespace separated
 * credentials (for example two OpenRouter keys). The pool hands keys out in a
 * rotating order so that a request which hits a revoked, rate-limited or
 * exhausted key can immediately retry with the next one instead of failing the
 * whole provider.
 *
 * Keys never leave this module: nothing here logs, formats or serialises a
 * credential, and `rotation()` is the only way to obtain one.
 */

/** Splits a raw env value into unique, non-empty keys (order preserved). */
export function parseApiKeys(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    const key = piece.trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export class KeyPool {
  private readonly keys: string[];
  private cursor = 0;

  constructor(keys: readonly string[]) {
    const seen = new Set<string>();
    this.keys = [];
    for (const candidate of keys) {
      const key = candidate.trim();
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      this.keys.push(key);
    }
  }

  get size(): number {
    return this.keys.length;
  }

  get configured(): boolean {
    return this.keys.length > 0;
  }

  /**
   * The keys to attempt, in order, for one logical call.
   *
   * A different starting offset is chosen on each call so traffic spreads
   * across the pool while a single bad key can never take the provider down.
   */
  rotation(): string[] {
    if (this.keys.length <= 1) return [...this.keys];
    const start = this.cursor % this.keys.length;
    this.cursor = (this.cursor + 1) % this.keys.length;
    return [...this.keys.slice(start), ...this.keys.slice(0, start)];
  }
}

/**
 * True when a failure says "this credential is unusable" rather than "this
 * request is bad" — i.e. trying another key in the pool is worthwhile.
 * Deliberately narrow: only auth/quota/rate-limit failures qualify.
 */
export function shouldRotateKey(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const kind = (err as { kind?: unknown }).kind;
  return kind === "auth" || kind === "quota" || kind === "rate_limit";
}
