/**
 * Streaming (Server-Sent Events) helpers.
 *
 * Provider streams arrive in arbitrary TCP chunks, so an event can be split
 * across reads *and* several events can arrive in one read. Parsing per-chunk
 * silently drops tokens — so everything funnels through a buffering line
 * reader here.
 */

/** Yields complete SSE `data:` payloads, preserving partial trailing data. */
export async function* sseDataLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const rawLine = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trimStart();
          if (payload) yield payload;
        }
        index = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.startsWith("data:")) {
      const payload = trailing.slice(5).trimStart();
      if (payload) yield payload;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* Stream already closed. */
    }
  }
}

/** Parses one SSE payload into JSON, returning null for keep-alives/[DONE]. */
export function parseSseJson(payload: string): unknown | null {
  const trimmed = payload.trim();
  if (trimmed === "" || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
