# NEXUS AI Operating System

A production-grade JARVIS-class AI OS built on a full-stack TypeScript monorepo. Features a cyberpunk glassmorphism HUD with Iron Man-style orbital ring animations, Claude-powered streaming chat, multi-agent planner, isolated code sandbox, semantic memory, and real-time system telemetry.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/nexus-ui run dev` — run the frontend (dynamic port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `ANTHROPIC_API_KEY` — Claude API key

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React 18, Vite, Tailwind CSS v4, Framer Motion, Wouter (routing)
- **Backend**: Express 5, Orval codegen (OpenAPI → React Query hooks)
- **DB**: PostgreSQL + Drizzle ORM (`lib/db/src/schema/nexus.ts`)
- **AI**: Anthropic Claude via `lib/integrations-anthropic-ai` (`ANTHROPIC_API_KEY`)
- **Validation**: Zod (`zod/v4`), drizzle-zod
- **API spec**: `lib/api-spec/openapi.yaml` → codegen

## Where things live

| Area | Path |
|------|------|
| API routes | `artifacts/api-server/src/routes/` |
| Frontend pages | `artifacts/nexus-ui/src/pages/` |
| HUD components | `artifacts/nexus-ui/src/components/hud/` |
| DB schema | `lib/db/src/schema/nexus.ts` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| AI client | `lib/integrations-anthropic-ai/src/client.ts` |
| Voice hook | `artifacts/nexus-ui/src/hooks/use-voice.ts` |
| Language hook | `artifacts/nexus-ui/src/hooks/use-language.ts` |

## Architecture decisions

- **Python FastAPI → Node.js/Express**: Backend stays in the monorepo's Express 5 setup; Python agents are simulated in TypeScript.
- **No vector DB**: Semantic memory uses Postgres full-text/ilike search — pragmatic first build, no Qdrant dependency.
- **ANTHROPIC_API_KEY direct**: Anthropic client uses the secret directly, not via Replit AI Integrations proxy (user declined upgrade).
- **Orval codegen**: All API types and React Query hooks are generated from `openapi.yaml` — never write API fetchers by hand.
- **SSE streaming**: Chat messages stream token-by-token via Server-Sent Events for real-time feel.

## Features

- 🌐 **Iron Man HUD Dashboard**: Orbital arc reactor rings, live CPU/RAM/Battery/Network gauges
- 🎙️ **Voice Assistant**: Wake word "Nexus", STT (Web Speech API), TTS output, push-to-talk in chat
- 💬 **Claude Chat**: SSE streaming, conversation history, voice input/output
- 🧠 **Semantic Memory**: Store/search memory records in Postgres
- 🤖 **Agent Console**: Multi-agent planner with Claude-powered execution DAG
- 💻 **Code Sandbox**: Isolated execution (JS/TS/Python/Bash) with security guardrails
- 🌤️ **Weather Widget**: Live weather via Open-Meteo API (no key needed), geolocation-aware
- 📅 **Calendar Widget**: Inline calendar with today highlighted
- 🌍 **English + Nepali**: Full UI translation toggle (EN/नेपाली)
- 🔒 **Security**: 5-stage guardrails, human-in-the-loop action confirmation

## User preferences

- Futuristic cyberpunk/JARVIS aesthetic — always dark mode, cyan primary (#00D4FF)
- Full Rajdhani + Space Mono font stack
- Nepali language support matters — keep all labels translatable
- Wake word: "Nexus"

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any `openapi.yaml` change before touching frontend
- After DB schema changes, run `pnpm --filter @workspace/db run push` then restart the API server
- Battery API (`navigator.getBattery()`) only works in Chrome/Edge; Firefox silently returns null
- SpeechRecognition only works over HTTPS or localhost — Replit preview uses HTTPS, so it works

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
