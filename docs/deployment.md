# Deployment

The console ships in two ways:

- **Vercel** is the primary target, using Next.js's git integration.
- **A standalone Docker image** is built from the repo's multi-stage `Dockerfile` and
  published to GHCR.

Whichever you use, two decisions are made at build time and one at runtime.

| Decision | When | How |
|----------|------|-----|
| Demo or real mode | **Build** | `NEXT_PUBLIC_ACDP_UI_DEMO_MODE`. Any value except `false` means demo |
| Default Jaeger URL | **Build** | `NEXT_PUBLIC_JAEGER_URL` |
| Upstream URLs, control-plane key, operator passphrase | **Runtime** | `*_BASE_URL`, `CONTROL_PLANE_API_KEY`, `ACDP_UI_CONSOLE_PASSWORD` |

[Configuration](configuration.md) describes every variable.

## Production requirements

For a production deployment that talks to **real backends** (built with
`NEXT_PUBLIC_ACDP_UI_DEMO_MODE=false`):

1. **`ACDP_UI_CONSOLE_PASSWORD` must be set.** If it isn't, `middleware.ts` answers
   **503** on every `/api/proxy/*` and `/api/stream/*` request, and
   `POST /api/auth/login` answers 503 too. The gate fails closed when
   `NODE_ENV === 'production'`. Because the check runs per request, the app still
   boots and serves its pages, but every data call fails.
2. **All four `*_BASE_URL` variables must be set.** In production,
   `lib/server/integrations.ts` throws when a request needs a service whose URL is
   unset, and it never falls back to localhost.
3. **Each `*_BASE_URL` must be the final URL.** The proxy and SSE relays refuse to
   follow a redirect and answer 502 instead.
4. **`CONTROL_PLANE_API_KEY`** is needed for any control-plane route that requires
   auth, and it must be an admin key for the admin-gated pages. Which keys the control
   plane accepts is set in its own
   [CONFIGURATION.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/CONFIGURATION.md).

A **pure demo deployment** (the default build) needs none of these. The pages never
call the gated routes, the URL check only runs when a service is requested, and the
503 stays in place over a privileged surface that nothing uses. The exception is a
browser that turns demo mode off on the Config page. That choice persists in
`localStorage` (see [Configuration](configuration.md#per-browser-preferences)), and
that browser will get the 503.

## Vercel

[`vercel.json`](../vercel.json) declares only `"framework": "nextjs"`. Everything
else comes from Vercel's standard Next.js build.

- `next.config.ts` turns off `output: 'standalone'` when `VERCEL` is set. Vercel's
  builder does its own packaging. Under Next.js 16.3.x, standalone output also
  conflicts with Vercel's `onBuildComplete` step: the build finishes, then packaging
  fails with `ENOENT: .next/next-server.js.nft.json`. The comment in that file links
  the upstream report.
- Production variables come from Doppler (next section). Changing a `NEXT_PUBLIC_*`
  value needs a redeploy, not just a restart.

### Doppler: the source of truth for production variables

The Doppler project `acdp-ui-console` holds the console's configuration, one config
per environment:

| Config | Holds |
| --- | --- |
| `prd` | The Vercel Production variables listed in [`deploy/doppler-keys.txt`](../deploy/doppler-keys.txt). |
| `stg` | Only `prd`'s non-secret config keys (the service URLs and the demo flag). There is no staging deployment; it exists to match the other ACDP projects' layout. |
| `dev` | The local `.env` values, for `doppler run --` during development. |
| `dev_personal` | A branch of `dev` with no overrides of its own; use it for per-developer changes. |

[`deploy/doppler-sync.sh`](../deploy/doppler-sync.sh) pushes `prd` into the Vercel
project `zer07labs/acdp-ui-console`, Production environment only:

```bash
deploy/doppler-sync.sh                         # dry run: key names and states, nothing changes
deploy/doppler-sync.sh --apply                 # add new keys, update changed readable keys, redeploy if any changed
deploy/doppler-sync.sh --apply --push KEY      # also overwrite KEY, which Vercel stores as sensitive (write-only)
deploy/doppler-sync.sh --apply --no-redeploy   # set variables; the next merge's deployment picks them up
```

- It manages only the keys in `deploy/doppler-keys.txt`. It never removes a Vercel
  variable and never touches Preview or Development.
- Values are piped from Doppler into `vercel env` and are never printed or written to
  disk. Vercel holds no Doppler token.
- Vercel never returns the value of a **sensitive** variable, so the script can't
  compare one. It reports the key as `sensitive-unverifiable` and leaves it alone
  unless you name it with `--push`. A key marked `sensitive` in the list is created
  as a sensitive variable.
- An entry that is **shared with Preview** is reported and never modified, because
  updating it would change Preview too. Every variable that existed before the
  migration is sensitive. Doppler holds the same values;
  they were checked by behaviour against production at migration time (service
  `/healthz` and registry DID through the console versus direct, an admin-only
  control-plane read with the key, and a sign-in with the passphrase).
- At the start and the end of a run, it prints a hash of the production entries' metadata
  (ids, keys, types, targets, `updatedAt`; never values). If nothing changed, the two
  hashes are equal.
- It needs `git`, `jq`, `curl` and the `doppler` and `vercel` CLIs, logged in, and it
  refuses a dirty working tree. No `vercel link` is needed: the script pins the CLI to
  the project by id, whatever the shell or checkout is linked to.

#### Preview has its own, smaller set

Doppler owns Production. Preview deployments get only what a preview needs,
and never the admin control-plane key or the passphrase:

| Preview variable | Value |
| --- | --- |
| `CONTROL_PLANE_BASE_URL`, `PLAYGROUND_BASE_URL` | Production's URLs |
| `CONTROL_PLANE_READ_API_KEY` | The non-admin control-plane key (sensitive) |
| `PLAYGROUND_API_KEY` | The playground key (sensitive), so previews keep working once the playground enforces it |
| `NEXT_PUBLIC_ACDP_UI_DEMO_MODE` | `true` |

These are separate Preview-only entries, set by hand with `vercel env add … preview`;
the sync never touches them. Without `ACDP_UI_CONSOLE_PASSWORD`, a preview's
proxy fails closed (503) outside demo mode, which is the intended state.
`REGISTRY_A/B_BASE_URL` and `NEXT_PUBLIC_APP_VERSION` are older shared entries no
code path uses on Vercel; they can be removed.

`smoke.yml` checks the deployed console every night (see
[Testing](testing.md#ci-workflows)).

## Docker image

The [`Dockerfile`](../Dockerfile) has three stages, all on `node:24-alpine`:

| Stage | Does |
|-------|------|
| `deps` | `npm ci` from `package.json` and `package-lock.json` |
| `builder` | Copies the source, takes the build `ARG`s, runs `npm run build` (standalone output) |
| `runner` | Copies `.next/standalone`, `.next/static` and `public/`, then runs `node server.js` as the unprivileged user `nextjs` (uid 1001) |

Runtime defaults in the `runner` stage: `NODE_ENV=production`, `PORT=3000`,
`HOSTNAME=0.0.0.0`, `NEXT_TELEMETRY_DISABLED=1`, `EXPOSE 3000`. The `HEALTHCHECK`
requests `GET /` on `127.0.0.1:$PORT` and treats any status below 400 as healthy.
`/` is the server-side redirect to `/dashboard` (`app/page.tsx`), so the redirect
itself counts as healthy. The probe doesn't touch the gated routes, so it passes
whether or not a passphrase is configured.

`.dockerignore` excludes tests, `.env*` (except `.env.example`), `plans/` and local
artifacts from the build context.

### Build arguments

| `ARG` | Default | Notes |
|-------|---------|-------|
| `NEXT_PUBLIC_ACDP_UI_DEMO_MODE` | `true` | Inlined into the bundle. Pass `false` to build an image that proxies to real backends |
| `NEXT_PUBLIC_APP_VERSION` | `0.1.0` | Build metadata only. No app code reads it |

```bash
# Real-mode image
docker build --build-arg NEXT_PUBLIC_ACDP_UI_DEMO_MODE=false -t acdp-ui-console:real .

docker run -p 3000:3000 \
  -e PLAYGROUND_BASE_URL=https://playground.example \
  -e CONTROL_PLANE_BASE_URL=https://cp.example \
  -e CONTROL_PLANE_API_KEY=... \
  -e PLAYGROUND_API_KEY=... \
  -e ACDP_UI_CLIENT_IP_HEADER=x-real-ip \
  -e ACDP_UI_CONSOLE_PASSWORD=... \
  acdp-ui-console:real
```

`NEXT_PUBLIC_JAEGER_URL` is not a `Dockerfile` `ARG`, so an image always builds with
the store's fallback (`http://localhost:16686`). Operators can change it per browser
on the Config page.

### Published image (GHCR)

`.github/workflows/docker.yml` builds the image on every push and PR to `main` and
on `v*` tags. It **pushes** to `ghcr.io/agentcontextdistributionprotocol/acdp-ui-console`
only for pushes to `main` and tags. PR builds skip the registry login and are
build-only. Tags come from `docker/metadata-action`:

| Tag | When |
|-----|------|
| `sha-<short>` | Every published build |
| `latest` | Pushes to the default branch |
| `<version>`, `<major>.<minor>` | `v*` semver tags |

The published image is **always the demo build**: the workflow passes
`NEXT_PUBLIC_ACDP_UI_DEMO_MODE=true`. It sets `NEXT_PUBLIC_APP_VERSION` to the tag
name, or to the commit SHA for untagged builds. To connect to real backends, build
your own image with the `ARG` set to `false`. The sibling compose stacks do exactly
that.

### Behind a reverse proxy

The image is designed to run behind nginx, Caddy, Traefik or a load balancer. Two
behaviours in the code depend on what that proxy forwards:

- **Same-origin check.** On `POST`/`PUT`/`PATCH`/`DELETE`, `middleware.ts` compares
  the browser's `Origin` against `X-Forwarded-Host` (only its first comma-separated
  entry), falling back to `Host`. It never uses `request.nextUrl.host`, which
  `next start` and the standalone server derive from `localhost:$PORT`. Make sure
  the proxy forwards the hostname the client actually used, or a legitimate
  mutation will get a 403.
- **Cookie `Secure` flag.** `app/api/auth/login/route.ts` sets `Secure` only when
  `request.nextUrl.protocol === 'https:'`. Given the `nextUrl` behaviour described
  in `middleware.ts`, check that the session cookie really carries `Secure` behind
  a TLS-terminating proxy before you rely on it.

[Authentication](authentication.md) covers the session design.

## The playground's `make up-full` console

The playground's full stack builds this repo as its `ui-console` service. See
[`docker-compose.full.yml`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docker-compose.full.yml)
and the playground's
[deployment.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/deployment.md)
for how the stack is put together. From the console's side, three things matter:

- The service builds with `NEXT_PUBLIC_ACDP_UI_DEMO_MODE: "false"` and sets the four
  `*_BASE_URL` variables and `CONTROL_PLANE_API_KEY`.
- It **sets no `ACDP_UI_CONSOLE_PASSWORD`**, and it is a production image
  (`NODE_ENV=production` from the `runner` stage). So the console on
  `http://localhost:3000` serves its pages, but **every gated route answers 503**
  and sign-in also answers 503, until you add `ACDP_UI_CONSOLE_PASSWORD` to that
  service's environment.
- Alternatively, run this repo's dev server against the same stack on another port
  (`npm run dev:real -- -p 3100`). There the gate fails open. See
  [Getting started](getting-started.md#connect-to-a-real-stack).

That stack's registries ship with webhooks off and HS256 JWT signing. Pages fed by
registry webhooks and the per-registry JWKS cards are therefore legitimately empty
there ([Testing](testing.md#real-backend-integration-suite) has the details).
