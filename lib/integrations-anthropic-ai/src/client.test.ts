import assert from "node:assert/strict";
import test from "node:test";

import { anthropic, getAnthropicClient, isAnthropicConfigured } from "./client.ts";

// Regression guard: importing this module must never throw, otherwise the API
// server crashes before it can bind a port (this was the original startup bug).
test("module can be imported when ANTHROPIC_API_KEY is absent", () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(isAnthropicConfigured(), false);
    // Importing is safe; only *using* the client raises a clear config error.
    assert.throws(
      () => getAnthropicClient(),
      /ANTHROPIC_API_KEY is not configured/,
    );
    assert.throws(
      () => {
        void (anthropic as unknown as Record<string, unknown>).messages;
      },
      /ANTHROPIC_API_KEY is not configured/,
    );
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("client is created lazily once a key is present", () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-not-used-against-the-network";
  try {
    assert.equal(isAnthropicConfigured(), true);
    const first = getAnthropicClient();
    assert.equal(first, getAnthropicClient(), "client should be cached");
    assert.equal(
      typeof (anthropic as unknown as { messages?: unknown }).messages,
      "object",
    );
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});
