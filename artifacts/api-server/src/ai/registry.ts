/**
 * Provider registry.
 *
 * Reads provider configuration from server-side environment variables only.
 * Credentials never leave this module: `providerStatus()` returns whether a key
 * is *present*, never the key itself.
 */

import { AnthropicAdapter } from "./adapters/anthropic.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { MockAdapter, isMockProviderEnabled } from "./adapters/mock.ts";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible.ts";
import { snapshot } from "./metrics.ts";
import type { ModelTier, ProviderAdapter, ProviderId, ProviderStatus } from "./types.ts";

/** Preference order used when no explicit default is configured. */
export const PROVIDER_PREFERENCE: ProviderId[] = [
  "anthropic",
  "openai",
  "groq",
  "gemini",
  "openrouter",
  "ollama",
  "mock",
];

const ALL_MODEL_TIERS: ModelTier[] = ["fast", "balanced", "reasoning"];

function envModel(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * Resolves the model id for each tier.
 *
 * `<PROVIDER>_MODEL` sets the balanced tier (the one used by default);
 * `<PROVIDER>_MODEL_FAST` and `<PROVIDER>_MODEL_REASONING` override the light
 * and heavy tiers independently. Anything left unset falls back to the
 * documented default for that provider, so the app always has a usable model.
 */
function tierModels(variable: string, defaults: Record<ModelTier, string>): Record<ModelTier, string> {
  return {
    fast: envModel(`${variable}_FAST`, defaults.fast),
    balanced: envModel(variable, defaults.balanced),
    reasoning: envModel(`${variable}_REASONING`, defaults.reasoning),
  };
}

function buildAdapters(): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [
    new AnthropicAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      models: tierModels("ANTHROPIC_MODEL", {
        fast: "claude-haiku-4-5",
        balanced: "claude-sonnet-4-6",
        reasoning: "claude-opus-4-5",
      }),
      visionModel: envModel("ANTHROPIC_VISION_MODEL", "claude-sonnet-4-6"),
    }),
    new OpenAiCompatibleAdapter({
      id: "openai",
      label: "OpenAI",
      baseUrl: envModel("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      apiKey: process.env.OPENAI_API_KEY,
      envVar: "OPENAI_API_KEY",
      docsUrl: "https://developers.openai.com/api/docs/models",
      models: tierModels("OPENAI_MODEL", {
        fast: "gpt-5-mini",
        balanced: "gpt-5",
        reasoning: "gpt-5",
      }),
      visionModel: envModel("OPENAI_VISION_MODEL", "gpt-5"),
      capabilities: { streaming: true, vision: true, jsonMode: true },
      requiresKey: true,
    }),
    new OpenAiCompatibleAdapter({
      id: "groq",
      label: "Groq",
      baseUrl: envModel("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
      apiKey: process.env.GROQ_API_KEY,
      envVar: "GROQ_API_KEY",
      docsUrl: "https://console.groq.com/docs/models",
      // Verified against GET https://api.groq.com/openai/v1/models.
      // `llama-3.1-8b-instant` and `meta-llama/llama-3.3-70b-instruct` are no
      // longer served and now return HTTP 404.
      models: tierModels("GROQ_MODEL", {
        fast: "openai/gpt-oss-20b",
        balanced: "openai/gpt-oss-120b",
        reasoning: "openai/gpt-oss-120b",
      }),
      capabilities: { streaming: true, vision: false, jsonMode: true },
      requiresKey: true,
    }),
    new GeminiAdapter({
      apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      visionModel: envModel("GEMINI_VISION_MODEL", "gemini-flash-latest"),
      // Verified live: `gemini-2.5-flash` is "no longer available to new users".
      // The `-latest` aliases keep working across model retirement, which is the
      // failure mode that actually bit us here. Free-tier keys have no Pro
      // quota, so the reasoning tier stays on Flash; set
      // GEMINI_MODEL_REASONING=gemini-pro-latest if your key includes Pro.
      models: tierModels("GEMINI_MODEL", {
        fast: "gemini-flash-lite-latest",
        balanced: "gemini-flash-latest",
        reasoning: "gemini-flash-latest",
      }),
    }),
    new OpenAiCompatibleAdapter({
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: envModel("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
      apiKey: process.env.OPENROUTER_API_KEY,
      envVar: "OPENROUTER_API_KEY",
      docsUrl: "https://openrouter.ai/docs/api_reference/overview",
      visionModel: envModel("OPENROUTER_VISION_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"),
      // Verified live. A free-tier OpenRouter key answers HTTP 402 for paid
      // models, so the defaults are all `:free` routes. Point these at paid
      // models (e.g. anthropic/claude-sonnet-4.6) once credits exist.
      models: tierModels("OPENROUTER_MODEL", {
        fast: "liquid/lfm-2.5-2.6b:free",
        balanced: "nvidia/nemotron-3-super-120b-a12b:free",
        reasoning: "nvidia/nemotron-3-ultra-550b-a55b:free",
      }),
      capabilities: { streaming: true, vision: true, jsonMode: true },
      extraHeaders: {
        // Optional attribution headers recommended by OpenRouter.
        ...(process.env.OPENROUTER_SITE_URL
          ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
          : {}),
        "X-Title": process.env.OPENROUTER_SITE_NAME ?? "NEXUS AI OS",
      },
      requiresKey: true,
    }),
    new OpenAiCompatibleAdapter({
      id: "ollama",
      label: "Local (Ollama-compatible)",
      baseUrl: envModel("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"),
      apiKey: process.env.OLLAMA_API_KEY,
      envVar: "OLLAMA_BASE_URL",
      docsUrl: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
      models: tierModels("OLLAMA_MODEL", {
        fast: "llama3.2",
        balanced: "llama3.2",
        reasoning: "llama3.2",
      }),
      capabilities: { streaming: true, vision: false, jsonMode: true },
      requiresKey: false,
      // A local server counts as configured only when its URL is set
      // explicitly — otherwise every deployment would appear to have a
      // provider while nothing is listening on localhost.
      explicitlyConfigured: Boolean(process.env.OLLAMA_BASE_URL),
    }),
    new MockAdapter(),
  ];

  return adapters;
}

let cache: ProviderAdapter[] | null = null;
const index = new Map<ProviderId, ProviderAdapter>();

function ensure(): ProviderAdapter[] {
  if (!cache) {
    cache = buildAdapters();
    index.clear();
    for (const adapter of cache) index.set(adapter.id, adapter);
  }
  return cache;
}

/** Forces a rebuild — used by tests after mutating `process.env`. */
export function resetRegistry(): void {
  cache = null;
  index.clear();
}

export function allAdapters(): ProviderAdapter[] {
  return ensure();
}

export function getAdapter(id: ProviderId): ProviderAdapter | undefined {
  ensure();
  return index.get(id);
}

function parseProviderList(raw: string | undefined): ProviderId[] {
  if (!raw) return [];
  const known = new Set<ProviderId>(PROVIDER_PREFERENCE);
  return raw
    .split(",")
    .map((piece) => piece.trim().toLowerCase() as ProviderId)
    .filter((piece) => known.has(piece));
}

export function configuredProviderIds(): ProviderId[] {
  return allAdapters()
    .filter((adapter) => adapter.isConfigured())
    .map((adapter) => adapter.id);
}

/**
 * The provider used when the caller does not name one.
 *
 * `NEXUS_DEFAULT_PROVIDER` wins; otherwise the first configured provider in
 * `PROVIDER_PREFERENCE`. An explicitly configured provider that lacks
 * credentials is still returned so the caller gets a clear
 * "not configured" error instead of silently switching vendors.
 */
export function resolveDefaultProvider(): ProviderId | undefined {
  const explicit = process.env.NEXUS_DEFAULT_PROVIDER?.trim().toLowerCase() as ProviderId | undefined;
  if (explicit && getAdapter(explicit)) return explicit;
  return configuredProviderIds()[0];
}

export function resolveFallbackProviders(): ProviderId[] {
  return parseProviderList(process.env.NEXUS_FALLBACK_PROVIDERS);
}

export function providerStatus(): ProviderStatus[] {
  return PROVIDER_PREFERENCE.map((id) => getAdapter(id))
    .filter((adapter): adapter is ProviderAdapter => Boolean(adapter))
    .map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      configured: adapter.isConfigured(),
      envVar: adapter.envVar,
      docsUrl: adapter.docsUrl,
      models: adapter.models,
      capabilities: adapter.capabilities,
      metrics: snapshot(adapter.id, adapter.isConfigured()),
    }));
}

export function modelsFor(adapter: ProviderAdapter, tier: ModelTier = "balanced"): string {
  return adapter.models[tier] ?? adapter.models.balanced;
}

/** True when at least one provider (including an explicitly enabled mock) can answer. */
export function hasConfiguredProvider(): boolean {
  return configuredProviderIds().length > 0;
}

/** True when a *real* provider is configured (the mock provider never counts). */
export function isAnyProviderConfigured(): boolean {
  return configuredProviderIds().some((id) => id !== "mock");
}

export function mockEnabled(): boolean {
  return isMockProviderEnabled() && getAdapter("mock")?.isConfigured() === true;
}

export { ALL_MODEL_TIERS };
