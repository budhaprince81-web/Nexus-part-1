# NEXUS AI Operating System

A production-grade, JARVIS-class AI OS in a full-stack TypeScript monorepo: a
cyberpunk glassmorphism HUD over a **multi-provider AI engine**, an **autonomous
task runtime** with human-in-the-loop approval, a subordinate **JARVIS**
assistant, isolated code execution, memory, and real-time telemetry.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server + SSE (port 8080)
- `pnpm --filter @workspace/nexus-ui run dev` — HUD frontend (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run test` — engine + agent-runtime + lib test suites (`node --test`)
- `pnpm run build` — production build of every artifact
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from `lib/api-spec/openapi.yaml`

Required env: `DATABASE_URL` and **at least one** provider key
(`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, or `OLLAMA_BASE_URL`). See `.env.example` for everything,
including optional routing and engine tuning.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React, Vite, Tailwind CSS v4, Framer Motion, Wouter
- **Backend**: Express 5, Orval codegen (OpenAPI → React Query hooks)
- **DB**: PostgreSQL + Drizzle ORM (`lib/db/src/schema/nexus.ts`, incl. `agent_runs`)
- **AI**: provider-agnostic engine in `artifacts/api-server/src/ai/` — Anthropic
  (native Messages API), OpenAI, Groq, OpenRouter, Ollama (OpenAI-compatible),
  and Google Gemini, with automatic fallback
- **Validation**: Zod (`zod/v4`), drizzle-zod

## Where things live

| Area | Path |
|------|------|
| Provider adapters, registry, engine, metrics | `artifacts/api-server/src/ai/` |
| Agent runtime (plan → execute → verify → report) | `artifacts/api-server/src/ai/agent-runtime.ts` |
| Isolated code execution (shared) | `artifacts/api-server/src/lib/sandbox-exec.ts` |
| API routes | `artifacts/api-server/src/routes/` |
| Frontend pages | `artifacts/nexus-ui/src/pages/` |
| HUD components | `artifacts/nexus-ui/src/components/hud/` |
| DB schema | `lib/db/src/schema/nexus.ts` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Voice hook | `artifacts/nexus-ui/src/hooks/use-voice.ts` |
| Optional Python service | `artifacts/api-server/fastapi/` |

## Architecture decisions

- **One engine, many vendors**: every AI feature calls `src/ai` (`chat`,
  `streamChat`, `complete`). No route imports a vendor SDK, so adding a provider
  is a registry entry, not a refactor.
- **Fallback with honest semantics**: retries are bounded and only for transient
  failures; streaming never replays a partially delivered answer from another
  vendor; a single-provider failure keeps its precise error kind so the HTTP
  status is meaningful (503 config, 400 auth, 502 upstream).
- **Injected runtime dependencies**: `createAgentRuntime()` takes a store and a
  completion function, so the whole loop is unit-testable without a DB or keys.
- **Approvals execute for real**: `POST /nexus/confirm/:id` runs the registered
  executor (sandbox) and otherwise states that nothing was executed.
- **Shared sandbox**: the sandbox route and the agent runtime use the same
  `lib/sandbox-exec.ts` guardrails rather than duplicating them.
- **No vector DB**: memory search is Postgres `ILIKE` — pragmatic, no extra service.
- **Generated API contract stays generated**: new endpoints (`/api/providers`,
  `/api/nexus/agents/*`, `/api/nexus/jarvis/*`) are consumed via small typed
  helpers in `artifacts/nexus-ui/src/lib/api.ts` rather than by editing orval output.

## Features

- 🌐 **2050 HUD**: energy core with reactive waveform, glass panels, ambient
  particles, grid lattice, cinematic boot sequence that runs *real* health and
  provider checks
- 🧠 **Multi-provider reasoning** with provider status panel, live latency/token
  telemetry and a real one-click connectivity probe
- 🤖 **Autonomous agent ops**: goal → plan → verified execution, with pause,
  resume, cancel and approval gating, visible step-by-step on the dashboard
- 🦾 **JARVIS**: subordinate assistant with its own status, task history, and
  independent verification by NEXUS
- 🎙️ **Voice**: STT + TTS, English and Nepali, push-to-talk, wake word,
  interruptible playback, explicit error states (permission/no mic/unsupported)
- 💬 **Streaming chat** with provider/model badge and surfaced errors
- 🔬 **Research / Coding / Vision** agents, all provider-agnostic and multimodal
- 💻 **Code sandbox** (JS/TS/Python/Bash) with guardrails and a shared executor
- 📊 **Trading workspace**: risk math only — no market feed, no orders, explicit
  source/freshness/computed-at provenance
- ♿ **Accessibility**: keyboard navigation, `prefers-reduced-motion` honoured
  everywhere, plus a low-resource mode that disables particles/blur on weak devices

## User preferences

- Futuristic cyberpunk/JARVIS aesthetic — always dark, cyan primary (#00D4FF)
- Rajdhani + Space Mono font stack
- Nepali language support matters — keep labels translatable
- Wake word: "Nexus"

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any `openapi.yaml`
  change before touching frontend generated types
- After DB schema changes (e.g. `agent_runs`), run
  `pnpm --filter @workspace/db run push` **then restart the API server**
- Provider credentials are read per request: after changing a secret you can use
  **Settings → AI Providers → reload** instead of restarting
- `NEXUS_ALLOW_MOCK_PROVIDER=true` enables a labelled simulation provider for
  local testing without keys — never leave it on in production
- The Vite dev server host allowlist comes from `NEXUS_ALLOWED_HOSTS`
  (comma-separated). It is deliberately not `allowedHosts: true`
- Battery API works in Chrome/Edge only; SpeechRecognition needs HTTPS or localhost
