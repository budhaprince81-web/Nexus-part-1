/**
 * Engine tests.
 *
 * These run with the real provider adapters against a stubbed `fetch`, which is
 * exactly the boundary a real network call crosses — so routing, retries,
 * timeouts, SSE parsing, fallbacks and telemetry are all exercised for real.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AllProvidersFailedError,
  chat,
  NoProvidersConfiguredError,
  ProviderError,
  providerStatus,
  resetMetrics,
  resetRegistry,
  streamChat,
} from "./index.ts";
import { configureMockProvider } from "./adapters/mock.ts";

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_BASE_URL",
  "NEXUS_ALLOW_MOCK_PROVIDER",
  "NEXUS_DEFAULT_PROVIDER",
  "NEXUS_FALLBACK_PROVIDERS",
];

type FetchArgs = { url: string; init: RequestInit };

function installFetch(
  handler: (args: FetchArgs) => Promise<Response> | Response,
): FetchArgs[] {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const args: FetchArgs = { url, init: init ?? {} };
    calls.push(args);
    return handler(args);
  }) as typeof fetch;
  process.once("exit", () => {
    globalThis.fetch = original;
  });
  return calls;
}

function chatCompletion(text: string, model = "test-model"): Response {
  return new Response(
    JSON.stringify({
      id: "cmpl-1",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function resetEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const key of PROVIDER_ENV) delete process.env[key];
  // Fast retries keep the suite quick.
  process.env.NEXUS_AI_RETRY_BASE_MS = "1";
  process.env.NEXUS_AI_RETRY_MAX_MS = "5";
  process.env.NEXUS_AI_TIMEOUT_MS = "2000";
  process.env.NEXUS_AI_MAX_RETRIES = "2";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRegistry();
  resetMetrics();
}

test("chat() fails honestly when no provider is configured", async () => {
  resetEnv();
  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "hi" }] }),
    (err: unknown) => err instanceof NoProvidersConfiguredError,
  );
});

test("chat() returns the model answer and records telemetry", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-test-openai", NEXUS_DEFAULT_PROVIDER: "openai" });
  const calls = installFetch(() => chatCompletion("hello from the engine"));

  const result = await chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.text, "hello from the engine");
  assert.equal(result.provider, "openai");
  assert.equal(result.fallbackUsed, false);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/chat/completions"));

  const status = providerStatus().find((entry) => entry.id === "openai");
  assert.equal(status?.metrics.successes, 1);
  assert.equal(status?.metrics.inputTokens, 11);
  assert.equal(status?.metrics.outputTokens, 7);
});

test("the API key is sent only as an Authorization header, never in the URL", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-secret-value", NEXUS_DEFAULT_PROVIDER: "openai" });
  const calls = installFetch(() => chatCompletion("ok"));

  await chat({ messages: [{ role: "user", content: "hi" }] });

  const headers = new Headers(calls[0].init.headers as Record<string, string>);
  assert.equal(headers.get("authorization"), "Bearer sk-secret-value");
  assert.ok(!calls[0].url.includes("sk-secret-value"));

  // Status output must expose *whether* a provider is configured, never the key.
  const serialized = JSON.stringify(providerStatus());
  assert.ok(!serialized.includes("sk-secret-value"));

  const configured = providerStatus().find((entry) => entry.id === "openai");
  assert.equal(configured?.configured, true);
  assert.equal(configured?.envVar, "OPENAI_API_KEY");
});

test("a failing primary provider falls back to the next configured provider", async () => {
  resetEnv({
    GROQ_API_KEY: "gsk-test",
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "groq",
  });
  const calls = installFetch(({ url }) => {
    if (url.includes("api.groq.com")) {
      return new Response("upstream unavailable", { status: 503 });
    }
    return chatCompletion("answered by the fallback provider");
  });

  const result = await chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.text, "answered by the fallback provider");
  assert.equal(result.provider, "openai");
  assert.equal(result.fallbackUsed, true);
  // 3 groq attempts (1 + 2 retries) then 1 openai success.
  assert.equal(calls.filter((call) => call.url.includes("api.groq.com")).length, 3);
});

test("authentication errors are not retried and fall through immediately", async () => {
  resetEnv({
    GROQ_API_KEY: "gsk-bad",
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "groq",
  });
  const calls = installFetch(({ url }) => {
    if (url.includes("api.groq.com")) return new Response("invalid api key", { status: 401 });
    return chatCompletion("ok");
  });

  const result = await chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.provider, "openai");
  assert.equal(calls.filter((call) => call.url.includes("api.groq.com")).length, 1);
  const groq = providerStatus().find((entry) => entry.id === "groq");
  assert.equal(groq?.metrics.errorsByKind.auth, 1);
});

test("rate limits are retried with backoff and can then succeed", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-test", NEXUS_DEFAULT_PROVIDER: "openai" });
  let attempts = 0;
  const calls = installFetch(() => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "slow down", retry_after: 0 }), { status: 429 });
    }
    return chatCompletion("recovered");
  });

  const result = await chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.text, "recovered");
  assert.equal(calls.length, 2);
});

test("strict mode never falls back", async () => {
  resetEnv({
    GROQ_API_KEY: "gsk-test",
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "groq",
  });
  installFetch(({ url }) => {
    if (url.includes("api.groq.com")) return new Response("boom", { status: 500 });
    return chatCompletion("should not be used");
  });

  await assert.rejects(
    () =>
      chat({ messages: [{ role: "user", content: "hi" }] }, { provider: "groq", strict: true }),
    (err: unknown) => err instanceof ProviderError && err.kind === "unavailable",
  );
});

test("an unconfigured explicit provider produces a clear configuration error", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-test" });
  installFetch(() => chatCompletion("never"));

  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "hi" }] }, { provider: "groq", strict: true }),
    (err: unknown) =>
      err instanceof AllProvidersFailedError &&
      err.attempts.some((attempt) => attempt.kind === "not_configured"),
  );
});

test("requests time out instead of hanging forever", async () => {
  resetEnv({
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "openai",
    // Single attempt with a very short timeout keeps the suite fast.
    NEXUS_AI_TIMEOUT_MS: "100",
    NEXUS_AI_MAX_RETRIES: "0",
  });

  installFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  );

  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "hi" }] }),
    (err: unknown) => err instanceof ProviderError && err.kind === "timeout",
  );
});

test("streaming reassembles events split across network chunk boundaries", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-test", NEXUS_DEFAULT_PROVIDER: "openai" });

  // Deliberately split mid-JSON and mid-`data:` prefix, and put two events in
  // one chunk — the classic ways a naive per-chunk parser loses tokens.
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo "}}]}\n\ndata: {"choices":[{"delta":{"co',
    'ntent":"world"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":3}}\n\n',
    "data: [DONE]\n\n",
  ];
  installFetch(() => sseResponse(chunks));

  let text = "";
  let provider: string | null = null;
  let usageTokens = 0;
  for await (const event of streamChat({ messages: [{ role: "user", content: "hi" }] })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "meta") provider = event.provider;
    if (event.type === "done") usageTokens = event.usage.outputTokens ?? 0;
  }

  assert.equal(text, "Hello world!");
  assert.equal(provider, "openai");
  assert.equal(usageTokens, 3);
});

test("streaming falls back only when no token has been emitted yet", async () => {
  resetEnv({
    GROQ_API_KEY: "gsk-test",
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "groq",
  });
  installFetch(({ url }) => {
    if (url.includes("api.groq.com")) return new Response("nope", { status: 500 });
    return sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n', "data: [DONE]\n\n"]);
  });

  let text = "";
  let provider = "";
  for await (const event of streamChat({ messages: [{ role: "user", content: "hi" }] })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "meta") provider = event.provider;
  }

  assert.equal(text, "fallback");
  assert.equal(provider, "openai");
});

test("a mid-stream failure surfaces instead of replaying the answer", async () => {
  resetEnv({
    GROQ_API_KEY: "gsk-test",
    OPENAI_API_KEY: "sk-test",
    NEXUS_DEFAULT_PROVIDER: "groq",
  });
  installFetch(({ url }) => {
    if (url.includes("api.groq.com")) {
      // Emit one token, then fail the transport mid-stream.
      const encoder = new TextEncoder();
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
            );
            return;
          }
          controller.error(new Error("connection reset"));
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return sseResponse(['data: {"choices":[{"delta":{"content":"replayed"}}]}\n\n']);
  });

  let text = "";
  await assert.rejects(async () => {
    for await (const event of streamChat({ messages: [{ role: "user", content: "hi" }] })) {
      if (event.type === "delta") text += event.text;
    }
  });

  assert.equal(text, "partial");
});

test("malformed provider responses are reported as malformed, not as success", async () => {
  resetEnv({ OPENAI_API_KEY: "sk-test", NEXUS_DEFAULT_PROVIDER: "openai" });
  installFetch(() => new Response("<html>not json</html>", { status: 200 }));

  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "hi" }] }),
    (err: unknown) => err instanceof ProviderError && err.kind === "malformed",
  );
});

test("the Anthropic adapter speaks the native Messages API", async () => {
  resetEnv({ ANTHROPIC_API_KEY: "sk-ant-test", NEXUS_DEFAULT_PROVIDER: "anthropic" });
  const calls = installFetch(
    () =>
      new Response(
        JSON.stringify({
          model: "claude-test",
          content: [{ type: "text", text: "native answer" }],
          usage: { input_tokens: 5, output_tokens: 9 },
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  const result = await chat(
    { messages: [{ role: "user", content: "hi" }], system: "be useful" },
    { tier: "balanced" },
  );

  assert.equal(result.text, "native answer");
  assert.equal(result.provider, "anthropic");
  assert.ok(calls[0].url.endsWith("/v1/messages"));
  const headers = new Headers(calls[0].init.headers as Record<string, string>);
  assert.equal(headers.get("x-api-key"), "sk-ant-test");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.system, "be useful");
  assert.ok(typeof body.max_tokens === "number");
});

test("image content is translated into each provider's native format", async () => {
  resetEnv({ ANTHROPIC_API_KEY: "sk-ant-test", NEXUS_DEFAULT_PROVIDER: "anthropic" });
  const calls = installFetch(
    () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "saw it" }], usage: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  await chat({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", mediaType: "image/png", dataBase64: "AAAA" },
          { type: "text", text: "describe this" },
        ],
      },
    ],
  });

  const body = JSON.parse(String(calls[0].init.body)) as {
    messages: Array<{ content: Array<Record<string, unknown>> }>;
  };
  const parts = body.messages[0].content;
  assert.equal(parts[0].type, "image");
  assert.deepEqual(parts[0].source, { type: "base64", media_type: "image/png", data: "AAAA" });
  assert.equal(parts[1].type, "text");
});

test("Gemini uses header auth and its own endpoint shape", async () => {
  resetEnv({ GEMINI_API_KEY: "gemini-test", NEXUS_DEFAULT_PROVIDER: "gemini" });
  const calls = installFetch(
    () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "gemini answer" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  const result = await chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.text, "gemini answer");
  assert.ok(calls[0].url.includes(":generateContent"));
  assert.ok(!calls[0].url.includes("gemini-test"));
  const headers = new Headers(calls[0].init.headers as Record<string, string>);
  assert.equal(headers.get("x-goog-api-key"), "gemini-test");
});

test("a message carrying an image selects the provider's vision model", async () => {
  resetEnv({ GEMINI_API_KEY: "gemini-test", NEXUS_DEFAULT_PROVIDER: "gemini" });
  const calls = installFetch(() =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "looks like a dot" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await chat({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", mediaType: "image/png", dataBase64: "AAAA" },
        ],
      },
    ],
  });

  // The tier default is a text model; the image must switch it to the vision
  // model, or the provider would reject the request.
  assert.ok(calls[0].url.includes("gemini-flash-latest"), calls[0].url);
});

test("multi-key rotation retries the same request with the next credential", async () => {
  resetEnv({
    // The first key is revoked; the second must answer.
    GROQ_API_KEY: "revoked-key,live-key",
    NEXUS_DEFAULT_PROVIDER: "groq",
    NEXUS_AI_MAX_RETRIES: "0",
  });
  const calls = installFetch(({ init }) => {
    const headers = new Headers(init.headers as Record<string, string>);
    if (headers.get("authorization") === "Bearer revoked-key") {
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return chatCompletion("answered with the second key");
  });

  const result = await chat({ messages: [{ role: "user", content: "hi" }] }, { strict: true });

  assert.equal(result.text, "answered with the second key");
  assert.equal(calls.length, 2);
  const second = new Headers(calls[1].init.headers as Record<string, string>);
  assert.equal(second.get("authorization"), "Bearer live-key");
});

test("a single bad key does not loop: it fails once and surfaces the error", async () => {
  resetEnv({ GROQ_API_KEY: "only-key", NEXUS_DEFAULT_PROVIDER: "groq", NEXUS_AI_MAX_RETRIES: "0" });
  const calls = installFetch(
    () =>
      new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  );

  await assert.rejects(chat({ messages: [{ role: "user", content: "hi" }] }, { strict: true }));
  assert.equal(calls.length, 1);
});

test("the simulation provider is opt-in and clearly labelled", async () => {
  resetEnv({ NEXUS_ALLOW_MOCK_PROVIDER: "true" });
  configureMockProvider({ text: "deterministic output" });

  const result = await chat({ messages: [{ role: "user", content: "ping" }] });

  assert.equal(result.provider, "mock");
  assert.match(result.text, /SIMULATED/);

  // And it must not be reachable when the flag is absent.
  resetEnv();
  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "ping" }] }),
    (err: unknown) => err instanceof NoProvidersConfiguredError,
  );
});
