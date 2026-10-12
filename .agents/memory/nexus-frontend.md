---
name: NEXUS frontend architecture
description: React+Vite frontend structure, components, hooks, and routing for NEXUS AI OS
---

## Stack
- React + Vite + TypeScript, Tailwind v4, Framer Motion
- Router: Wouter (base = `import.meta.env.BASE_URL`)
- State: TanStack Query (React Query) — hooks from `@workspace/api-client-react` (Orval-generated)
- API calls: always use `${BASE_URL}api/...` pattern via generated hooks

## Pages (routes in App.tsx)
- `/` → dashboard.tsx — Arc Reactor HUD, gauges, weather, calendar, agent grid, action queue, logs
- `/chat` → chat.tsx — SSE streaming chat with TTS
- `/vision` → vision.tsx — image upload/camera + 6 analysis modes (describe/OCR/detect_ui/document/screen_read/custom)
- `/research` → research.tsx — deep research with depth/format selectors
- `/coding` → coding.tsx — "Build This" code generator with SSE stream + file tree viewer
- `/tasks` → tasks.tsx — full CRUD task manager with stats, filters, priority, tags, due dates
- `/agents` → agents.tsx
- `/sandbox` → sandbox.tsx
- `/memory` → memory.tsx
- `/settings` → settings.tsx

## Key Components
- `components/layout.tsx` — top HUD bar, collapsible sidebar (grouped: Core/AI Agents/Tools/System), mobile overlay sidebar, voice wake-word flash, global particle canvas
- `components/hud/arc-reactor.tsx` — orbital SVG rings
- `components/hud/voice-indicator.tsx` — VoiceIndicator + VoiceWaveform
- `components/hud/particles.tsx` — canvas-based particle system with mouse repulsion + connection lines
- `components/hud/thinking.tsx` — ThinkingIndicator (scanning rings), ThinkingDots, ThinkingOverlay
- `components/hud/notifications-center.tsx` — bell dropdown with unread badge, real-time poll at 5s
- `components/ui/cyber.tsx` — CyberPanel, CyberButton, CyberInput, CyberBadge

## Hooks
- `use-voice.ts` — Web Speech API, wake word "nexus", lang-aware (en-US / ne-NP)
- `use-language.ts` — EN/NE translations via LangContext; `useLangContext()` returns `{ t, lang, setLanguage }`
- `use-weather.ts` — Open-Meteo free API, geolocation-aware, fallback Kathmandu

## Sidebar Nav Groups
Core: HUD, Comms  
AI Agents: Vision, Research, Coding, Agents  
Tools: Sandbox, Tasks, Memory  
System: Settings

## Notable Patterns
- Framer Motion `layoutId="nav-active"` for animated active indicator
- All query hooks need explicit `queryKey` in options (Orval requirement)
- SSE in coding.tsx: fetch with `response.body.getReader()`, parse `data: {...}\n\n` lines
- Vision page: camera via `getUserMedia`, capture to canvas, convert to base64
