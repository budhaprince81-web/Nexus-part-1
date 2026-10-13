/**
 * Provider configuration and diagnostics API.
 *
 * Exposes *which* providers are configured, their model tiers, capabilities and
 * recent telemetry — never the credential values themselves. Rendering this in
 * the UI lets the operator see at a glance whether NEXUS can actually think.
 */

import { Router, type IRouter } from "express";
import {
  AllProvidersFailedError,
  NoProvidersConfiguredError,
  ProviderError,
  chat,
  configuredProviderIds,
  mockEnabled,
  providerStatus,
  probeProvider,
  resetRegistry,
  resolveDefaultProvider,
  resolveFallbackProviders,
  type ModelTier,
  type ProviderId,
} from "../ai/index.ts";
import { logNexusEvent } from "./nexus/logs";

const router: IRouter = Router();

const TIERS: ModelTier[] = ["fast", "balanced", "reasoning"];
const PROVIDER_IDS = new Set<string>([
  "anthropic",
  "openai",
  "groq",
  "openrouter",
  "gemini",
  "ollama",
  "mock",
]);

function readProviderId(value: unknown): ProviderId | undefined {
  return typeof value === "string" && PROVIDER_IDS.has(value) ? (value as ProviderId) : undefined;
}

function readTier(value: unknown): ModelTier | undefined {
  return typeof value === "string" && (TIERS as string[]).includes(value)
    ? (value as ModelTier)
    : undefined;
}

function statusPayload() {
  const providers = providerStatus();
  const configured = configuredProviderIds().filter((id) => id !== "mock");
  return {
    providers,
    configuredProviders: configured,
    defaultProvider: resolveDefaultProvider() ?? null,
    fallbackProviders: resolveFallbackProviders(),
    mockProviderEnabled: mockEnabled(),
    // The UI shows a "no AI provider" banner whenever this is empty.
    aiAvailable: configured.length > 0,
  };
}

function failureResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof NoProvidersConfiguredError) {
    return { status: 503, body: { error: err.message, code: "no_provider_configured" } };
  }
  if (err instanceof AllProvidersFailedError) {
    return {
      status: 502,
      body: {
        error: "No configured AI provider could complete this request.",
        code: "all_providers_failed",
        attempts: err.attempts,
      },
    };
  }
  if (err instanceof ProviderError) {
    const status =
      err.kind === "not_configured"
        ? 503
        : err.kind === "auth" || err.kind === "bad_request"
          ? 400
          : err.kind === "aborted"
            ? 499
            : 502;
    return {
      status,
      body: { error: err.message, code: err.kind, provider: err.provider },
    };
  }
  return { status: 500, body: { error: "AI request failed", code: "unknown" } };
}

// GET /providers — configuration + telemetry snapshot
router.get("/providers", (_req, res): void => {
  res.json(statusPayload());
});

// POST /providers/probe — lightweight connectivity test for one provider
router.post("/providers/probe", async (req, res): Promise<void> => {
  const raw = req.body as Record<string, unknown> | undefined;
  const provider = readProviderId(raw?.provider);
  if (!provider) {
    res.status(400).json({ error: "A valid provider id is required" });
    return;
  }
  const result = await probeProvider(provider);
  await logNexusEvent(
    result.ok ? "info" : "warn",
    `Provider probe ${provider}: ${result.ok ? `ok in ${result.latencyMs}ms` : `failed (${result.errorKind})`}`,
    "settings",
    { errorKind: result.errorKind },
  );
  res.status(result.ok ? 200 : 502).json(result);
});

// POST /providers/chat — non-streaming completion through the provider chain
router.post("/providers/chat", async (req, res): Promise<void> => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  if (prompt.length > 20000) {
    res.status(413).json({ error: "prompt is too large" });
    return;
  }

  const system = typeof raw.system === "string" ? raw.system : undefined;
  const provider = readProviderId(raw.provider);
  const tier = readTier(raw.tier);

  try {
    const result = await chat(
      { messages: [{ role: "user", content: prompt }], system, maxTokens: 2048 },
      { provider, tier },
    );
    res.json({
      text: result.text,
      provider: result.provider,
      providerLabel: result.providerLabel,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err) {
    req.log?.error({ err }, "Provider chat request failed");
    const { status, body } = failureResponse(err);
    res.status(status).json(body);
  }
});

// POST /providers/reload — re-read provider configuration from the environment
// after secrets have been changed, without restarting the server.
router.post("/providers/reload", async (_req, res): Promise<void> => {
  resetRegistry();
  await logNexusEvent("info", "AI provider configuration reloaded", "settings");
  res.json(statusPayload());
});

export default router;
