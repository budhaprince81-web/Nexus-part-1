import Anthropic from "@anthropic-ai/sdk";

// The Anthropic client is created lazily so that the API server can start —
// and serve health checks and non-AI routes — even when ANTHROPIC_API_KEY is
// not configured. Previously this module threw at import time, which crashed
// the whole server before it could bind a port.
let client: Anthropic | null = null;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to your environment secrets to enable AI features.",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Lazily-initialised Anthropic client. Reading any property (e.g.
 * `anthropic.messages`) initialises the SDK on first use, so importing this
 * module never throws.
 */
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, property, receiver) {
    const instance = getAnthropicClient();
    const value = Reflect.get(instance as object, property, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
