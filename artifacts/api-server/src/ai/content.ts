/**
 * Content-part helpers so a single message shape can be translated into each
 * provider's native multimodal format.
 */

import type { ContentPart, ImagePart, MessageContent, TextPart } from "./types.ts";

export function textPart(text: string): TextPart {
  return { type: "text", text };
}

export function imagePart(mediaType: string, dataBase64: string): ImagePart {
  return { type: "image", mediaType, dataBase64 };
}

export function parts(content: MessageContent): ContentPart[] {
  if (typeof content === "string") return content === "" ? [] : [textPart(content)];
  return content;
}

/** Flattens any message content to plain text (used by text-only providers). */
export function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : `[image ${part.mediaType}]`))
    .join("\n");
}

export function hasImage(content: MessageContent): boolean {
  return typeof content !== "string" && content.some((part) => part.type === "image");
}

/** Anthropic Messages API content blocks. */
export function toAnthropicContent(content: MessageContent): unknown {
  if (typeof content === "string") return content;
  return parts(content).map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image",
          source: { type: "base64", media_type: part.mediaType, data: part.dataBase64 },
        },
  );
}

/** OpenAI-compatible content (also used by Groq / OpenRouter where supported). */
export function toOpenAiContent(content: MessageContent): unknown {
  if (typeof content === "string") return content;
  const mapped = parts(content).map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: { url: `data:${part.mediaType};base64,${part.dataBase64}` },
        },
  );
  // A single text part keeps maximum compatibility with strict providers.
  if (mapped.length === 1 && mapped[0].type === "text") return mapped[0].text;
  return mapped;
}

/** Gemini `parts` array. */
export function toGeminiParts(content: MessageContent): unknown[] {
  return parts(content).map((part) =>
    part.type === "text"
      ? { text: part.text }
      : { inlineData: { mimeType: part.mediaType, data: part.dataBase64 } },
  );
}
