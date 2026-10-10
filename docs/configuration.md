# Configuration

The console is configured with environment variables. Copy
[`.env.example`](../.env.example) to `.env.local` to start. Next.js loads it
automatically, `.gitignore` excludes it, and `.dockerignore` keeps every `.env.*`
except `.env.example` out of the Docker build context.

The variables fall into two groups, and the difference matters for deployment:

- **Server-side runtime variables** are read by the route handlers and `middleware.ts`
  on each request. Changing one takes effect on restart, with no rebuild. None of
  them reaches the browser.
- **`NEXT_PUBLIC_*` variables** are written into the client bundle at
  **build time**. Changing one means rebuilding (`next build`, or rebuilding the
  Docker image with a different `ARG`).

This page covers only the console's own variables. The backends' settings (control
plane API keys, registry config, playground settings) are documented by those
projects. See [Related settings](#related-settings-owned-elsewhere).

## Demo mode

| Variable | Default | Read by | Notes |
|----------|---------|---------|-------|
| `NEXT_PUBLIC_ACDP_UI_DEMO_MODE` | `true` | `lib/stores/preferences-store.ts` | Build-time. Demo mode is **on unless the value is exactly `false`** (`!== 'false'`). In demo mode every `lib/api/client.ts` function returns mock data from `lib/data/mock-data.ts`. In real mode the calls go through `/api/proxy/*` and `/api/stream/*` |

The value is only the **initial** default of a persisted per-browser preference. See
[Per-browser preferences](#per-browser-preferences).

## Upstream services

| Variable | Dev fallback | Notes |
|----------|--------------|-------|
| `PLAYGROUND_BASE_URL` | `http://localhost:8000` | Playground: scenarios, runs, run SSE |
| `CONTROL_PLANE_BASE_URL` | `http://localhost:3001` | Control plane: runs, events, dashboard, revocations, registries |
| `REGISTRY_A_BASE_URL` | `http://localhost:8100` | Registry A |
| `REGISTRY_B_BASE_URL` | `http://localhost:8200` | Registry B |

These are server-side runtime variables. All four are resolved in
`lib/server/integrations.ts` (`resolveBaseUrl`):

- **Outside production**, an unset variable falls back to the localhost URL above.
- **In production** (`NODE_ENV === 'production'`), an unset variable makes
  `getIntegrationConfig` throw
  `[ACDP UI] <VAR> is required in production`. The throw happens when a request
  for that service arrives, not at boot. So a demo-mode deployment that never calls
  the proxy doesn't need these set.
- A trailing `/` on the base is stripped before the path is appended
  (`buildUpstreamUrl`).
- **Use the final URL.** The proxy fetches with `redirect: 'manual'` and answers a
  3xx from upstream with a 502 that names the `Location` header, instead of following
  it (`app/api/proxy/[service]/[...path]/route.ts`). An `http://` base behind an
  ingress that 301s to `https://` therefore makes a running service look
  unreachable. The SSE relays refuse a 3xx the same way (`lib/server/sse-relay.ts`).

The proxy route and the control-plane SSE relay (`app/api/stream/events/route.ts`)
read their config through these functions. The playground run relay
(`app/api/stream/runs/[runId]/route.ts`) calls `buildUpstreamUrl('playground', …)`.
What each upstream route does is documented by the service that owns it. See
[Related settings](#related-settings-owned-elsewhere).

## Credentials

| Variable | Default | Notes |
|----------|---------|-------|
| `CONTROL_PLANE_API_KEY` | *(empty)* | Server-side. Sent as `authorization: Bearer <key>` on proxied **control-plane** requests and on the control-plane events relay, and **never** on calls for the other three services (`getIntegrationConfig`). When it's empty, no `authorization` header is sent. The browser never sees it: the proxy forwards only an allow-list of client request headers, so no client-supplied `authorization` gets through |
| `ACDP_UI_CONSOLE_PASSWORD` | *(empty)* | Server-side. The operator passphrase behind the `/api/proxy/*` and `/api/stream/*` gate. It is a different secret from `CONTROL_PLANE_API_KEY` |

### `ACDP_UI_CONSOLE_PASSWORD` behaviour

It's read per request by `middleware.ts` and `app/api/auth/login/route.ts`:

| State | `/api/proxy/*`, `/api/stream/*` | `POST /api/auth/login` |
|-------|---------------------------------|------------------------|
| Unset, `NODE_ENV !== 'production'` | Allowed, with an "UNAUTHENTICATED (development fail-open)" warning logged on every request | 503 |
| Unset, `NODE_ENV === 'production'` | **503** `ACDP_UI_CONSOLE_PASSWORD is not configured on this deployment.` | 503 |
| Set | 401 without a valid session cookie. A mutating request whose `Origin` doesn't match the host gets 403 | Checks the passphrase and sets the cookie |

The HMAC signing key is derived from the passphrase with HKDF-SHA-256
(`lib/server/session.ts`). **Changing the passphrase invalidates every existing
session.** Sessions last 12 hours (`SESSION_TTL_MS`). There is no login
rate-limiting, so choose a high-entropy value: `.env.example` recommends
4+ diceware words or 20+ random characters. [Authentication](authentication.md)
covers the design of the gate.

## Observability

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_JAEGER_URL` | `http://localhost:16686` | Build-time. The initial Jaeger base URL the trace links use. This is the only Jaeger variable the app reads (`lib/stores/preferences-store.ts`). Each browser can override it later |

## Build metadata

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_APP_VERSION` | `0.1.0` | A `Dockerfile` build `ARG`. **No app code reads it.** `docker.yml` overrides it per build with the git tag or SHA so you can tell which commit an image came from. `.env.example` keeps a default so a plain `docker build` doesn't get an empty string |

## Runtime and platform variables

You don't normally set these yourself. They're listed because the code branches on
them.

| Variable | Set by | Effect |
|----------|--------|--------|
| `NODE_ENV` | Next (`next build`/`next start`), and the `Dockerfile` runner stage (`production`) | `production` makes the upstream URLs required and switches the passphrase gate to fail closed |
| `VERCEL` | Vercel's build environment | `next.config.ts` drops `output: 'standalone'` when it's set (see [Deployment](deployment.md#vercel)) |
| `PORT`, `HOSTNAME` | `Dockerfile` runner (`3000`, `0.0.0.0`) | The port and interface the standalone `server.js` listens on. The `HEALTHCHECK` reads `PORT` too |
| `NEXT_TELEMETRY_DISABLED` | `Dockerfile` (`1`) | Turns off Next telemetry in the builder and runner stages |

## Per-browser preferences

`lib/stores/preferences-store.ts` is a Zustand store, persisted to `localStorage`
under the key `acdp-ui-preferences`. It holds exactly two values:

| Preference | Initial value | Edited on |
|------------|---------------|-----------|
| `demoMode` | `NEXT_PUBLIC_ACDP_UI_DEMO_MODE !== 'false'` | **Config** page, Demo mode toggle (`components/config/connection-panel.tsx`) |
| `jaegerUrl` | `NEXT_PUBLIC_JAEGER_URL`, or `http://localhost:16686` | **Config** page, Jaeger field |

Because the value is persisted, a browser's saved choice outlives a rebuild. A
browser that turned demo mode off keeps calling the proxy even against a demo-mode
build. On a production build without `ACDP_UI_CONSOLE_PASSWORD`, those calls get
the 503 described above. The service URLs and credentials are **not** in this store.
They are server-side only (`lib/server/integrations.ts`), and the Config page shows
them as "server-configured".

## Script and test variables

| Variable | Used by | Default | Notes |
|----------|---------|---------|-------|
| `SMOKE_BASE_URL` | `scripts/smoke-routes.mjs`, `scripts/run-scenarios.mjs` | `https://console.agentcontextdistributionprotocol.io` | The console the script targets. `smoke.yml` passes its `base_url` input through |
| `ACDP_UI_INTEGRATION_PORT` | `playwright.config.ts` | `3100` | Port for the production server the Playwright suite starts |
| `PLAYGROUND_URL`, `CONTROL_PLANE_URL`, `REGISTRY_A_URL`, `REGISTRY_B_URL` | `playwright.config.ts`, `test/integration/global-setup.ts` | `http://localhost:8000` / `:3001` / `:8100` / `:8200` | The real stack the suite drives. The config passes them to the app under test as the `*_BASE_URL` variables |
| `CONTROL_PLANE_API_KEY` | `playwright.config.ts` | `playground-cp-admin` | Matches the default `CONTROL_PLANE_ADMIN_TOKEN` in the playground's full-stack compose, so the admin-gated pages can be exercised |
| `ACDP_UI_CONSOLE_PASSWORD` | `playwright.config.ts`, `global-setup.ts` | `acdp-ui-console-integration-test-passphrase` | Set on the app under test, and typed into the real `/login` form during global setup |
| `CI` | `playwright.config.ts` | — | When set, turns on `forbidOnly` and stops reuse of an already-running server |

[Testing](testing.md#real-backend-integration-suite) explains how the suite uses
these.

## Related settings owned elsewhere

- **Which control-plane keys are valid (and which are admin)**: control-plane
  [CONFIGURATION.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/CONFIGURATION.md)
  · [AUTH.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/AUTH.md)
- **Registry configuration** (webhooks, JWT signing, profiles): registry
  [CONFIGURATION.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/CONFIGURATION.md)
- **Playground settings, and the values its full stack passes to the console**:
  playground [configuration.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/configuration.md)
  · [`docker-compose.full.yml`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docker-compose.full.yml)
