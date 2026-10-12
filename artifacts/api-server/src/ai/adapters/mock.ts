/**
 * Opt-in deterministic "simulation" provider.
 *
 * Purpose: let the full engine (fallback, streaming, retries, metrics, UI)
 * be exercised end-to-end in tests and during setup *without* real credentials.
 *
 * Safety properties:
 *  - Disabled unless `NEXUS_ALLOW_MOCK_PROVIDER=true` is explicitly set.
 *  - Never selected as an automatic default while a real provider is configured.
 *  - Every response is clearly labelled so it can never be mistaken for a real
 *    model answer.
 */

import { contentToText } from "../content.ts";
import { ProviderError } from "../errors.ts";
import type {
  AdapterChatParams,
  ModelTier,
  ProviderAdapter,
  ProviderChatResponse,
  StreamDelta,
} from "../types.ts";

export const MOCK_MARKER = "[SIMULATED — no AI provider configured]";

interface MockBehavior {
  /** Force the next N calls to fail with this kind before succeeding. */
  failTimes: number;
  failKind: "rate_limit" | "unavailable" | "timeout" | "auth";
  /** Artificial latency, in ms. */
  latencyMs: number;
  /** Text returned on success. */
  text: string;
}

const behavior: MockBehavior = {
  failTimes: 0,
  failKind: "unavailable",
  latencyMs: 0,
  text: "Simulated response: the NEXUS AI engine is reachable and streaming correctly.",
};

/** Test/setup hook — resets to a predictable state. */
export function configureMockProvider(patch: Partial<MockBehavior> = {}): void {
  behavior.failTimes = patch.failTimes ?? 0;
  behavior.failKind = patch.failKind ?? "unavailable";
  behavior.latencyMs = patch.latencyMs ?? 0;
  behavior.text = patch.text ?? behavior.text;
}

export function isMockProviderEnabled(): boolean {
  return process.env.NEXUS_ALLOW_MOCK_PROVIDER === "true";
}

export class MockAdapter implements ProviderAdapter {
  readonly id = "mock" as const;
  readonly label = "NEXUS Simulation";
  readonly envVar = "NEXUS_ALLOW_MOCK_PROVIDER";
  readonly docsUrl = "https://github.com/princebudha-tech/Autonomous-Nexus_ai";
  readonly capabilities = { streaming: true, vision: false, jsonMode: true } as const;
  readonly models: Record<ModelTier, string> = {
    fast: "nexus-sim-1",
    balanced: "nexus-sim-1",
    reasoning: "nexus-sim-1",
  };

  isConfigured(): boolean {
    return isMockProviderEnabled();
  }

  private fail(): void {
    if (behavior.failTimes > 0) {
      behavior.failTimes -= 1;
      throw new ProviderError({
        provider: this.label,
        kind: behavior.failKind,
        message: `Simulated ${behavior.failKind} failure`,
      });
    }
  }

  /**
   * The simulation answers in the shape the caller asked for. Any response that
   * is JSON carries an explicit `_simulated` flag, and free-text responses carry
   * the SIMULATED marker, so simulated output can never be mistaken for a real
   * model answer.
   */
  private simulate(params: AdapterChatParams): string {
    const system = params.system ?? "";
    const lastUser = [...params.messages].reverse().find((message) => message.role === "user");
    const userText = lastUser ? contentToText(lastUser.content) : "";

    if (/\bVerifier\b/i.test(system)) {
      return JSON.stringify({
        _simulated: true,
        satisfied: true,
        note: "Simulated verification: output is present and on-topic.",
      });
    }

    if (/\bPlanner\b/i.test(system)) {
      return JSON.stringify({
        _simulated: true,
        steps: [
          {
            id: "step-1",
            agent: "Research",
            description: `Gather the inputs needed for: ${userText.slice(0, 120)}`,
            status: "pending",
            tool: "answer",
            dependsOn: [],
            consequential: false,
          },
          {
            id: "step-2",
            agent: "Analysis",
            description: "Produce the final answer from the gathered inputs",
            status: "pending",
            tool: "answer",
            dependsOn: ["step-1"],
            consequential: false,
          },
        ],
      });
    }

    if (/"steps"|json only|respond with json/i.test(`${system} ${userText}`)) {
      return JSON.stringify({ _simulated: true, summary: behavior.text, keyPoints: [] });
    }

    return `${MOCK_MARKER}\n${behavior.text}\n\nEcho: ${userText}`.slice(0, 4000);
  }

  async chat(params: AdapterChatParams): Promise<ProviderChatResponse> {
    if (behavior.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, behavior.latencyMs));
    }
    this.fail();
    return {
      text: this.simulate(params),
      model: params.model,
      usage: { inputTokens: 12, outputTokens: 24 },
      finishReason: "end_turn",
    };
  }

  async *stream(params: AdapterChatParams): AsyncGenerator<StreamDelta, void, void> {
    // Fail before emitting anything so the engine's fallback path is testable.
    this.fail();
    const response = await this.chat(params);
    const words = response.text.split(" ");
    for (const [index, word] of words.entries()) {
      yield { text: index === 0 ? word : ` ${word}` };
    }
    if (behavior.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, behavior.latencyMs));
    }
    yield { usage: response.usage };
    yield { finishReason: response.finishReason };
  }
}
