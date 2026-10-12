/**
 * Google Gemini adapter (GenerateContent + streamGenerateContent).
 *
 * The API key is sent in the `x-goog-api-key` header so it never ends up in a
 * URL, a log line or a referrer.
 */

import { toGeminiParts } from "../content.ts";
import { ProviderError } from "../errors.ts";
import { defaultRetryPolicy, fetchWithTimeout, postJsonWithRetry } from "../http.ts";
import { parseSseJson, sseDataLines } from "../sse.ts";
import type {
  AdapterChatParams,
  ModelTier,
  ProviderAdapter,
  ProviderChatResponse,
  StreamDelta,
  Usage,
} from "../types.ts";

const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";

export interface GeminiAdapterConfig {
  apiKey: string | undefined;
  models: Record<ModelTier, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCandidate(record: Record<string, unknown> | null): {
  text: string;
  finishReason: string | null;
  usage: Usage;
} {
  const candidates = record?.candidates;
  const first = Array.isArray(candidates) && candidates.length > 0 ? asRecord(candidates[0]) : null;
  const parts = asRecord(first?.content)?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => {
          const item = asRecord(part);
          return typeof item?.text === "string" ? item.text : "";
        })
        .join("")
    : "";

  const usageMeta = asRecord(record?.usageMetadata);
  return {
    text,
    finishReason: typeof first?.finishReason === "string" ? first.finishReason : null,
    usage: {
      inputTokens: num(usageMeta?.promptTokenCount),
      outputTokens: num(usageMeta?.candidatesTokenCount),
    },
  };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  readonly envVar = "GEMINI_API_KEY";
  readonly docsUrl = "https://ai.google.dev/api/generate-content";
  readonly capabilities = { streaming: true, vision: true, jsonMode: true } as const;
  readonly models: Record<ModelTier, string>;

  private readonly apiKey: string | undefined;

  constructor(config: GeminiAdapterConfig) {
    this.apiKey = config.apiKey;
    this.models = config.models;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private body(params: AdapterChatParams): Record<string, unknown> {
    return {
      contents: params.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: toGeminiParts(message.content),
        })),
      ...(params.system
        ? { systemInstruction: { parts: [{ text: params.system }] } }
        : {}),
      generationConfig: {
        ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
        ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
      },
    };
  }

  async chat(params: AdapterChatParams): Promise<ProviderChatResponse> {
    const { json } = await postJsonWithRetry({
      provider: this.label,
      url: `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
      headers: { "x-goog-api-key": this.apiKey ?? "" },
      body: this.body(params),
      signal: params.signal,
      label: "generateContent",
    });

    const record = asRecord(json);
    if (record?.error) {
      const error = asRecord(record.error);
      throw new ProviderError({
        provider: this.label,
        kind: "bad_request",
        message: `Gemini error: ${typeof error?.status === "string" ? error.status : "unknown"}`,
      });
    }

    const candidate = readCandidate(record);
    return {
      text: candidate.text,
      model: params.model,
      usage: candidate.usage,
      finishReason: candidate.finishReason,
    };
  }

  async *stream(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void> {
    const url =
      `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(params.model)}` +
      `:streamGenerateContent?alt=sse`;

    const { response, clear } = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey ?? "" },
        body: JSON.stringify(this.body(params)),
      },
      defaultRetryPolicy().timeoutMs,
      params.signal,
    );

    if (!response.ok || !response.body) {
      clear();
      const status = response.status || 502;
      throw new ProviderError({
        provider: this.label,
        kind: status >= 500 ? "unavailable" : "bad_request",
        status,
        message: `${this.label} streaming request failed with HTTP ${status}`,
      });
    }

    clear();

    let usage: Usage = { inputTokens: null, outputTokens: null };
    let finishReason: string | null = null;

    for await (const payload of sseDataLines(response.body, params.signal)) {
      const record = asRecord(parseSseJson(payload));
      if (!record) continue;
      const candidate = readCandidate(record);
      if (candidate.text) yield { text: candidate.text };
      if (candidate.usage.inputTokens !== null || candidate.usage.outputTokens !== null) {
        usage = candidate.usage;
      }
      if (candidate.finishReason) finishReason = candidate.finishReason;
    }

    yield { usage };
    yield { finishReason };
  }
}
