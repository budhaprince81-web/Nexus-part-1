/**
 * Adapter for every provider that speaks the OpenAI `/chat/completions` shape:
 * OpenAI, Groq, OpenRouter and local Ollama-compatible servers.
 *
 * The differences between them are only the base URL, the auth header and a
 * couple of optional attribution headers — everything else is shared.
 */

import { hasImage, toOpenAiContent } from "../content.ts";
import { ProviderError } from "../errors.ts";
import { defaultRetryPolicy, fetchWithTimeout, postJsonWithRetry } from "../http.ts";
import { parseSseJson, sseDataLines } from "../sse.ts";
import type {
  AdapterChatParams,
  ModelTier,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderChatResponse,
  ProviderId,
  StreamDelta,
  Usage,
} from "../types.ts";

export interface OpenAiCompatibleConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string | undefined;
  envVar: string;
  docsUrl: string;
  models: Record<ModelTier, string>;
  visionModel?: string;
  capabilities: ProviderCapabilities;
  extraHeaders?: Record<string, string>;
  /** Local servers (Ollama) do not need an API key. */
  requiresKey: boolean;
  /** Overrides the "has a credential" heuristic (used for local servers). */
  explicitlyConfigured?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readUsage(record: Record<string, unknown> | null): Usage {
  const usage = asRecord(record?.usage);
  return {
    inputTokens: num(usage?.prompt_tokens) ?? num(usage?.input_tokens),
    outputTokens: num(usage?.completion_tokens) ?? num(usage?.output_tokens),
  };
}

function readFirstContent(record: Record<string, unknown> | null): string {
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError({
      provider: "openai-compatible",
      kind: "malformed",
      message: "Provider response contained no choices",
    });
  }
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  // Some providers return content parts instead of a plain string.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part);
        return typeof record?.text === "string" ? record.text : "";
      })
      .join("");
  }
  return "";
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  readonly envVar: string;
  readonly docsUrl: string;
  readonly capabilities: ProviderCapabilities;
  readonly models: Record<ModelTier, string>;
  readonly visionModel?: string;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;
  private readonly requiresKey: boolean;
  private readonly explicitlyConfigured: boolean | undefined;

  constructor(config: OpenAiCompatibleConfig) {
    this.id = config.id;
    this.label = config.label;
    this.envVar = config.envVar;
    this.docsUrl = config.docsUrl;
    this.capabilities = config.capabilities;
    this.models = config.models;
    this.visionModel = config.visionModel;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.extraHeaders = config.extraHeaders ?? {};
    this.requiresKey = config.requiresKey;
    this.explicitlyConfigured = config.explicitlyConfigured;
  }

  isConfigured(): boolean {
    if (this.explicitlyConfigured !== undefined) return this.explicitlyConfigured;
    return this.requiresKey ? Boolean(this.apiKey) : true;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { ...this.extraHeaders };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private body(params: AdapterChatParams, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [
        ...(params.system ? [{ role: "system", content: params.system }] : []),
        ...params.messages.map((message) => ({
          role: message.role,
          content: toOpenAiContent(message.content),
        })),
      ],
    };
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (typeof params.temperature === "number") body.temperature = params.temperature;
    if (stream) {
      body.stream = true;
      // Ask for a final usage frame where the provider supports it; harmless otherwise.
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  async chat(params: AdapterChatParams): Promise<ProviderChatResponse> {
    this.assertImagesSupported(params);
    const { json } = await postJsonWithRetry({
      provider: this.label,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: this.body(params, false),
      signal: params.signal,
      label: "chat completion",
    });

    const record = asRecord(json);
    return {
      text: readFirstContent(record),
      model: typeof record?.model === "string" ? record.model : params.model,
      usage: readUsage(record),
      finishReason: this.readFinishReason(record),
    };
  }

  private readFinishReason(record: Record<string, unknown> | null): string | null {
    const choices = record?.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const reason = asRecord(choices[0])?.finish_reason;
    return typeof reason === "string" ? reason : null;
  }

  private assertImagesSupported(params: AdapterChatParams): void {
    if (!this.capabilities.vision) {
      const withImage = params.messages.some((message) => hasImage(message.content));
      if (withImage) {
        throw new ProviderError({
          provider: this.label,
          kind: "bad_request",
          message: `${this.label} does not support image input`,
        });
      }
    }
  }

  async *stream(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void> {
    this.assertImagesSupported(params);
    const { response, clear } = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers() },
        body: JSON.stringify(this.body(params, true)),
      },
      defaultRetryPolicy().timeoutMs,
      params.signal,
    );

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      clear();
      const status = response.status || 502;
      throw new ProviderError({
        provider: this.label,
        kind: status >= 500 ? "unavailable" : "bad_request",
        status,
        message: `${this.label} streaming request failed with HTTP ${status}`,
      });
    }

    clear(); // Headers are in; the read loop enforces its own cancellation.

    let latestUsage: Usage = { inputTokens: null, outputTokens: null };
    let finishReason: string | null = null;

    for await (const payload of sseDataLines(response.body, params.signal)) {
      const event = asRecord(parseSseJson(payload));
      if (!event) continue;

      const usage = readUsage(event);
      if (usage.inputTokens !== null || usage.outputTokens !== null) latestUsage = usage;

      const choices = event.choices;
      if (!Array.isArray(choices)) continue;

      for (const rawChoice of choices) {
        const choice = asRecord(rawChoice);
        if (!choice) continue;
        const delta = asRecord(choice.delta);
        const text = typeof delta?.content === "string" ? delta.content : undefined;
        if (text) yield { text };
        if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      }
    }

    if (latestUsage.inputTokens !== null || latestUsage.outputTokens !== null) {
      yield { usage: latestUsage };
    }
    yield { finishReason };
  }
}
