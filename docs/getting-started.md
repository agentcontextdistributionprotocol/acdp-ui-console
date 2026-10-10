# Getting started

## Prerequisites

- **Node.js 24**: `.nvmrc` pins `24` and `package.json` declares
  `"engines": { "node": ">=24.15.0" }`. CI, the Dockerfile and Dependabot's
  `@types/node` guard all track Node 24. The Vitest suite also runs on Node 26
  (see [Testing](testing.md#test-setup)), but 24 is the minimum supported version.
- **npm**: the repo ships a `package-lock.json`, and CI and the Dockerfile install
  with `npm ci`.
- **For real mode only**: a running ACDP backend stack. The usual one is the
  playground's `make up-full` (see [Connect to a real stack](#connect-to-a-real-stack)).

Demo mode needs nothing else: no backend, no secrets, no Docker.

## Install

```bash
npm install
```

The one ACDP-family dependency is `@agentcontextdistributionprotocol/acdp-wasm`, the
in-browser verifier the trust surfaces use. It comes from npm, so you don't need a
sibling `acdp-rs` checkout or a Rust toolchain.

## Run in demo mode

```bash
npm run dev          # http://localhost:3000
```

`NEXT_PUBLIC_ACDP_UI_DEMO_MODE` defaults to on. The store reads it as "on unless
the value is exactly `false`" (`lib/stores/preferences-store.ts`), so every function
in `lib/api/client.ts` returns mock data from `lib/data/mock-data.ts` after a short
simulated delay. Every page is populated, and `/` redirects to `/dashboard`
(`app/page.tsx`).

`npm run dev:demo` sets the flag to `true` explicitly. Plain `npm run dev` already
does that, because it's the default.

## Connect to a real stack

### 1. Start the backends

The console proxies to four services: playground (`:8000`), control plane (`:3001`),
registry-a (`:8100`) and registry-b (`:8200`). Those are the fallback URLs in
`lib/server/integrations.ts`. To bring all four up locally, use the playground's
full stack, following its own
[getting-started.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/getting-started.md)
and [deployment.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/deployment.md).
To skip real model calls:

```bash
cd ../acdp-playground && LLM_PROVIDER=mock make up-full
```

> That stack **builds and runs its own console** from this repo on port `3000`
> (the `ui-console` service in the playground's
> [`docker-compose.full.yml`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docker-compose.full.yml)).
> It is a production build with no `ACDP_UI_CONSOLE_PASSWORD`, so its gated routes
> answer **503** (see [Deployment](deployment.md#the-playgrounds-make-up-full-console)).
> To develop against that stack, run your dev server on a different port.

### 2. Point the console at it

```bash
cp .env.example .env.local
```

`.env.example` already holds the localhost defaults for all four `*_BASE_URL`
variables. For a stack started with no overrides, the only value to fill in is
`CONTROL_PLANE_API_KEY`: the bearer the proxy attaches to control-plane calls, and
never to calls for the other three services. The admin-gated pages (the revocation
feed, enrollment actions) need a key the control plane accepts as admin. Which
keys those are is the control plane's decision (see its
[AUTH.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/AUTH.md)).
[Configuration](configuration.md) describes every variable.

### 3. Run in real mode

```bash
npm run dev:real               # NEXT_PUBLIC_ACDP_UI_DEMO_MODE=false next dev
npm run dev:real -- -p 3100    # if make up-full's console already holds :3000
```

Because `NEXT_PUBLIC_*` values are inlined into the browser bundle, demo mode is set
when the dev server starts (or at build time), not per request. A browser can
still flip it afterwards: the **Config** page's Demo mode toggle
(`components/config/connection-panel.tsx`) writes it to the persisted preference
store (see [Configuration](configuration.md#per-browser-preferences)).

On the Config page, **Test all** pings each upstream through the proxy and labels
it `healthy`, `degraded` or `unreachable`.

## Sign in

The passphrase gate (`middleware.ts`) covers only `/api/proxy/*` and `/api/stream/*`.
What you see depends on whether `ACDP_UI_CONSOLE_PASSWORD` is set:

| `ACDP_UI_CONSOLE_PASSWORD` | `next dev` | Production build (`next start`, Docker) |
|---|---|---|
| unset | Gate **open**. A warning is logged on every gated request, and you never need to sign in | Gated routes answer **503**, and `POST /api/auth/login` answers 503 |
| set | Sign in at `/login` | Sign in at `/login` |

After a successful sign-in, `POST /api/auth/login` sets a session cookie valid for
about 12 hours (`lib/server/session.ts`), and the browser is sent to `/`. Sign out
from the sidebar. [Authentication](authentication.md) explains how the gate works.

## Sanity checks

```bash
npm run typecheck && npm run lint && npm test
SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-routes.mjs
```

`scripts/smoke-routes.mjs` fetches every top-level page route and fails on any
non-200. It checks pages only, so it passes in demo mode. If you omit
`SMOKE_BASE_URL`, it targets the deployed console at
`https://console.agentcontextdistributionprotocol.io`. [Testing](testing.md)
describes the full suite.

## Next steps

- [Architecture](architecture.md): how a page's request reaches a backend
- [Pages](pages.md): what each page shows
- [Configuration](configuration.md): every variable the console reads
