/**
 * Google Gemini adapter (GenerateContent + streamGenerateContent).
 *
 * The API key is sent in the `x-goog-api-key` header so it never ends up in a
 * URL, a log line or a referrer.
 */

import { toGeminiParts } from "../content.ts";
import { classifyHttpStatus, ProviderError } from "../errors.ts";
import { KeyPool, parseApiKeys, shouldRotateKey } from "../keys.ts";
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
  /** A single credential, or several (comma/whitespace separated) to rotate. */
  apiKey: string | readonly string[] | undefined;
  models: Record<ModelTier, string>;
  /** Model used when a message carries an image. */
  visionModel?: string;
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
  readonly visionModel?: string;

  private readonly pool: KeyPool;

  constructor(config: GeminiAdapterConfig) {
    this.pool = new KeyPool(
      typeof config.apiKey === "string" ? parseApiKeys(config.apiKey) : (config.apiKey ?? []),
    );
    this.models = config.models;
    this.visionModel = config.visionModel;
  }

  isConfigured(): boolean {
    return this.pool.configured;
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
    // Try each credential in the pool: an auth/quota/rate-limit failure on one
    // key is worth retrying with the next, everything else fails fast.
    const keys = this.pool.rotation();
    const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];

    for (let i = 0; i < attempts.length; i += 1) {
      try {
        const { json } = await postJsonWithRetry({
          provider: this.label,
          url: `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
          headers: { "x-goog-api-key": attempts[i] ?? "" },
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
      } catch (err) {
        if (!shouldRotateKey(err) || i === attempts.length - 1) throw err;
      }
    }

    // Unreachable: the loop either returns or throws on its final attempt.
    throw new ProviderError({
      provider: this.label,
      kind: "unknown",
      message: `${this.label} generateContent failed`,
    });
  }

  async *stream(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void> {
    const url =
      `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(params.model)}` +
      `:streamGenerateContent?alt=sse`;

    const keys = this.pool.rotation();
    const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];

    type Connected = Awaited<ReturnType<typeof fetchWithTimeout>>;
    let connected: Connected | null = null;

    // Rotation is only safe *before* the first token: once part of an answer
    // has been yielded it must never be restarted from a different key.
    for (let i = 0; i < attempts.length; i += 1) {
      let attempt: Connected | null = null;
      try {
        attempt = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": attempts[i] ?? "" },
            body: JSON.stringify(this.body(params)),
          },
          defaultRetryPolicy().timeoutMs,
          params.signal,
        );
      } catch (err) {
        if (shouldRotateKey(err) && i < attempts.length - 1) continue;
        throw err;
      }

      if (!attempt.response.ok || !attempt.response.body) {
        const status = attempt.response.status || 502;
        const text = await attempt.response.text().catch(() => "");
        attempt.clear();
        const { kind, retryAfterMs } = classifyHttpStatus(status, text);
        const error = new ProviderError({
          provider: this.label,
          kind,
          status,
          retryAfterMs,
          message: `${this.label} streaming request failed with HTTP ${status}`,
        });
        if (shouldRotateKey(error) && i < attempts.length - 1) continue;
        throw error;
      }

      connected = attempt;
      break;
    }

    if (!connected) {
      throw new ProviderError({
        provider: this.label,
        kind: "unknown",
        message: `${this.label} streaming request failed`,
      });
    }

    const response = connected.response;
    connected.clear();
    if (!response.body) {
      throw new ProviderError({
        provider: this.label,
        kind: "malformed",
        message: `${this.label} streaming response carried no body`,
      });
    }

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
