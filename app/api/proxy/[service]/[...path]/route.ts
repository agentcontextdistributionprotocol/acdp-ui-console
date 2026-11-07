import { NextRequest } from 'next/server';
import {
  buildUpstreamUrl,
  isProxyService,
  upstreamAuthHeaders,
  type ControlPlaneCredential,
  type ProxyService,
} from '@/lib/server/integrations';
import { matchRoute } from '@/lib/server/proxy-allowlist';
import { controlPlaneCredential, decideAccess, logCredentialFallback } from '@/lib/server/access';

export const dynamic = 'force-dynamic';

// Only forward a known-safe set of request headers upstream. Notably this
// excludes the browser's cookies and any client-supplied `authorization`, so a
// client can't borrow the proxy's trust (confused-deputy). The control-plane
// bearer token is injected server-side below. `x-tenant-id` is deliberately
// absent too: RFC-ACDP-0008 §6.4 requires an authenticated gateway to stamp
// that header, not relay a browser-chosen one, and this console never sets it.
const FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-language',
  'idempotency-key',
  'x-run-id',
  'x-acdp-event-id',
]);

// The allow-list itself (exact method + path per service, and each route's
// public/admin access) lives in `lib/server/proxy-allowlist.ts`.

/** Removes every `baseUrl` key from a JSON document; `undefined` if it is not JSON. */
function stripBaseUrls(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'baseUrl')
          .map(([key, v]) => [key, strip(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(strip(parsed));
}

function isPlaygroundRegistryUnreachable(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    return (
      typeof detail === 'object' && detail !== null && (detail as { code?: unknown }).code === 'registry_unreachable'
    );
  } catch {
    return false;
  }
}

async function forward(
  request: NextRequest,
  context: { params: Promise<{ service: string; path?: string[] }> },
) {
  const { service: rawService, path } = await context.params;
  if (!isProxyService(rawService)) {
    return new Response(JSON.stringify({ error: `Unknown service: ${rawService}` }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const service = rawService as ProxyService;
  const method = request.method.toUpperCase();
  const segments = path ?? [];
  // Next.js splits the raw URL path on literal '/' FIRST, then percent-decodes
  // each resulting piece independently — so an encoded `%2F` inside one raw
  // segment decodes into a literal '/' embedded IN THAT SAME array element
  // (e.g. `%2E%2E%2Fadmin` arrives here as path = ['contexts',
  // '../admin/secrets']), not as extra array elements. A dot-segment or an
  // embedded '?'/'#' therefore has to be looked for in the fully-joined
  // pathname's OWN '/'-split components, not in `segments` itself — otherwise
  // a pattern like `/contexts/.+` (real ctx_ids legitimately contain '/')
  // could traverse to a different upstream path, or splice a query string,
  // once buildUpstreamUrl's raw string concatenation is fetched (fetch() then
  // normalizes '..' away).
  const pathComponents = segments.join('/').split('/');
  if (pathComponents.some((s) => s === '.' || s === '..' || s.includes('?') || s.includes('#'))) {
    return new Response(JSON.stringify({ error: 'Forbidden: path traversal' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const pathname = `/${segments.join('/')}`;
  // Belt-and-suspenders against the literal check above: a DOUBLE-encoded dot
  // segment (`%252E%252E`) survives Next's single percent-decode pass as the
  // literal text "%2E%2E", which `pathComponents` never recognizes as a dot
  // segment — but the WHATWG URL parser `fetch()` itself uses DOES (the spec's
  // path-segment state explicitly matches the case-insensitive encoded
  // spellings of '.'/'..', not just the bare characters, and normalizes them
  // away). Building a throwaway URL from this exact pathname and diffing
  // catches anything that would be silently rewritten between here and the
  // real fetch call, whatever encoding trick produced it.
  if (new URL(`http://proxy-guard.invalid${pathname}`).pathname !== pathname) {
    return new Response(JSON.stringify({ error: 'Forbidden: path traversal' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const route = matchRoute(service, method, pathname);
  if (!route) {
    return new Response(
      JSON.stringify({ error: `Forbidden: ${method} ${pathname} is not an allowed proxy route for '${service}'` }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }
  // Who may call it (operator session, public mode, per-IP limits), decided
  // on the same decoded path the allow-list just matched. Refusals are the
  // console's own and unstamped. See `lib/server/access.ts`.
  const decision = await decideAccess(request, {
    service,
    method,
    path: pathname,
    access: route.access,
    limit: route.limit,
  });
  if (!decision.ok) return decision.response;
  const anonymous = decision.publicMode && !decision.operator;
  const upstreamUrl = buildUpstreamUrl(service, pathname, request.nextUrl.search);

  const baseHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_HEADERS.has(key.toLowerCase())) baseHeaders.set(key, value);
  });

  // Credentials are set deterministically per service — never inherited from
  // the client (FORWARD_HEADERS already dropped any client-sent
  // `authorization`, `x-api-key` or `x-acdp-client-ip`). The control plane gets
  // its server-side bearer; the playground and the registries (reached through
  // the playground's passthrough) get the playground key plus the end user's
  // IP from a trusted header, so the playground charges its per-IP limits to
  // the visitor rather than to this console.
  //
  // The control plane gets the admin key for the operator (and for every
  // caller with the flag off), the non-admin read key for an anonymous
  // public-mode visitor (`controlPlaneCredential`).
  const headersFor = (credential: ControlPlaneCredential) => {
    const headers = new Headers(baseHeaders);
    for (const [name, value] of Object.entries(
      upstreamAuthHeaders(service, { credential, clientIp: decision.clientIp }),
    )) {
      headers.set(name, value);
    }
    return headers;
  };
  const credential: ControlPlaneCredential = service === 'control-plane' ? controlPlaneCredential(!anonymous) : 'admin';

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.text();

  const send = (credential: ControlPlaneCredential) =>
    fetch(upstreamUrl, {
      method,
      headers: headersFor(credential),
      body,
      // Pinned by `proxy-route.test.ts`, and load-bearing together with the
      // 3xx rejection immediately below. 'manual' is what stops undici from
      // chasing the redirect server-side, which matters in two different ways
      // depending on where it points (measured on Node 24.20.0, not assumed):
      //
      //  - SAME-ORIGIN, e.g. the control plane 302ing `/healthz` to
      //    `/internal/dump`: undici keeps the `authorization` header, so the
      //    upstream would be choosing which of ITS OWN paths this proxy calls
      //    with the injected bearer attached — straight past `ALLOWED_ROUTES`,
      //    which is the whole point of this handler not being a generic
      //    reverse proxy.
      //  - CROSS-ORIGIN: undici strips `authorization` (the fetch spec's
      //    cross-origin header removal), so the bearer does NOT travel — but
      //    the redirect target's answer would still come back and be relayed
      //    under our own stamp, i.e. attributed to a service that never sent
      //    it.
      //
      // The rejection below is the other half: it stops the 3xx itself from
      // reaching the browser, which follows redirects by default. Neither half
      // works alone.
      redirect: 'manual',
      cache: 'no-store',
    });

  try {
    let response = await send(credential);
    // The read key may not be registered with the control plane yet. A 401 to
    // it is retried once with the admin key and logged, so anonymous reads
    // keep working before and after that rollout. Only GETs are public on the
    // control plane, so the retry never repeats a write.
    if (credential === 'read' && response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      logCredentialFallback('rejected');
      response = await send('admin');
    }

    // A 3xx is never relayed.
    //
    // Under undici, `redirect: 'manual'` hands back the REAL redirect (not an
    // opaque one), so this could be re-streamed with the stamp attached — and
    // that is exactly the lie to avoid. The browser's own `fetch` in
    // `lib/api/fetcher.ts` uses the default `redirect: 'follow'`, so the
    // response the console finally inspects would be the redirect TARGET's:
    // bytes that never passed through this proxy, carrying no stamp and no
    // injected bearer. The realistic trigger is a `*_BASE_URL` on `http://`
    // behind an ingress that 301s to `https://`, and on a registry (no CORS
    // headers by default) the cross-origin follow fails — so a service that
    // is genuinely UP renders as `unreachable`, silently. Minting an
    // unstamped 502 here says the same "we could not reach it" while naming
    // the cause, and keeps the stamp meaning exactly one thing.
    //
    // The whole 3xx range, deliberately, 304 included: it cannot legitimately
    // arrive (both hops are `cache: 'no-store'` and no conditional-request
    // header is in FORWARD_HEADERS), and relaying one would not be harmless —
    // a 304 is `!response.ok`, so it would reach the browser as a STAMPED
    // `ApiError` and read as the service reporting itself degraded. Which is
    // also why the operator copy below says what the upstream answered rather
    // than calling every status in the range "a redirect".
    //
    // `opaqueredirect` is belt-and-braces for a runtime this handler does not
    // have today: undici returns the real 3xx (verified on Node 24.20.0), but
    // browser-semantics `fetch` answers `redirect: 'manual'` with a synthetic
    // `status: 0` response that the range check alone would wave through — and
    // `new Response(body, { status: 0 })` then throws into the catch below,
    // reporting an unreachable upstream for a service that answered.
    if (
      (response.status >= 300 && response.status < 400) ||
      response.type === 'opaqueredirect'
    ) {
      const location = response.headers.get('location');
      const answered = response.type === 'opaqueredirect' ? 'an opaque redirect' : `${response.status}`;
      return new Response(
        JSON.stringify({
          error: `Upstream '${service}' answered ${answered} — this proxy does not relay or follow 3xx responses`,
          detail: `${upstreamUrl} -> ${location ?? '(no Location header)'}. Point this service's *_BASE_URL at the final URL (often the https:// form) so no request has to cross a redirect.`,
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    // A registry is reached through the playground, so "the registry is down"
    // arrives as the PLAYGROUND's own 502 `registry_unreachable` — an answer
    // from beyond our boundary, but not from the registry. Stamping it would
    // make `pingHealth` call a registry nobody reached `degraded`; answer with
    // our own unstamped 502 instead, the same envelope as the catch below. Only
    // a registry 502 is buffered to look; every other response streams as is.
    let relayBody: BodyInit | null = response.body;
    if (service !== 'playground' && service !== 'control-plane' && response.status === 502) {
      const text = await response.text();
      if (isPlaygroundRegistryUnreachable(text)) {
        return new Response(
          JSON.stringify({
            error: `Upstream '${service}' unreachable`,
            detail: `the playground could not reach ${service} (registry_unreachable)`,
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        );
      }
      relayBody = text;
    }

    // The control plane fills each observed registry's `baseUrl` from ingest,
    // and once registries are private that is an internal address. An
    // anonymous public-mode visitor gets the list without it; the operator,
    // and every caller with the flag off, get the bytes untouched. A 2xx we
    // cannot parse is not relayed to an anonymous caller at all.
    if (anonymous && service === 'control-plane' && pathname === '/registries' && response.ok) {
      const stripped = stripBaseUrls(await response.text());
      if (stripped === undefined) {
        return new Response(
          JSON.stringify({ error: `Upstream '${service}' answered an unreadable registry list` }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        );
      }
      relayBody = stripped;
    }

    const responseHeaders = new Headers(response.headers);
    // LOAD-BEARING, not a debugging aid: this stamp is the only evidence the
    // browser gets that these bytes came from beyond our own boundary.
    // `ApiError.fromUpstream` reads it and `pingHealth` turns it into the word
    // an operator sees — `degraded` (something upstream answered, badly) vs
    // `unreachable` (nothing out there answered). It belongs ONLY here, on the
    // pass-through: setting it on any envelope this route mints itself would
    // report the console's own failure as the service reporting itself unwell.
    // `proxy-route.test.ts` asserts both its presence here and its absence on
    // the 403, the redirect 502 above and the unreachable 502 below.
    responseHeaders.set('x-acdp-ui-proxy', service);
    // Paired with the stamp above, and for the same reason. The stamp says
    // "something beyond our boundary answered"; a cache between here and the
    // browser could replay that claim long after the service stopped answering,
    // so a stale `/healthz` 200 would read as live evidence of health. No route
    // in the allow-list is safe to replay: the mutations obviously not, and even
    // the content-bound reads (`/contexts/{ctx_id}`) carry mutable lifecycle and
    // revocation state, which is exactly what the console fail-closes on.
    // The two that look static are the ones that most need this: a cached
    // `/.well-known/jwks.json` defeats key rotation, and a stale
    // `/.well-known/acdp.json` misreports what a registry supports. If a route
    // ever is genuinely cacheable, add a carve-out here — do not delete the line.
    // `no-transform` is the other half: `content-encoding` is deleted below
    // because the body travels decoded and therefore recompressible, and an
    // intermediary doing that recompression would rewrite the exact bytes
    // `/.well-known/jwks.json`, `/.well-known/acdp.json` and
    // `/contexts/{ctx_id}` hand to `lib/verify/verify.ts`'s wasm verifier to
    // hash — a transform between here and the browser is as much a threat to
    // that hash as a cache replaying a stale response is to the stamp above.
    responseHeaders.set('cache-control', 'no-store, no-transform');
    // The body is re-streamed decoded, so length/encoding framing no longer applies.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');

    return new Response(relayBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream '${service}' unreachable`, detail: String(err) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
