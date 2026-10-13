/**
 * The AI engine: chooses a provider, applies the fallback chain, tracks
 * telemetry and returns a provider-agnostic result.
 *
 * Ordering rules:
 *   1. an explicitly requested provider (or the configured default) goes first;
 *   2. then the configured fallback list (`NEXUS_FALLBACK_PROVIDERS`);
 *   3. then any other *configured* provider, as a last resort.
 *
 * `strict: true` disables everything after step 1 so callers can pin a vendor.
 */

import {
  AllProvidersFailedError,
  NoProvidersConfiguredError,
  ProviderError,
  type ProviderErrorKind,
} from "./errors.ts";
import { hasImage } from "./content.ts";
import { recordAttempt, recordFailure, recordSuccess } from "./metrics.ts";
import {
  allAdapters,
  getAdapter,
  modelsFor,
  resolveDefaultProvider,
  resolveFallbackProviders,
} from "./registry.ts";
import type {
  ChatParams,
  ChatRequestOptions,
  ChatResult,
  ModelTier,
  ProviderAdapter,
  ProviderId,
  StreamDelta,
  Usage,
} from "./types.ts";

export type StreamEvent =
  | {
      type: "meta";
      provider: ProviderId;
      providerLabel: string;
      model: string;
      fallbackUsed: boolean;
      attempted: ProviderId[];
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      usage: Usage;
      finishReason: string | null;
      latencyMs: number;
    };

interface Resolution {
  chain: ProviderAdapter[];
  attempted: ProviderId[];
  skipped: Array<{ provider: ProviderId; kind: ProviderErrorKind; message: string }>;
}

/** Builds the ordered provider chain for one request. */
function resolveChain(options: ChatRequestOptions): Resolution {
  const requested = options.provider ?? resolveDefaultProvider();
  const fallbacks = options.fallbacks ?? resolveFallbackProviders();

  const order: ProviderId[] = [];
  if (requested) order.push(requested);
  if (!options.strict) {
    for (const id of fallbacks) order.push(id);
    for (const adapter of allAdapters()) {
      if (adapter.isConfigured()) order.push(adapter.id);
    }
  }

  const seen = new Set<ProviderId>();
  const chain: ProviderAdapter[] = [];
  const attempted: ProviderId[] = [];
  const skipped: Resolution["skipped"] = [];

  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const adapter = getAdapter(id);
    if (!adapter) {
      skipped.push({ provider: id, kind: "not_configured", message: `Unknown provider "${id}"` });
      continue;
    }
    attempted.push(id);
    if (!adapter.isConfigured()) {
      // Only an explicitly requested provider gets a hard "not configured"
      // entry; unconfigured fallbacks are simply skipped.
      if (id === requested || options.strict) {
        skipped.push({
          provider: id,
          kind: "not_configured",
          message: `${adapter.label} is not configured — set ${adapter.envVar}`,
        });
      }
      continue;
    }
    chain.push(adapter);
  }

  return { chain, attempted, skipped };
}

function toProviderError(err: unknown, provider: string): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError({
    provider,
    kind: "unknown",
    message: "Unexpected provider failure",
    cause: err,
  });
}

export interface EngineDeps {
  /** Injection point for tests; defaults to `resolveChain`. */
  resolve?: (options: ChatRequestOptions) => Resolution;
}

/**
 * Runs a non-streaming completion through the provider chain.
 * Throws `NoProvidersConfiguredError` or `AllProvidersFailedError` when no
 * provider can answer.
 */
export async function chat(
  params: ChatParams,
  options: ChatRequestOptions = {},
  deps: EngineDeps = {},
): Promise<ChatResult> {
  const { chain, attempted, skipped } = (deps.resolve ?? resolveChain)(options);

  if (chain.length === 0) {
    if (skipped.length > 0) throw new AllProvidersFailedError(skipped);
    throw new NoProvidersConfiguredError(allAdapters().map((adapter) => adapter.envVar));
  }

  const failures: Array<{ provider: string; kind: ProviderErrorKind; message: string }> = [...skipped];
  const tier: ModelTier = options.tier ?? "balanced";
  let lastError: ProviderError | null = null;

  for (const [position, adapter] of chain.entries()) {
    // A message carrying an image must use the provider's vision-capable model:
    // the tier default may be a text-only model that would reject the request.
    const wantsVision = params.messages.some((message) => hasImage(message.content));
    const model =
      options.model ?? (wantsVision && adapter.visionModel ? adapter.visionModel : modelsFor(adapter, tier));
    const startedAt = Date.now();
    recordAttempt(adapter.id);
    try {
      const response = await adapter.chat({ ...params, model });
      const latencyMs = Date.now() - startedAt;
      recordSuccess(adapter.id, latencyMs, response.usage);
      return {
        ...response,
        model: response.model || model,
        provider: adapter.id,
        providerLabel: adapter.label,
        latencyMs,
        fallbackUsed: position > 0,
        attempted,
      };
    } catch (err) {
      const providerError = toProviderError(err, adapter.label);
      recordFailure(adapter.id, providerError.kind, providerError.message);
      failures.push({
        provider: adapter.id,
        kind: providerError.kind,
        message: providerError.message,
      });
      lastError = providerError;
      if (providerError.kind === "aborted") throw providerError;
    }
  }

  // With a single provider there is no chain to summarise: surface the precise
  // error so callers can map it to the right status code.
  if (lastError && chain.length === 1) throw lastError;
  throw new AllProvidersFailedError(failures);
}

/**
 * Streams a completion, transparently falling back **only** while no token has
 * been emitted — once a provider has produced text we must not replay it from a
 * different vendor, or the user would see duplicated output.
 */
export async function* streamChat(
  params: ChatParams,
  options: ChatRequestOptions = {},
  deps: EngineDeps = {},
): AsyncGenerator<StreamEvent, void, void> {
  const { chain, attempted, skipped } = (deps.resolve ?? resolveChain)(options);

  if (chain.length === 0) {
    if (skipped.length > 0) throw new AllProvidersFailedError(skipped);
    throw new NoProvidersConfiguredError(allAdapters().map((adapter) => adapter.envVar));
  }

  const failures: Array<{ provider: string; kind: ProviderErrorKind; message: string }> = [...skipped];
  const tier: ModelTier = options.tier ?? "balanced";
  let lastError: ProviderError | null = null;

  for (const [position, adapter] of chain.entries()) {
    // A message carrying an image must use the provider's vision-capable model:
    // the tier default may be a text-only model that would reject the request.
    const wantsVision = params.messages.some((message) => hasImage(message.content));
    const model =
      options.model ?? (wantsVision && adapter.visionModel ? adapter.visionModel : modelsFor(adapter, tier));
    const startedAt = Date.now();
    recordAttempt(adapter.id);

    let emitted = false;
    try {
      if (!adapter.stream) {
        // Provider without streaming support: emit the whole answer at once.
        const response = await adapter.chat({ ...params, model });
        const latencyMs = Date.now() - startedAt;
        recordSuccess(adapter.id, latencyMs, response.usage);
        yield {
          type: "meta",
          provider: adapter.id,
          providerLabel: adapter.label,
          model: response.model || model,
          fallbackUsed: position > 0,
          attempted,
        };
        yield { type: "delta", text: response.text };
        yield {
          type: "done",
          text: response.text,
          usage: response.usage,
          finishReason: response.finishReason,
          latencyMs,
        };
        return;
      }

      let announced = false;
      let text = "";
      let usage: Usage = { inputTokens: null, outputTokens: null };
      let finishReason: string | null = null;

      for await (const delta of adapter.stream({ ...params, model }) as AsyncGenerator<
        StreamDelta,
        void,
        void
      >) {
        if (delta.text) {
          if (!announced) {
            announced = true;
            yield {
              type: "meta",
              provider: adapter.id,
              providerLabel: adapter.label,
              model,
              fallbackUsed: position > 0,
              attempted,
            };
          }
          emitted = true;
          text += delta.text;
          yield { type: "delta", text: delta.text };
        }
        if (delta.usage) usage = delta.usage;
        if (delta.finishReason) finishReason = delta.finishReason;
      }

      const latencyMs = Date.now() - startedAt;
      recordSuccess(adapter.id, latencyMs, usage);
      if (!announced) {
        // Empty but successful completion — still tell the client who answered.
        yield {
          type: "meta",
          provider: adapter.id,
          providerLabel: adapter.label,
          model,
          fallbackUsed: position > 0,
          attempted,
        };
      }
      yield { type: "done", text, usage, finishReason, latencyMs };
      return;
    } catch (err) {
      const providerError = toProviderError(err, adapter.label);
      recordFailure(adapter.id, providerError.kind, providerError.message);

      if (emitted) {
        // Partial output already sent: surface the failure instead of silently
        // restarting the answer with another provider.
        throw providerError;
      }
      if (providerError.kind === "aborted") throw providerError;

      lastError = providerError;
      failures.push({
        provider: adapter.id,
        kind: providerError.kind,
        message: providerError.message,
      });
    }
  }

  if (lastError && chain.length === 1) throw lastError;
  throw new AllProvidersFailedError(failures);
}

/** Lightweight connectivity probe used by the provider settings panel. */
export async function probeProvider(id: ProviderId): Promise<{
  provider: ProviderId;
  ok: boolean;
  latencyMs: number | null;
  model: string | null;
  error: string | null;
  errorKind: ProviderErrorKind | null;
}> {
  const adapter = getAdapter(id);
  if (!adapter) {
    return {
      provider: id,
      ok: false,
      latencyMs: null,
      model: null,
      error: "Unknown provider",
      errorKind: "not_configured",
    };
  }
  if (!adapter.isConfigured()) {
    return {
      provider: id,
      ok: false,
      latencyMs: null,
      model: null,
      error: `${adapter.label} is not configured — set ${adapter.envVar}`,
      errorKind: "not_configured",
    };
  }

  try {
    const result = await chat(
      {
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        maxTokens: 16,
        temperature: 0,
      },
      { provider: id, strict: true, tier: "fast" },
    );
    return {
      provider: id,
      ok: true,
      latencyMs: result.latencyMs,
      model: result.model,
      error: null,
      errorKind: null,
    };
  } catch (err) {
    const providerError = toProviderError(err, adapter.label);
    return {
      provider: id,
      ok: false,
      latencyMs: null,
      model: null,
      error: providerError.message,
      errorKind: providerError.kind,
    };
  }
}
