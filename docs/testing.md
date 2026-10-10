# Testing

The console's tests run in three layers, from cheapest to most realistic:

1. **Vitest unit and render suite** (`test/__tests__/`): offline, runs on every push.
   Upstreams are mocked, except for one test that loads the real `acdp-wasm` binary.
2. **Route smoke scripts** (`scripts/smoke-routes.mjs`,
   `scripts/run-scenarios.mjs`): run against a deployed or local console.
3. **Playwright real-backend suite** (`test/integration/`): a production build of
   the console against a real `acdp-playground` stack. It runs on demand and is not
   part of CI.

These layers test the console: its proxy, relays, auth gate, verdict logic and
rendered copy. The SDK's conformance vectors and the backends' own suites belong to
those projects. See acdp-rs
[conformance.md](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/docs/conformance.md),
control-plane [TESTING.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/TESTING.md)
and the playground's
[testing-and-conformance.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/testing-and-conformance.md).

## Vitest suite

```bash
npm test                 # vitest run
npm run test:watch       # vitest (watch)
npm run test:coverage    # vitest run --coverage (v8; text + html under coverage/)
```

`vitest.config.mts` sets the `jsdom` environment, `globals: true`, the `@/*` alias
to the repo root, and `test/setup.ts` as the setup file. Its `exclude` list
**extends** Vitest's defaults (`configDefaults.exclude`) with `temp/**` and
`test/integration/**`. The second entry is there because the Playwright
`*.spec.ts` files would otherwise match Vitest's default include pattern and fail
without a backend.

### Layout

Every test is in `test/__tests__/`, with no co-located tests. The files fall into
these groups:

| Area | Examples |
|------|----------|
| Route handlers and the auth gate | `proxy-route.test.ts`, `stream-routes.test.ts`, `middleware.test.ts`, `auth-route.test.ts` |
| API client and fetcher | `client.test.ts`, `client-demo.test.ts`, `fetcher.test.ts`, `integrations.test.ts` |
| Trust-verdict core | `verify.test.ts`, `use-verdicts.test.ts`, `revocation.test.ts`, `use-trust.test.ts`, `wasm-loader*.test.ts`, `wasm-fixtures.test.ts` |
| Hooks and store | `use-live-run.test.ts`, `use-global-events.test.ts`, `use-health.test.tsx`, `use-registries.test.ts`, `preferences-store.test.ts`, `providers.test.tsx` |
| Component and page render tests | `trust-page.test.tsx`, `dashboard-revocation.test.tsx`, `context-detail-verdicts.test.tsx`, `registry-card-*.test.tsx`, `log-witness-*.test.tsx`, `contexts-page.test.tsx` |
| Cross-cutting UI checks | `a11y.test.ts`, `modal-focus.test.tsx`, `table-scroll.test.tsx`, `render-boundaries.test.tsx`, `error-copy-sweep.test.tsx` |
| Fixture invariants | `mock-data.test.ts` |

### House conventions

- **Node environment for route handlers.** Any file that imports `next/server`
  starts with a `// @vitest-environment node` docblock: `proxy-route`,
  `stream-routes`, `middleware` and `auth-route`. `wasm-fixtures` and `wasm-loader-ssr`
  use the node environment too, to load the real binary / exercise the SSR path.
- **Mock upstreams and env** with `vi.stubGlobal('fetch', …)` and `vi.stubEnv`, and
  undo them in `afterEach`. `fetcher.test.ts` and `integrations.test.ts` are the
  reference files.
- **Render tests mock the hook under the component**, so each verdict or state
  renders the same way every time. Assert on rendered text, not on a `title`
  tooltip.
- **The proxy tests guard security.** They cover the request-header allow-list, the
  rule that only `control-plane` gets the bearer, response-header scrubbing,
  byte-for-byte relay of non-2xx upstream bodies, and the `x-acdp-ui-proxy` stamp
  (set on pass-through, absent on the route's own 403s and 502s).

### The real-binary wasm gate

`wasm-fixtures.test.ts` is the only test that loads the real
`acdp_wasm_bg.wasm`, reading it with `readFileSync` and passing it to `init()`.
Every other verifier test mocks the wasm symbols. It runs the committed demo
fixtures through the real verifier and pins any upstream error-message text that
`lib/verify/verify.ts` matches against. That makes it **the gate for every
`acdp-wasm` bump**: if it fails on a dependency PR, that's a real signal, not a
flaky test.

The demo's cryptographic material (`lib/data/mock-crypto.ts`) comes from
`scripts/gen-mock-crypto.mjs`. The script signs with Node's `crypto`, checks every
surface with the same `acdp-wasm` verifier, and refuses to write the file if any
check fails.

```bash
node scripts/gen-mock-crypto.mjs    # regenerate lib/data/mock-crypto.ts
```

### Test setup

`test/setup.ts` does two things:

1. It imports `@testing-library/jest-dom/vitest`.
2. It redefines `globalThis.localStorage` and `sessionStorage` to point at jsdom's
   own `_localStorage`/`_sessionStorage`. **Node 26** ships a native Web Storage
   that throws on member access without `--localstorage-file`, and Vitest's jsdom
   global population doesn't override it. Without this step, every local Node 26
   run breaks. It is guarded, so node-environment files are left alone, and it does
   nothing on Node 24.

The suite is expected to pass on both Node majors. CI runs Node 24 (`.nvmrc`).

### `test/support/`

These are shared source-level and AST-level helpers, too heavy to inline into a
test:

| Module | Used for |
|--------|----------|
| `advertisable-profiles.ts` | One mirror of the registry's advertisable-profile set. `mock-data.test.ts` checks it against what the fixtures advertise, and `registry-card-profiles.test.tsx` checks it against what the card has copy for |
| `profile-copy-table.ts` | Bounds which keys the registry card can render profile copy from |
| `ts-reads.ts` | Resolves a property read structurally (unwraps casts, `!`, element access, destructuring), for the "does this file read X" guards |
| `stylesheet-text.ts` | Bounds CSS-generated `content:` text, which DOM and source walks can't see |
| `revocation-prose.ts` | The fixed set of sentences the revocation surfaces may render. `trust-page.test.tsx` and `dashboard-revocation.test.tsx` both build their expected copy from it |
| `witness-ack-prose.ts` | The acknowledge dialog's copy, pinned character for character for `log-witness-alerts.test.tsx`. It is keyed off the component's exported state unions, so a new dialog state fails `tsc` |

Because these guards also pin CSS custom properties and `document`/`window` reads
across `app/`, `components/` and `lib/`, a correct change elsewhere (for example a
new CSS variable) can make one of them fail. When that happens, update the guard
deliberately.

### Coverage scope

`npm run test:coverage` uses the v8 provider. Its `include` globs are:

```
lib/**/*.ts   app/api/**/*.ts   components/**/*.tsx   app/**/*.tsx
```

Component and page files are **inside** that scope, so the surfaces that show a
verdict to an operator are counted. Widening the scope to include them lowered the
headline figure, from 91.18% to 64.51%. That drop was not a regression: those lines
were always uncovered and are now counted. The comment in `vitest.config.mts`
records this so nobody narrows the globs to bring the number back up.

The `exclude` list is short and explicit. It holds `lib/types.ts`, `lib/colors.ts`
and **four named** React Query wrappers: `use-dashboard.ts`, `use-runs.ts`,
`use-scenarios.ts` and `use-security.ts`. It is not `lib/hooks/**` as a whole.
`use-trust.ts` and `use-registries.ts` were deliberately removed from the list once
they contained real logic. Add a hook to the list only while it is just a wrapper.

## Smoke scripts

Both scripts have no dependencies. Each targets `SMOKE_BASE_URL`, defaulting to
`https://console.agentcontextdistributionprotocol.io`.

```bash
SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-routes.mjs
SMOKE_BASE_URL=http://localhost:3000 node scripts/run-scenarios.mjs
```

- `smoke-routes.mjs` fetches every top-level page route (from `/` to `/config`,
  leaving out `/runs/[runId]`) and fails on anything other than 200. `smoke.yml`
  runs it every night.
- `run-scenarios.mjs` runs every scenario in the playground catalog through the
  console's proxy (`/api/proxy/playground/...`) and fails on any run that doesn't
  reach `complete`, exiting non-zero in that case. It sends no session cookie, so
  the console's proxy has to be reachable without one: in practice that means a
  `next dev` server with no `ACDP_UI_CONSOLE_PASSWORD`. A console with a passphrase
  set answers it with 401, and a production console without one answers with 503.

## Real-backend integration suite

`test/integration/` is a **separate Playwright suite**
([`playwright.config.ts`](../playwright.config.ts)). `npm test` doesn't run it,
and **no CI workflow runs it either**. `ci.yml` stops at lint, typecheck, coverage
and build.

```bash
cd ../acdp-playground && LLM_PROVIDER=mock make up-full    # in another terminal
npm run test:integration                                    # playwright test
```

`LLM_PROVIDER=mock` is enough, because the suite checks protocol shapes moving
through the real proxy and pages, not model output. How the playground stack is
assembled is documented in its
[getting-started.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/getting-started.md).
On a first run, Playwright's Chromium may need installing
(`npx playwright install chromium`).

> `playwright.config.ts` mentions a `test/integration/README.md`. That file is
> not in the repo. This section is the setup reference.

### What it does

- **Production build, not dev.** `webServer` runs
  `npm run build && npx next start -p ${ACDP_UI_INTEGRATION_PORT:-3100}` with
  `NEXT_PUBLIC_ACDP_UI_DEMO_MODE=false`, so real mode is really baked in and the
  passphrase gate really enforces. It reuses an already-running server unless `CI`
  is set.
- **Fails fast when the stack is down.** `global-setup.ts` checks the playground's
  `/scenarios` and the `/healthz` of the control plane and both registries. If any
  of them is unreachable, it stops and prints the `make up-full` command.
- **Seeds real data.** It starts `s1_single_publish`, `s5_cross_registry` and
  `s22_receipts` through the playground, and waits up to 60 seconds for each to
  reach `complete`.
- **Signs in for real.** It fills in the actual `/login` form in Chromium and saves
  the resulting cookie as `storageState` in `test/integration/.auth/session.json`
  (gitignored), which every spec then uses.
- It runs serially: `workers: 1`, `retries: 0`, a 30-second test timeout, and traces
  and screenshots kept on failure (in `test-results/`, which is gitignored).

| Spec | Asserts |
|------|---------|
| `dashboard.spec.ts` | `Total Runs` is at least 3 and Recent Runs is populated. The Live Events panel connects to the real SSE relay |
| `registries.spec.ts` | The observed-registries list shows its real empty state, not an error. Enrollment management renders from the real control plane |
| `security.spec.ts` | The revocation feed authenticates as admin (empty state, not 403). Both JWKS cards load. The witness alert worklist renders |

### Honest emptiness

In the playground's default stack, both registries run with webhooks disabled and
HS256 JWT signing (see the playground's
[`config/registry-a.toml`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/config/registry-a.toml)
and the registry's
[WEBHOOKS.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/WEBHOOKS.md)).
As a result, the control plane's observed-registry and context counts, and both
registries' JWKS, are **correctly empty** no matter how many runs were seeded. The
specs check for each page's real empty state there rather than expecting data. Only
the run counts, the live SSE feed, the admin revocation feed and the witness alert
worklist carry non-empty signal in that stack.

The suite's defaults match that stack's compose defaults, and each can be
overridden (see [Configuration](configuration.md#script-and-test-variables)). In
particular, `CONTROL_PLANE_API_KEY` defaults to `playground-cp-admin`, which that
stack accepts as an admin key, so the admin-gated pages are tested on their success
path.

## CI workflows

All workflows are in `.github/workflows/`:

| Workflow | Trigger | Does |
|----------|---------|------|
| `ci.yml` | push and PR to `main` | On Node from `.nvmrc`: `npm ci`, then lint, typecheck, `npm run test:coverage` (uploads `coverage/` as an artifact, kept 14 days), then `npm run build` with `NEXT_PUBLIC_ACDP_UI_DEMO_MODE=true`, so no backend secrets are needed. Caches `.next/cache`, and cancels runs superseded on the same ref |
| `docker.yml` | push and PR to `main`, `v*` tags | Builds the image. Pushes to GHCR on `main` and tags only (see [Deployment](deployment.md#published-image-ghcr)) |
| `smoke.yml` | nightly at 05:17 UTC, manual | Runs `scripts/smoke-routes.mjs`. A manual run can supply a `base_url` |
| `bump-acdp.yml` | `repository_dispatch: acdp-released`, manual | Opens an `acdp-wasm` bump PR through `acdp-ci`'s [`bump-consume.yml`](https://github.com/agentcontextdistributionprotocol/acdp-ci/blob/main/.github/workflows/bump-consume.yml) |
| `auto-merge.yml` | `pull_request` | Calls `acdp-ci`'s [`auto-merge.yml`](https://github.com/agentcontextdistributionprotocol/acdp-ci/blob/main/.github/workflows/auto-merge.yml) |
| `notify-website.yml` | `docs/**` or `README.md` changed on `main`, manual | Sends a `docs-updated` dispatch to `acdp-website`. The website's sync intentionally doesn't pull this repo, so nothing is published as a result (see the [index](README.md#repo-links)) |

### `acdp-wasm` bumps: two lanes, one rule

`@agentcontextdistributionprotocol/acdp-wasm` is the verification core, and it is
still on 0.x, where a **minor** version can change semantics. Updates can arrive by
two routes, and both are configured so that a minor never merges without a human:

- **Dispatch lane (`bump-acdp.yml`).** acdp-rs's
  [`acdp-wasm-release.yml`](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/.github/workflows/acdp-wasm-release.yml)
  sends `acdp-released` to this repo after each publish. `bump-consume.yml` waits for
  npm to serve the version, rewrites `package.json` and `package-lock.json`, and
  opens a PR on a `deps/acdp-wasm-<ver>` branch. For a 0.x package it treats a minor
  as breaking, so auto-merge isn't armed: a **patch** can merge unattended on green
  CI (backed by the `wasm-fixtures.test.ts` gate), and a **minor** waits for review.
- **Dependabot lane (`.github/dependabot.yml`).** The monthly npm sweep groups
  minors and patches together. That group would have let `auto-merge.yml` merge a
  0.x minor on a green check alone. So `acdp-wasm`'s
  `version-update:semver-minor` updates are in the `ignore` list: patches still
  arrive through the sweep, and minors arrive only through the dispatch lane.

Dependabot also holds `typescript` below `6.1` (typescript-eslint support) and
`@types/node` below `25`, so the types track the pinned Node 24 runtime. Its
`github-actions` updates are grouped monthly. The cross-repo propagation rules come
from `acdp-ci`'s
[DELIVERY-STANDARD.md](https://github.com/agentcontextdistributionprotocol/acdp-ci/blob/main/DELIVERY-STANDARD.md).
