# ACDP UI Console

Orchestration and observability console for the **Agent Context Distribution Protocol (ACDP)**.
Launch playground scenarios, watch context publication/retrieval flow live, explore cross-registry
lineage DAGs, and monitor the control plane — all from one console.

Built with Next.js 16 (App Router), React 19, TypeScript (strict), TanStack Query, Zustand,
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
npm run dev        npm run dev:real    npm run build       npm run start
npm run typecheck  npm run lint        npm test            npm run test:coverage
```

`node scripts/smoke-routes.mjs` fetches every top-level route and fails on any non-200
(`SMOKE_BASE_URL` overrides the target; defaults to production).

## Testing

Tests use [Vitest](https://vitest.dev) (jsdom) and live in [`test/__tests__/`](./test/__tests__).

```bash
npm test               # run once
npm run test:watch     # watch mode
npm run test:coverage  # v8 coverage (text + html report under coverage/)
```

Coverage spans `lib/**` and the `app/api/**` route handlers. What's covered:

- **Pure logic** — `lib/utils/*` (format, ctx_id/DID parsing, `cn`), `lib/server/integrations.ts`.
- **API client** — both demo and real (proxy-path) branches of `lib/api/client.ts`, plus `fetcher.ts`.
- **Route handlers** — the proxy (`app/api/proxy/[service]/[...path]`) and both SSE relays
  (`app/api/stream/*`): header allow-listing, server-side bearer injection, response scrubbing, and
  502 fallbacks. Because these import `next/server`, their test files opt into the Node environment
  with a `// @vitest-environment node` docblock.
- **The real wasm verifier** — `wasm-fixtures.test.ts` loads the actual `acdp_wasm_bg.wasm` instead
  of mocking it, and drives it over the committed demo fixtures; it is the gate for acdp-wasm bumps.
- **Auth gate** — the root `middleware.ts` (session validation, fail-open/closed env-var behavior,
  CSRF/Origin check) and `app/api/auth/{login,logout}` (`middleware.test.ts`, `auth-route.test.ts`).
- **Store & hooks** — the preferences store (incl. localStorage persistence) and `useDebounced` /
  `useMounted`.
- **Mock-data invariants** — structural checks over `lib/data/mock-data.ts`.

House style: mock upstreams with `vi.stubGlobal('fetch', …)` and env with `vi.stubEnv`, cleaned up in
`afterEach`. Follow the existing files (`fetcher.test.ts`, `integrations.test.ts`) when adding tests.

## CI/CD & Deployment

GitHub Actions workflows in [`.github/workflows/`](./.github/workflows):

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push / PR to `main` | Lint → typecheck → test (with coverage artifact) → build, on Node 24 (`.nvmrc`), with `.next/cache` reuse. |
| `docker.yml` | push / PR to `main`, tags `v*` | Builds the image; on `main` and tags publishes to `ghcr.io/agentcontextdistributionprotocol/acdp-ui-console`. PRs build only. |
| `smoke.yml` | nightly + manual | Runs `scripts/smoke-routes.mjs` against the deployed console. |
| `notify-website.yml` | `docs/**` / `README.md` on `main` | Notifies `acdp-website` to re-sync docs. |
| `auto-merge.yml` | PR | Delegates to the shared `acdp-ci` auto-merge workflow, which can merge a green PR without human review. |

Dependency updates are automated via [Dependabot](./.github/dependabot.yml) (monthly npm + actions).
The `typescript` major is held below `6.1` via an `ignore` entry, since typescript-eslint hard-throws
above that range until [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
lands; see [issue #59](https://github.com/agentcontextdistributionprotocol/acdp-ui-console/issues/59)
for the unblock condition. `@types/node` is similarly held below `25` — types must track this repo's
pinned Node 24 runtime (`.nvmrc`), not the newest publish — see `.github/dependabot.yml` for the
guard.

**Deployment.** The primary target is Vercel (Next.js git integration; see [`vercel.json`](./vercel.json)).
A multi-stage [`Dockerfile`](./Dockerfile) produces a standalone image (`output: 'standalone'`) — the
published GHCR image bakes demo mode (`NEXT_PUBLIC_ACDP_UI_DEMO_MODE=true`) since `NEXT_PUBLIC_*` is
inlined at build time; the sibling compose stacks override that ARG to build a real-mode image.

**`ACDP_UI_CONSOLE_PASSWORD` is required in any production deployment that calls the real backends.**
Root `middleware.ts` gates `/api/proxy/*` and `/api/stream/*` behind a signed operator-session cookie
(`/login` → `POST /api/auth/login`); with the var unset, gated requests 503 in production (fail
closed) but pass through unauthenticated in development (fail open, with a console warning) so the
zero-setup demo keeps working. A pure demo deployment that never flips `NEXT_PUBLIC_ACDP_UI_DEMO_MODE`
to `false` never calls the gated routes and doesn't need the var configured. There is no login
rate-limiting (an accepted tradeoff for a single-operator tool), so pick a high-entropy passphrase —
4+ diceware words or 20+ random characters.

## Related repositories

The console is a client of the ACDP backends — see their own docs rather than duplicating them here:

- [`agentcontextdistributionprotocol`](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol) — the protocol spec / RFCs.
- [`acdp-playground`](https://github.com/agentcontextdistributionprotocol/acdp-playground) — scenario catalog + run execution.
- [`acdp-control-plane`](https://github.com/agentcontextdistributionprotocol/acdp-control-plane) — runs, events, agents, registries, metrics.
- [`acdp-registry-rs`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs) — context registry (storage, search, JWKS).
- [`acdp-rs`](https://github.com/agentcontextdistributionprotocol/acdp-rs) / [`acdp-verifier-py`](https://github.com/agentcontextdistributionprotocol/acdp-verifier-py) — SDKs and the verifier.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.
