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
`/api/stream/*`. The browser never talks to a backend directly. The proxy forwards only an explicit
per-service list of method/path pairs and a fixed set of request headers, and deliberately drops any
client-supplied `x-tenant-id` (RFC-ACDP-0008 §6.4); see
[`route.ts`](<./app/api/proxy/[service]/[...path]/route.ts>).
Each backend's own routes, error codes and semantics are documented in its repo — see
[Where to read more](#where-to-read-more).

## Pages

- **Login** — single-operator passphrase sign-in (`/login`); the only public route.
- **Dashboard** — KPIs, recent runs, live event ticker, charts.
- **Scenarios** — full scenario catalog with a launch modal.
- **Runs / Run workbench** — live SSE event feed beside an interactive lineage DAG + context inspector.
- **Events** — cross-run history with filters and a live SSE firehose toggle.
- **Contexts** — registry search with full context-body inspection.
- **Lineage** — cross-run lineage DAG ("By run") and `lineage_id` version-chain lookup.
- **Agents / Registries** — known DIDs; registry health + capabilities-probe verdict, and registry
  enrollment management.
- **Trust** — deployment-wide receipt coverage, DID-method breakdown, and the fail-closed
  revocation-violations table.
- **Security** — the control-plane revocation feed, per-registry JWKS, transparency-log witness
  state, and the alert worklist with acknowledgement.
- **Observability** — service health, Prometheus metrics, Jaeger trace links.
- **Config** — service connections, webhooks, SDK matrix.

## Scripts

```bash
npm run dev        npm run dev:demo    npm run dev:real    npm run build      npm run start
npm run typecheck  npm run lint        npm test            npm run test:watch npm run test:coverage
npm run test:integration   # Playwright against real backends (see Testing below)
```

`node scripts/smoke-routes.mjs` fetches every top-level route and fails on any non-200
(`SMOKE_BASE_URL` overrides the target; defaults to `https://console.agentcontextdistributionprotocol.io`).

## Testing

Tests use [Vitest](https://vitest.dev) (jsdom) and live in [`test/__tests__/`](./test/__tests__).

```bash
npm test               # run once
npm run test:watch     # watch mode
npm run test:coverage  # v8 coverage (text + html report under coverage/)
```

Coverage spans `lib/**`, `app/api/**`, `components/**` and the page files under `app/**` — not just
pure logic and route handlers, so the surfaces that render a verdict to an operator are measured too.
What's covered:

- **Pure logic** — `lib/utils/*` (format, ctx_id/DID parsing, `cn`), `lib/server/integrations.ts`.
- **API client** — both demo and real (proxy-path) branches of `lib/api/client.ts`, plus `fetcher.ts`.
- **Route handlers** — the proxy (`app/api/proxy/[service]/[...path]`) and both SSE relays
  (`app/api/stream/*`): header allow-listing (incl. dropping `x-tenant-id`), server-side bearer injection, response scrubbing, and
  502 fallbacks. Because these import `next/server`, their test files opt into the Node environment
  with a `// @vitest-environment node` docblock.
- **The trust-verdict core** — `lib/verify/*` (the acdp-wasm checks, DID-document/key resolution, and
  the hook every trust surface renders from) and `lib/utils/revocation.ts` (the fail-closed
  revocation model every trust surface derives from).
- **The real wasm verifier** — `wasm-fixtures.test.ts` loads the actual `acdp_wasm_bg.wasm` instead
  of mocking it, and drives it over the committed demo fixtures; it is the gate for acdp-wasm bumps.
- **Auth gate** — the root `middleware.ts` (session validation, fail-open/closed env-var behavior,
  CSRF/Origin check) and `app/api/auth/{login,logout}` (`middleware.test.ts`, `auth-route.test.ts`).
- **Store & hooks** — the preferences store (incl. localStorage persistence), the React Query hooks,
  and `useDebounced` / `useMounted` / `useNow`.
- **Component & page render tests** — the trust-relevant surfaces (context verdicts, the trust page,
  dashboard revocation state, registry cards and their capabilities/profile disclosure, the SDK
  matrix, transparency-log witness state and alert acknowledgement) and cross-cutting a11y/render
  checks (focus management, table scroll behavior, error-boundary panels).
- **Mock-data invariants** — structural checks over `lib/data/mock-data.ts`.

Shared source/AST-level test machinery lives in [`test/support/`](./test/support); `test/setup.ts` also
shims Web Storage so the suite runs on Node 26 as well as the pinned Node 24.

### Real-backend integration suite

[`test/integration/`](./test/integration) (Playwright, [`playwright.config.ts`](./playwright.config.ts)) is
separate from the Vitest tree and is **not** run by `npm test`. `npm run test:integration` drives a
production build of this app against a real `acdp-playground` stack, which must already be up:

```bash
cd ../acdp-playground && LLM_PROVIDER=mock make up-full
```

The suite seeds real runs through the playground and asserts the stack's real, honest emptiness for
pages fed by registry webhooks (that stack ships with webhooks disabled).

House style: mock upstreams with `vi.stubGlobal('fetch', …)` and env with `vi.stubEnv`, cleaned up in
`afterEach`. Follow the existing files (`fetcher.test.ts`, `integrations.test.ts`) when adding tests.

## CI/CD & Deployment

GitHub Actions workflows in [`.github/workflows/`](./.github/workflows):

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push / PR to `main` | Lint → typecheck → test (with coverage artifact) → build, on Node 24 (`.nvmrc`), with `.next/cache` reuse. |
| `docker.yml` | push / PR to `main`, tags `v*` | Builds the image; on `main` and tags publishes to `ghcr.io/agentcontextdistributionprotocol/acdp-ui-console`. PRs build only. |
| `smoke.yml` | nightly + manual | Runs `scripts/smoke-routes.mjs` against the deployed console. |
| `bump-acdp.yml` | `repository_dispatch: acdp-released` (from acdp-rs's release workflow) + manual | Opens a bump PR for `@agentcontextdistributionprotocol/acdp-wasm` via the shared `acdp-ci` `bump-consume.yml`. |
| `notify-website.yml` | `docs/**` / `README.md` on `main` | Notifies `acdp-website` to re-sync docs. This repo has no `docs/` directory, so in practice only `README.md` changes (or a manual run) trigger it. |
| `auto-merge.yml` | PR | Delegates to the shared `acdp-ci` auto-merge workflow, which can merge a green PR without human review. It is not armed for a breaking `acdp-wasm` bump (on 0.x, a minor counts as breaking). |

Dependency updates are automated via [Dependabot](./.github/dependabot.yml) (monthly npm + actions).
The `typescript` major is held below `6.1` via an `ignore` entry, since typescript-eslint hard-throws
above that range until [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
lands; see [issue #59](https://github.com/agentcontextdistributionprotocol/acdp-ui-console/issues/59)
for the unblock condition. `acdp-wasm` is on 0.x, where a minor is a semantics change, so Dependabot's own minor bumps for it are
excluded; only `bump-acdp.yml`'s dispatch-driven PR delivers them, and a minor waits for human review
(gated by the real-binary `wasm-fixtures.test.ts`). `@types/node` is similarly held below `25` — types must track this repo's
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
4+ diceware words or 20+ random characters. Note this applies to any production-mode image, including a
sibling compose stack's console (e.g. the playground's `make up-full` sets no password, so its console
on `:3000` answers 503 on gated routes until you supply one).

## Where to read more

The console is a client of the ACDP backends. Their docs are authoritative for their own contracts; this
repo links to them instead of restating them.

| Topic | Read |
| --- | --- |
| Control-plane routes, `errorCode`s, `/healthz`, enrollment, log-witness, revocations | [`acdp-control-plane` `docs/API.md`](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/API.md) |
| Control-plane auth (API key / JWT, `TOKEN_ISSUANCE_ENABLED`) and tenancy (`X-Tenant-Id`) | [`AUTH.md`](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/AUTH.md), [`TENANCY.md`](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/TENANCY.md) |
| Registry HTTP API (search, lineages, `.well-known/*`) | [`acdp-registry-rs` `docs/HTTP-API.md`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/HTTP-API.md) |
| Receipts, webhooks, registry auth/JWKS | [`RECEIPTS.md`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/RECEIPTS.md), [`WEBHOOKS.md`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/WEBHOOKS.md), [`AUTHENTICATION.md`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/AUTHENTICATION.md) |
| Playground run API, scenario catalog, local stack | [`acdp-playground` `docs/http-api.md`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/http-api.md), [`scenarios.md`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/scenarios.md), [`getting-started.md`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/getting-started.md) |
| `acdp-wasm` verifier surface and errors | [`acdp-rs` `bindings/acdp-wasm/README.md`](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/bindings/acdp-wasm/README.md), [`docs/bindings.md`](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/docs/bindings.md), [`docs/errors.md`](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/docs/errors.md) |
| Protocol: RFCs, error-code registry, version matrix | [`rfcs/README.md`](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/rfcs/README.md), [`registries/error-codes.md`](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/registries/error-codes.md), [`docs/version-matrix.md`](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/docs/version-matrix.md) |
| Python verifier | [`acdp-verifier-py`](https://github.com/agentcontextdistributionprotocol/acdp-verifier-py) |
| Ecosystem overview / agent-readable index | [`acdp-docs`](https://github.com/agentcontextdistributionprotocol/acdp-docs) (`README.md`, `llms.txt`) |
| Shared CI workflows (auto-merge, bump-consume) | [`acdp-ci`](https://github.com/agentcontextdistributionprotocol/acdp-ci) |
| Website that re-syncs this README | [`acdp-website`](https://github.com/agentcontextdistributionprotocol/acdp-website) |
