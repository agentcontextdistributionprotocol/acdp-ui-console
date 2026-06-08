# ACDP UI Console

Orchestration and observability console for the **Agent Context Distribution Protocol (ACDP)**.
Launch playground scenarios, watch context publication/retrieval flow live, explore cross-registry
lineage DAGs, and monitor the control plane — all from one console.

Built with Next.js 15 (App Router), React 19, TypeScript (strict), TanStack Query, Zustand,
Recharts, and React Flow. No Tailwind — styling is pure CSS variables with a `C.*` design-token object.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 — demo mode, no backend required
```

Demo mode is on by default (`NEXT_PUBLIC_ACDP_UI_DEMO_MODE=true`), so every page is fully populated
with realistic mock data. To connect to real services, copy `.env.example` to `.env.local`, set the
service URLs, and run:

```bash
npm run dev:real
```

## Services

| Service        | Default URL             | Role                                      |
| -------------- | ----------------------- | ----------------------------------------- |
| Playground     | `http://localhost:8000` | Scenario catalog + run execution (SSE)    |
| Control Plane  | `http://localhost:3001` | Runs, events, agents, registries, metrics |
| Registry A / B | `:8100` / `:8200`       | Context storage + search + capabilities   |

All requests are proxied through `/api/proxy/[service]/[...path]`; SSE streams are relayed through
`/api/stream/*`. The browser never talks to a backend directly.

## Pages

- **Dashboard** — KPIs, recent runs, live event ticker, charts.
- **Scenarios** — full scenario catalog with a launch modal.
- **Runs / Run workbench** — live SSE event feed beside an interactive lineage DAG + context inspector.
- **Events** — cross-run history with filters and a live SSE firehose toggle.
- **Contexts** — registry search with full context-body inspection.
- **Lineage** — cross-run lineage explorer.
- **Agents / Registries** — known DIDs and registry health + capabilities.
- **Observability** — service health, Prometheus metrics, Jaeger trace links.
- **Config** — service connections, webhooks, SDK matrix.

## Scripts

```bash
npm run dev        npm run build       npm run start
npm run typecheck  npm run lint        npm test
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.
