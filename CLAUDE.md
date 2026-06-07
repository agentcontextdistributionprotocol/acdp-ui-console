# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

ACDP UI Console — a Next.js 15 (App Router) orchestration and observability console for the
Agent Context Description Protocol. React 19, TypeScript strict, custom CSS variables (no Tailwind).
Follows the MACP UI Console proxy/demo conventions and the AITP `C.*` design-token pattern.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Dev server (demo mode by default)
npm run dev:real         # Dev server against real backends (DEMO=false)
npm run build            # Production build
npm run start            # Start production server
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm test                 # Vitest
```

## Architecture

```
Browser → app pages → lib/api/client.ts → lib/api/fetcher.ts → /api/proxy/[service]/[...path] → backend
Browser → EventSource → /api/stream/runs/[runId]            → playground SSE relay
Browser → EventSource → /api/stream/events                  → control-plane SSE relay
```

Four upstream services proxied through one route handler: `playground` (FastAPI :8000),
`control-plane` (NestJS :3001), `registry-a` (:8100), `registry-b` (:8200). The browser never
calls them directly; the proxy injects the control-plane bearer token server-side.

### Demo mode

`NEXT_PUBLIC_ACDP_UI_DEMO_MODE` (default `true`). Every function in `lib/api/client.ts` branches:
demo returns mock data from `lib/data/mock-data.ts` with a small delay; real mode hits the proxy.
The whole product surface works with zero backends. `use-live-run` replays the recorded mock event
stream in demo mode and connects to the SSE relay in real mode.

### State

- **TanStack Query** for all server state: `staleTime` 20s, `retry` 1, no refetch-on-focus.
- **Zustand + localStorage** (`lib/stores/preferences-store.ts`) for demo mode, service URLs, API key, Jaeger URL.

## Naming rules

- All pages are `'use client'`; only `layout.tsx` and the route handlers under `app/api/` are server code.
- CSS variables only — no Tailwind. Use the `C.*` tokens from `lib/colors.ts` for inline styles, or the
  semantic classes in `app/globals.css` (`.card`, `.kpi-card`, `.event-row`, `.badge-*`, …).
- All colours come from CSS variables; raw hex lives only in `app/globals.css`.
- No direct `fetch()` in components — go through `lib/api/client.ts`.
- Data fetching is via React Query hooks, not `useEffect` (except SSE in `use-live-run` / `use-global-events`).
- Icons: `lucide-react`. Charts: `recharts`. DAGs: `@xyflow/react`.

## Layout

- `app/` — pages + `api/proxy` + `api/stream` route handlers.
- `components/` — by domain: `layout/`, `ui/`, `dashboard/`, `scenarios/`, `runs/`, `events/`,
  `contexts/`, `registries/`, `observability/`, `config/`, `charts/`.
- `lib/api/` — `client.ts` (demo/real branching), `fetcher.ts` (proxy wrapper).
- `lib/data/mock-data.ts` — full demo dataset.
- `lib/hooks/` — React Query + SSE hooks. `lib/stores/` — Zustand. `lib/server/integrations.ts` — env URL config.
- `lib/utils/` — `format.ts`, `acdp.ts` (ctx_id / DID parsing), `cn.ts`.

## Environment

See `.env.example`. Key vars: `NEXT_PUBLIC_ACDP_UI_DEMO_MODE`, `PLAYGROUND_BASE_URL`,
`CONTROL_PLANE_BASE_URL`, `REGISTRY_A_BASE_URL`, `REGISTRY_B_BASE_URL`, `CONTROL_PLANE_API_KEY`,
`JAEGER_URL`. Path alias `@/*` maps to the repo root.
