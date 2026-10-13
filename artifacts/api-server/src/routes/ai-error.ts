/**
 * Maps engine failures onto honest HTTP responses.
 *
 * Provider payloads, keys and stack traces are never forwarded — only the
 * classified kind and a safe message.
 */

import type { Request, Response } from "express";
import {
  AllProvidersFailedError,
  NoProvidersConfiguredError,
  ProviderError,
} from "../ai/index.ts";

export interface AiErrorResult {
  status: number;
  body: Record<string, unknown>;
}

export function aiErrorResult(err: unknown): AiErrorResult {
  if (err instanceof NoProvidersConfiguredError) {
    return { status: 503, body: { error: err.message, code: "no_provider_configured" } };
  }
  if (err instanceof AllProvidersFailedError) {
    return {
      status: 502,
      body: {
        error: "Every configured AI provider failed for this request.",
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

export function respondAiError(
  req: Request,
  res: Response,
  err: unknown,
  context: string,
): void {
  const { status, body } = aiErrorResult(err);
  req.log?.error({ err }, context);
  res.status(status).json(body);
}
