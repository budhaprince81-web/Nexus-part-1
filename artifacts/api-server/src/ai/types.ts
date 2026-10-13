/**
 * Shared types for the NEXUS multi-provider AI engine.
 *
 * Every provider is exposed through the same `ProviderAdapter` interface so the
 * rest of the server never has to know which vendor is answering. Providers are
 * configured purely from server-side environment variables (Replit Secrets) —
 * no key is ever read from, or returned to, the browser.
 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "groq"
  | "openrouter"
  | "gemini"
  | "ollama"
  | "mock";

/** Model *tiers* let callers ask for the right weight of model for the job. */
export type ModelTier = "fast" | "balanced" | "reasoning";

/** A plain-text content part. */
export interface TextPart {
  type: "text";
  text: string;
}

/** An inline base64 image. Bytes never touch the filesystem or the logs. */
export interface ImagePart {
  type: "image";
  mediaType: string;
  dataBase64: string;
}

export type ContentPart = TextPart | ImagePart;
export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

export interface ChatParams {
  messages: ChatMessage[];
  /** System prompt, kept separate from `messages` for Anthropic semantics. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Cooperative cancellation — aborts the underlying HTTP request. */
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProviderChatResponse {
  text: string;
  model: string;
  usage: Usage;
  finishReason: string | null;
}

export interface ChatResult extends ProviderChatResponse {
  provider: ProviderId;
  providerLabel: string;
  latencyMs: number;
  /** True when the configured default provider failed and a fallback answered. */
  fallbackUsed: boolean;
  /** Provider ids that were attempted (in order) before this success. */
  attempted: ProviderId[];
}

export interface StreamDelta {
  text?: string;
  usage?: Usage;
  finishReason?: string | null;
}

export interface ProviderCapabilities {
  streaming: boolean;
  vision: boolean;
  jsonMode: boolean;
}

export interface AdapterChatParams extends ChatParams {
  model: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** Name of the environment variable that holds the credential. */
  readonly envVar: string;
  readonly docsUrl: string;
  readonly capabilities: ProviderCapabilities;
  /** Model to use per tier (requested tier falls back to `balanced`). */
  readonly models: Record<ModelTier, string>;
  /** Vision-capable model id, when the provider supports images. */
  readonly visionModel?: string;
  isConfigured(): boolean;
  /** Non-streaming completion. */
  chat(params: AdapterChatParams): Promise<ProviderChatResponse>;
  /** Streaming completion. Optional: callers fall back to `chat()` when absent. */
  stream?(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void>;
}

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
  capabilities: ProviderCapabilities;
  metrics: ProviderMetrics;
}

export interface ChatRequestOptions {
  /** Preferred provider id; defaults to `NEXUS_DEFAULT_PROVIDER` / auto-detect. */
  provider?: ProviderId;
  /** Ordered fallback list; defaults to `NEXUS_FALLBACK_PROVIDERS`. */
  fallbacks?: ProviderId[];
  /** Model tier — the engine maps it to a concrete model id per provider. */
  tier?: ModelTier;
  /** Explicit model id override (used for vision calls). */
  model?: string;
  /** If true, an unconfigured/failed provider aborts instead of falling back. */
  strict?: boolean;
}
