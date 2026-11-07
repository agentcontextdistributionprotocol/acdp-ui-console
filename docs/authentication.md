# Authentication

The console is a **single-operator** tool. It has no user accounts, only one
shared passphrase (`ACDP_UI_CONSOLE_PASSWORD`). Signing in with it sets a
signed session cookie, and `middleware.ts` checks that cookie on the
privileged routes.

This is separate from the backends' own authentication. The console reaches
the control plane with a server-side bearer token (`CONTROL_PLANE_API_KEY`),
which the proxy adds; the operator never sees it. How the control plane
issues and checks that token is documented in its
[AUTH.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/AUTH.md).

## What is gated

```ts
// middleware.ts
export const config = { matcher: ['/api/proxy/:path*', '/api/stream/:path*'] };
```

Only the proxy and the two SSE relays are gated, never page routes. That is
enough, because the pages carry no privileged data of their own:

- Every page is a client component with no server-rendered data (`app/page.tsx`
  only redirects).
- Everything privileged has to come back through `/api/proxy/*` or
  `/api/stream/*`.

The two `/api/auth/*` routes are outside the matcher, since they are how a
session gets created in the first place.

## Signing in

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (/login)
  participant L as POST /api/auth/login
  participant S as lib/server/session.ts

  B->>L: { passphrase }
  alt ACDP_UI_CONSOLE_PASSWORD unset
    L-->>B: 503 not configured
  else body not JSON
    L-->>B: 400 Invalid request body
  else passphraseMatches() false
    L->>S: SHA-256 both, constant-time compare
    L-->>B: 401 Incorrect passphrase
  else match
    L->>S: createSessionToken(password)
    S-->>L: base64url({exp}) "." base64url(HMAC)
    L-->>B: 200 {ok:true} + Set-Cookie acdp_ui_session
    B->>B: router.push('/') → redirect('/dashboard')
  end
```

- **The form.** `app/login/page.tsx` posts to `/api/auth/login` directly.
  This is one of the two allowed direct `fetch` calls outside
  `lib/api/client.ts`.
- **Error responses.** These never include the submitted or the configured
  passphrase.
- **Signing out.** `components/layout/sidebar.tsx` calls `POST
  /api/auth/logout`, which sets the cookie to empty with `maxAge: 0`, and then
  navigates to `/login`. Signing out without a cookie, as in demo mode, does
  nothing harmful.

### The cookie

Set in `app/api/auth/login/route.ts`:

| Attribute | Value |
|-----------|-------|
| Name | `acdp_ui_session` (`SESSION_COOKIE_NAME`) |
| `HttpOnly` | always |
| `Secure` | only when the request came over `https:`, so `http://localhost` still works |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Max-Age` | 12 h (`SESSION_TTL_SECONDS`) |

### The token

`lib/server/session.ts` is stateless; there is no session store.

- **Format.** The token is `base64url(JSON {exp})` + `.` + `base64url(HMAC-SHA-256)`.
- **Signing key.** The key is never the raw passphrase. It is derived with
  HKDF-SHA-256 using the salt `acdp-ui-console-session-v1` and the info string
  `acdp-ui-console-session-hmac`.
- **Verification.** `verifySessionToken` checks the token's shape, verifies
  the HMAC with `crypto.subtle.verify` (constant-time), then checks that
  `exp` is in the future. It never throws: malformed input simply returns
  `false`.
- **Runtime.** Everything uses Web Crypto, so the same code runs in the
  middleware runtime and in the Node route handlers.
- **Revoking sessions.** Changing `ACDP_UI_CONSOLE_PASSWORD` changes the
  derived key, so every existing session stops working.

## The gate on each request

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant M as middleware.ts
  participant R as /api/proxy or /api/stream

  B->>M: request (+ cookie)
  alt password unset, NODE_ENV=production
    M-->>B: 503 (fail closed)
  else password unset, development
    M->>M: console.warn (every request)
    M->>R: pass through (fail open)
  else POST/PUT/PATCH/DELETE and Origin host ≠ request host
    M-->>B: 403 Origin mismatch
  else verifySessionToken() false
    M-->>B: 401 sign in at /login
  else valid session
    M->>R: NextResponse.next()
  end
```

- **Missing password.** The check happens on each request, never at boot. A
  production deployment that never calls the proxy, such as a pure demo
  deployment, starts fine without a password, and the privileged routes stay
  closed (503). In development the gate is off, and a warning is logged on
  every request, so the zero-setup demo still works.
- **CSRF backstop.** For requests that change state, the host in `Origin`
  must match the host the request was sent to. That host is the first entry of
  `X-Forwarded-Host` if present, otherwise `Host`, never `nextUrl.host` (see
  `resolveRequestHost` for why). A request with no `Origin` header is not
  rejected by this check. `SameSite=Lax` is the primary defence.
- **No provenance stamp.** None of the gate's responses carry
  `x-acdp-ui-proxy`, so the browser can tell them apart from an upstream's own
  401, 403 or 503 ([Architecture → The provenance stamp](architecture.md#the-provenance-stamp)).

## Public mode (`ACDP_UI_PUBLIC_MODE`)

With `ACDP_UI_PUBLIC_MODE` off (the default), everything above applies and
nothing below does. Only `on`, `true` or `1` turn it on. Any other value is
treated as off and logged as a warning, so a typo fails toward the password
gate (`lib/server/public-mode.ts`).

With it on, anonymous visitors can use the console's **public** routes, and the
operator-only routes stay behind the passphrase.

- **Who decides.** `middleware.ts` keeps the CSRF check but lets a request
  with no session through. The route handler decides, in
  `lib/server/access.ts`, after its own traversal guards and allow-list match.
  It is the only place that sees the decoded path, so an encoded variant
  can't be classified one way and fetched another. The handler also
  re-checks the session for admin routes, and for every route when the flag
  is off, so a mismatch between the edge and Node reads of the env can't open
  anything.
- **Access classes.** Every entry in `lib/server/proxy-allowlist.ts` carries
  `access: 'public' | 'admin'`. There are nine admin routes, all on the
  control plane:
  - `GET /registries/enrollments`
  - `POST /registries/enroll`
  - `POST /registries/:authority/log-witness/ack`
  - `GET /webhooks` and `POST /webhooks`
  - `PATCH /webhooks/:id` and `DELETE /webhooks/:id`
  - `GET /metrics`
  - `GET /auth/revocations`

  Everything else on the allow-list is public, including both SSE relays and
  playground `POST /runs`. A route that isn't on the list is still 403.
- **403, not 401.** An anonymous admin request gets
  `403 {errorCode: 'CONSOLE_OPERATOR_SESSION_REQUIRED'}`. It is not a 401,
  because the browser redirects an unstamped 401 to `/login`, and that would
  bounce public visitors off pages they are allowed to see.
- **Per-IP limits.** Limits are kept in memory per instance
  (`lib/server/rate-limit.ts`) and apply to the operator too:
  - 300 reads a minute.
  - Playground `POST /runs`: 5 per 10 minutes.
  - Anonymous control-plane requests: 30 a minute per IP, and 150 a minute per
    instance.
  - Each SSE open takes a read token and a stream slot: 4 concurrent per IP,
    200 per instance.

  A refused request gets `429 {errorCode: 'CONSOLE_RATE_LIMITED',
  retryAfterSeconds}` plus a `Retry-After` header. A request the access check
  or the limiter refuses consumes nothing; a stream open refused only because
  its IP already holds 4 streams has already spent its read token. The durable limits (LLM quota, concurrent runs, the per-IP run
  limit) are the playground's, charged to the forwarded `X-ACDP-Client-IP`.
- **Control-plane key.** The operator uses `CONTROL_PLANE_API_KEY` and an
  anonymous visitor uses `CONTROL_PLANE_READ_API_KEY`, a non-admin key. If the
  read key is unset, or the control plane answers it with 401, the console
  falls back to the admin key and logs that (throttled). This keeps the
  console working before the read key is registered in the control plane's
  `AUTH_API_KEYS`.
- **`GET /registries`.** For anonymous callers, `baseUrl` is stripped from the
  observed-registry list (it is an internal address).
- **No passphrase in production.** Public routes still work and admin routes
  answer `503 CONSOLE_AUTH_NOT_CONFIGURED`. With the flag off, every route is
  503, as before.
- **Login.** `POST /api/auth/login` allows 10 attempts per IP per 10 minutes,
  in every mode. The limit is skipped when the client IP is unknown, so a
  shared bucket can't lock the operator out.
- **`GET /api/auth/session`** returns `{publicMode, signedIn}` and nothing
  else, ungated, for the UI chrome.
- **Logging.** Each console 403, 429 or 503 is logged with the service,
  method, path, reason and an `ipTag`: a truncated HMAC of the IP under a key
  derived from the passphrase, never the IP itself.
- **Rollback.** Turning the flag off restores the password gate, but not the
  pre-public-mode upstream wiring (the registry passthrough, the playground
  key and the client IP).

## When a session expires mid-use

```mermaid
flowchart TD
  A["fetchJson / fetchText gets !ok"] --> B{"status 401<br/>and unstamped<br/>(console-minted)?"}
  B -- no --> E["throw ApiError<br/>(page shows the error)"]
  B -- yes --> C{"current path public?<br/>isPublicRoute()"}
  C -- yes --> E
  C -- no --> D["window.location.assign('/login')"] --> E
```

- **Which 401s redirect.** `redirectToLoginOn401` (`lib/api/fetcher.ts`)
  redirects only on a 401 that carries **no** provenance stamp, meaning the
  console's own gate sent it. A stamped 401 comes from the upstream, typically
  a wrong or rotated `CONTROL_PLANE_API_KEY`. Sending the operator to `/login`
  for that would loop, since signing in cannot fix it.
- **SSE errors.** `EventSource` errors carry no HTTP status. The SSE hooks call
  `confirmSessionOrRedirect()`, which sends one gated
  `GET /api/proxy/control-plane/healthz` and lets the rule above decide.
  `useLiveRun` does this on the first error of each connection attempt;
  `useGlobalEvents` does it only once the browser has given up retrying
  (`readyState === CLOSED`). It never runs in demo mode.
- **Public routes.** `lib/routes.ts` (`PUBLIC_ROUTES = ['/login']`,
  `isPublicRoute`) lists the pages where no session is expected. It matches
  the exact path or a sub-path, so `/login-help` is not public. It controls
  only UI behaviour: the redirect is skipped there, and the topbar does not
  poll health. It does not secure anything; `middleware.ts` does.

## Tests

| Test | Covers |
|------|--------|
| `test/__tests__/middleware.test.ts` | Fail-open/fail-closed, Origin check, `X-Forwarded-Host` handling, 401 on a bad or expired token |
| `test/__tests__/auth-route.test.ts` | Login and logout responses and cookie attributes |
| `test/__tests__/routes.test.ts` | `isPublicRoute` matches the exact path or a sub-path, not a bare prefix |
| `test/__tests__/fetcher.test.ts` | Redirecting only on an unstamped 401, and `confirmSessionOrRedirect` |
| `test/integration/global-setup.ts` | Signs in through the real `/login` form and saves the cookie as Playwright `storageState` |

How to set the passphrase and the other environment variables is in
[Configuration](configuration.md). Deployment advice, including running behind
a reverse proxy that sets `X-Forwarded-Host`, is in [Deployment](deployment.md).
