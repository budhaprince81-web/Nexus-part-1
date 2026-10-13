/**
 * Native Anthropic Messages API adapter.
 *
 * Implemented directly over `fetch` (rather than the SDK) so that timeouts,
 * retries, streaming and metrics behave identically to every other provider.
 */

import { toAnthropicContent } from "../content.ts";
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

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

export interface AnthropicAdapterConfig {
  /** A single credential, or several (comma/whitespace separated) to rotate. */
  apiKey: string | readonly string[] | undefined;
  models: Record<ModelTier, string>;
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

function readUsage(record: Record<string, unknown> | null): Usage {
  const usage = asRecord(record?.usage);
  return {
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic Claude";
  readonly envVar = "ANTHROPIC_API_KEY";
  readonly docsUrl = "https://platform.claude.com/docs/en/api/messages/create";
  readonly capabilities = { streaming: true, vision: true, jsonMode: false } as const;
  readonly models: Record<ModelTier, string>;
  readonly visionModel?: string;

  private readonly pool: KeyPool;

  constructor(config: AnthropicAdapterConfig) {
    this.pool = new KeyPool(
      typeof config.apiKey === "string" ? parseApiKeys(config.apiKey) : (config.apiKey ?? []),
    );
    this.models = config.models;
    this.visionModel = config.visionModel;
  }

  isConfigured(): boolean {
    return this.pool.configured;
  }

  private headers(apiKey?: string): Record<string, string> {
    return {
      "x-api-key": apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  private body(params: AdapterChatParams, stream: boolean): Record<string, unknown> {
    return {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      // Anthropic requires at least one message; a system-only prompt is padded.
      messages:
        params.messages.length > 0
          ? params.messages
              .filter((message) => message.role !== "system")
              .map((message) => ({
                role: message.role,
                content: toAnthropicContent(message.content),
              }))
          : [{ role: "user", content: "Continue." }],
      ...(params.system ? { system: params.system } : {}),
      ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  async chat(params: AdapterChatParams): Promise<ProviderChatResponse> {
    const keys = this.pool.rotation();
    const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];
    let json: unknown = null;

    for (let i = 0; i < attempts.length; i += 1) {
      try {
        const result = await postJsonWithRetry({
          provider: this.label,
          url: `${ANTHROPIC_BASE_URL}/v1/messages`,
          headers: this.headers(attempts[i]),
          body: this.body(params, false),
          signal: params.signal,
          label: "message",
        });
        json = result.json;
        break;
      } catch (err) {
        if (!shouldRotateKey(err) || i === attempts.length - 1) throw err;
      }
    }

    const record = asRecord(json);
    const blocks = Array.isArray(record?.content) ? record?.content : [];
    const text = (blocks as unknown[])
      .map((block) => {
        const item = asRecord(block);
        return item?.type === "text" && typeof item.text === "string" ? item.text : "";
      })
      .join("");

    if (text === "" && !Array.isArray(blocks)) {
      throw new ProviderError({
        provider: this.label,
        kind: "malformed",
        message: "Anthropic response contained no content blocks",
      });
    }

    return {
      text,
      model: typeof record?.model === "string" ? record.model : params.model,
      usage: readUsage(record),
      finishReason: typeof record?.stop_reason === "string" ? record.stop_reason : null,
    };
  }

  async *stream(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void> {
    const keys = this.pool.rotation();
    const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];
    type Connected = Awaited<ReturnType<typeof fetchWithTimeout>>;
    let connected: Connected | null = null;

    // Rotation is only safe *before* the first token.
    for (let i = 0; i < attempts.length; i += 1) {
      let attempt: Connected | null = null;
      try {
        attempt = await fetchWithTimeout(
          `${ANTHROPIC_BASE_URL}/v1/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...this.headers(attempts[i]) },
            body: JSON.stringify(this.body(params, true)),
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

    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let finishReason: string | null = null;

    for await (const payload of sseDataLines(response.body, params.signal)) {
      const event = asRecord(parseSseJson(payload));
      if (!event) continue;
      const type = event.type;

      if (type === "content_block_delta") {
        const delta = asRecord(event.delta);
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { text: delta.text };
        }
      } else if (type === "message_start") {
        const message = asRecord(event.message);
        inputTokens = readUsage(message).inputTokens;
      } else if (type === "message_delta") {
        const usage = asRecord(event.usage);
        outputTokens = num(usage?.output_tokens) ?? outputTokens;
        if (typeof event.delta === "object") {
          const reason = asRecord(event.delta)?.stop_reason;
          if (typeof reason === "string") finishReason = reason;
        }
      } else if (type === "error") {
        const error = asRecord(event.error);
        throw new ProviderError({
          provider: this.label,
          kind: "unavailable",
          message: `Anthropic stream error: ${typeof error?.type === "string" ? error.type : "unknown"}`,
        });
      }
    }

    yield { usage: { inputTokens, outputTokens } };
    yield { finishReason };
  }
}
