/**
 * Thin, purpose-named wrappers around the engine used by the feature routes
 * (planner, research, coding, vision). Keeping them here means no route
 * imports a vendor SDK any more.
 */

import { chat } from "./engine.ts";
import type {
  ChatResult,
  MessageContent,
  ModelTier,
  ProviderId,
} from "./types.ts";

export interface CompleteParams {
  /** Either plain text or multimodal parts (text + inline images). */
  content: MessageContent;
  system?: string;
  maxTokens?: number;
  tier?: ModelTier;
  provider?: ProviderId;
  temperature?: number;
  signal?: AbortSignal;
}

/** Single-turn completion, with the full provider fallback chain. */
export function complete(params: CompleteParams): Promise<ChatResult> {
  return chat(
    {
      messages: [{ role: "user", content: params.content }],
      system: params.system,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      signal: params.signal,
    },
    { provider: params.provider, tier: params.tier },
  );
}

/** Extracts the first balanced JSON object from a model response. */
export function extractJson<T = unknown>(text: string): T | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
