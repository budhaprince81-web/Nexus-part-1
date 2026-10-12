# NEXUS AI — Autonomous AI Operating System

A personal AI operating system: a futuristic HUD over a **multi-provider reasoning
engine**, an **autonomous task runtime**, a subordinate **JARVIS** assistant, and
controlled computer/browser automation — built as a pnpm monorepo.

Reliability first, accuracy second, safe autonomy third.

---

## 1. What it does

| Capability | Status | Where |
|---|---|---|
| Multi-provider AI engine (Anthropic, OpenAI, Groq, OpenRouter, Gemini, Ollama) with automatic fallback | ✅ implemented | `artifacts/api-server/src/ai/` |
| Streaming chat (SSE) with provider/model provenance | ✅ implemented | `src/routes/anthropic/index.ts` |
| Autonomous agent runtime: UNDERSTAND → PLAN → AUTHORIZE → EXECUTE → OBSERVE → VERIFY → REPORT | ✅ implemented | `src/ai/agent-runtime.ts` |
| Human-in-the-loop approval for consequential steps, pause/resume/cancel | ✅ implemented | `src/routes/nexus/agent-runs.ts` |
| JARVIS subordinate assistant + NEXUS verification of its results | ✅ implemented | `src/routes/nexus/agent-runs.ts` |
| Research / Coding / Vision (multimodal) / Planner agents | ✅ implemented | `src/routes/nexus/*.ts` |
| Isolated code sandbox with guardrails | ✅ implemented | `src/lib/sandbox-exec.ts` |
| Memory store with search, editable and deletable | ✅ implemented | `src/routes/nexus/memory.ts` |
| Voice: STT, TTS, English + Nepali, push-to-talk, interruptible playback | ✅ implemented | `nexus-ui/src/hooks/use-voice.ts` |
| Trading workspace — mathematical scenarios only, no market feed, no orders | ✅ implemented | `nexus-ui/src/pages/trading.tsx` |
| 2050 HUD: energy core, glass panels, boot sequence, low-resource + reduced-motion modes | ✅ implemented | `nexus-ui/src/components/hud/` |

Honest by construction: nothing in this system invents data, progress, tool
results or market prices. When something cannot be verified the API says so
explicitly (see "Honesty guarantees" below).

---

## 2. Quick start

```bash
# 1. Install (lockfile is authoritative; do not upgrade dependencies)
pnpm install --frozen-lockfile

# 2. Provide configuration — see .env.example for every variable
export DATABASE_URL="postgresql://user:password@host:5432/nexus"
export ANTHROPIC_API_KEY="..."      # or GROQ_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY

# 3. Create/refresh the database schema
pnpm --filter @workspace/db run push

# 4. Run the stack
pnpm --filter @workspace/api-server run dev      # API + SSE on :8080 (PORT)
pnpm --filter @workspace/nexus-ui run dev        # HUD on :3000 (PORT)

# 5. Verify
pnpm run typecheck        # all packages
pnpm run test             # api-server engine + runtime suites, lib suites
pnpm run build            # production build of every artifact
```

On Replit, use **Secrets** for every value in `.env.example`. The `Project` run
button starts the artifacts (HUD + API server); the FastAPI service is a separate
workflow.

---

## 3. AI providers

Configuration is entirely server-side. `GET /api/providers` returns *whether*
each provider is configured, its model per tier, its capabilities and live
telemetry — never a credential value.

```jsonc
// GET /api/providers  (abridged)
{
  "configuredProviders": ["groq"],
  "defaultProvider": "groq",
  "fallbackProviders": ["anthropic"],
  "mockProviderEnabled": false,
  "aiAvailable": true,
  "providers": [
    { "id": "groq", "configured": true,
      "models": { "fast": "llama-3.1-8b-instant", "balanced": "openai/gpt-oss-120b", "reasoning": "openai/gpt-oss-120b" },
      "capabilities": { "streaming": true, "vision": false, "jsonMode": true },
      "metrics": { "successes": 12, "failures": 1, "avgLatencyMs": 480, "inputTokens": 9000, "outputTokens": 4100 } }
  ]
}
```

**Routing rules**

1. An explicitly requested provider (or `NEXUS_DEFAULT_PROVIDER`) goes first.
2. Then `NEXUS_FALLBACK_PROVIDERS`.
3. Then any other *configured* provider, as a last resort.
4. `strict: true` (used by the "probe" button) disables 2–4.

**Failure handling**

| Condition | Behaviour |
|---|---|
| Network failure, timeout, 429, 5xx | Retried with bounded exponential backoff + jitter, honouring `retry-after` |
| 401/403, 400/404/422, 402 quota | **Not** retried — classified and surfaced immediately |
| Malformed JSON from a provider | Reported as `malformed`, never treated as success |
| Primary provider unavailable | Transparent fallback; the response records `fallbackUsed` and which providers were attempted |
| Streaming failure after tokens were sent | Surfaced as an error — the answer is **never** replayed by a second vendor |

**Model tiers.** Callers ask for a tier (`fast` / `balanced` / `reasoning`) and the
engine maps it to the right model per provider, so a light task does not burn a
heavy model. Override with `<PROVIDER>_MODEL[_FAST|_REASONING]`.

---

## 4. Autonomous agent runtime

```
UNDERSTAND → PLAN → AUTHORIZE → EXECUTE → OBSERVE → VERIFY → REPORT
```

* `POST /api/nexus/agents/run` `{ goal, context? }` → `202` with a run record.
* `GET  /api/nexus/agents/runs/:id` → live plan, per-step status, verification
  notes and the final report.
* `POST /api/nexus/agents/runs/:id/{pause|resume|cancel}`.
* Consequential steps (roles that modify the world: Automation, Browser, Deploy,
  Security, Filesystem) **stop and wait** for an approval in the Action Queue.
  Approving runs the registered executor for real; unsupported action types
  report plainly that nothing was executed.
* Every step is verified by an independent provider call before being marked
  complete; a step that produces byte-identical output on retry is detected as a
  loop and blocked.
* Independent steps run concurrently (bounded), dependent steps receive the
  verified output of their dependencies as context.

### JARVIS

* `POST /api/nexus/jarvis/assign` `{ task }` — NEXUS delegates a validated task.
* `GET  /api/nexus/jarvis/status` — distinct status indicator (active/completed/failed).
* `POST /api/nexus/jarvis/tasks/:id/verify` — NEXUS re-inspects JARVIS's result
  with an independent, deliberately sceptical verification call.

JARVIS is not a second application: it shares the same engine, database, memory
and approval flow, with its own role prompt, task history and status.

> Roles are *prompts executed by the configured model*. The system never claims
> that multiple models collaborated unless multiple calls were actually made.

---

## 5. Honesty guarantees

* **No invented memories, sources, live data or tool results.** A step with no
  output fails; it is never marked complete.
* **No fake progress.** Every status comes from a persisted record written after
  the work happened.
* **Approvals execute for real.** The old "execution simulation complete"
  message is gone: approval runs the sandbox executor, or states that no
  executor is registered.
* **Retrieved content is data, not instructions.** System prompts instruct the
  model to treat files, tool output and retrieved text as untrusted.
* **The simulation provider is opt-in and labelled.** `NEXUS_ALLOW_MOCK_PROVIDER`
  is off by default, never counts as "AI available", and marks every response
  `SIMULATED`.
* **Trading is a calculator, not a broker.** No market feed, no order placement,
  no profit claims; source, freshness and compute time are always displayed.

---

## 6. Security & privacy

* Credentials are read from server-side environment variables only. No key is
  bundled into frontend code, written to logs, included in error messages or
  returned by any endpoint.
* Sandbox code runs in a throwaway temp directory with a scrubbed environment, a
  hard timeout and a blocked-pattern denylist — no network, no host `env`, and
  the temp directory is always removed.
* Automation paths are resolved and confined to the workspace root (prefix
  checks are not sufficient); shell interpolation was removed.
* API errors return classified codes and safe messages, never stack traces.
* Human approval is required for consequential actions, and approvals expire.

---

## 7. Repository layout

| Path | Purpose |
|---|---|
| `artifacts/api-server/src/ai/` | Provider adapters, registry, engine, metrics, agent runtime, content helpers |
| `artifacts/api-server/src/lib/sandbox-exec.ts` | Shared isolated code execution |
| `artifacts/api-server/src/routes/` | HTTP API (`providers`, `anthropic` chat, `nexus/*`) |
| `artifacts/nexus-ui/src/` | React HUD (pages, `components/hud`, hooks) |
| `artifacts/api-server/fastapi/` | Optional FastAPI service (separate workflow) |
| `lib/db/` | Drizzle schema (incl. `agent_runs`) |
| `lib/api-zod/`, `lib/api-client-react/` | Generated API contracts |
| `.env.example` | Every environment variable, documented |

---

## 8. Testing

```bash
pnpm --filter @workspace/api-server run test    # 27 tests: engine + agent runtime
pnpm run test                                   # everything
```

The engine suite runs the real adapters against a stubbed `fetch`, covering
routing, retries, timeouts, SSE chunk boundaries, fallbacks, malformed
responses, multimodal translation and credential hygiene. The runtime suite runs
planning, authorization, execution, verification, loop detection, concurrency
and cancellation against an in-memory store.

---

## 9. Known limitations

* Agent run telemetry (token/latency counters) is process-local and resets on
  restart; run history itself is durable in Postgres.
* The FastAPI service retains its own single-provider AI path.
* Browser automation is limited to approved connectors; arbitrary shell access is
  intentionally not implemented.
* Streaming fallback is only possible before the first token is emitted (by
  design — see §3).
* Market data integration is deliberately absent; the Trading workspace is a
  risk calculator only.
