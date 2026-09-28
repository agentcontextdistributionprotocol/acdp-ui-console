import { NextRequest } from 'next/server';
import {
  buildUpstreamUrl,
  getIntegrationConfig,
  isProxyService,
  type ProxyService,
} from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';

// Only forward a known-safe set of request headers upstream. Notably this
// excludes the browser's cookies and any client-supplied `authorization`, so a
// client can't borrow the proxy's trust (confused-deputy). The control-plane
// bearer token is injected server-side below.
const FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-language',
  'idempotency-key',
  'x-tenant-id',
  'x-run-id',
  'x-acdp-event-id',
]);

// The console has no user authentication of its own, so this route is the
// entire perimeter around a privileged upstream (control-plane requests carry
// the server-side bearer token below). It is deliberately NOT a generic
// reverse proxy: each service only forwards the exact (method, path) pairs
// `lib/api/client.ts` actually issues. Anything else — including paths that
// happen to exist upstream but the console never calls — is rejected before a
// request is ever sent out, so a leaked/guessed URL can't reach arbitrary
// upstream surface with the injected credential attached.
interface RouteMatcher {
  method: string;
  pattern: RegExp;
}

const REGISTRY_ROUTES: RouteMatcher[] = [
  { method: 'GET', pattern: /^\/healthz$/ },
  { method: 'GET', pattern: /^\/contexts\/search$/ },
  { method: 'GET', pattern: /^\/lineages\/[^/]+$/ },
  { method: 'GET', pattern: /^\/lineages\/[^/]+\/current$/ },
  { method: 'GET', pattern: /^\/\.well-known\/acdp\.json$/ },
  { method: 'GET', pattern: /^\/\.well-known\/jwks\.json$/ },
];

const ALLOWED_ROUTES: Record<ProxyService, RouteMatcher[]> = {
  playground: [
    { method: 'GET', pattern: /^\/healthz$/ },
    { method: 'GET', pattern: /^\/scenarios$/ },
    { method: 'POST', pattern: /^\/runs$/ },
    { method: 'GET', pattern: /^\/runs\/[^/]+$/ },
  ],
  'control-plane': [
    { method: 'GET', pattern: /^\/healthz$/ },
    { method: 'GET', pattern: /^\/dashboard\/overview$/ },
    { method: 'GET', pattern: /^\/runs$/ },
    { method: 'GET', pattern: /^\/runs\/[^/]+$/ },
    { method: 'GET', pattern: /^\/runs\/[^/]+\/lineage$/ },
    { method: 'GET', pattern: /^\/runs\/[^/]+\/events$/ },
    { method: 'GET', pattern: /^\/events$/ },
    { method: 'GET', pattern: /^\/agents$/ },
    { method: 'GET', pattern: /^\/registries$/ },
    { method: 'GET', pattern: /^\/registries\/enrollments$/ },
    { method: 'POST', pattern: /^\/registries\/enroll$/ },
    // Transparency-log witness state, read-only, in two shapes that look
    // alike and are not: per-authority state, and the collection-level alert
    // worklist. Neither pattern can admit the other's shape, because they
    // differ in the segment that is fixed:
    //
    //   /registries/:authority/log-witness   — `log-witness` is segment THREE
    //   /registries/log-witness/alerts       — `log-witness` is segment TWO
    //
    // so the per-authority pattern only matches a path ENDING in
    // `/log-witness`, which `.../alerts` does not, and the collection pattern
    // is a fixed three-segment literal with no variable part at all.
    //
    // `[^/]+` IS right for the authority: it is a DNS name, which contains
    // dots but never slashes — the opposite of the ctx_id case below. Both
    // patterns are `$`-anchored, which is what stops either from growing a
    // tail — including growing into the admin `:authority/log-witness/ack`
    // sibling, which is allow-listed separately below as a POST and must not
    // become reachable by GET.
    //
    // Upstream declares `log-witness/alerts` BEFORE `:authority/log-witness`
    // (`registries.controller.ts:51` and `:117`), which is why Nest does not
    // swallow `log-witness` as an `:authority` there. Our matching is
    // order-independent (`some` at `isAllowedRoute`), so we do not depend on
    // that — but do not "simplify" these two into one pattern on the strength
    // of it either. There is no per-authority `alerts` route upstream, so
    // widening the collection pattern's middle segment to `[^/]+` would admit
    // a shape the control plane does not serve; the route test asserts that
    // case by name, alongside three other widenings, and four adjacent shapes
    // around the per-authority pattern.
    // (`/registries/enrollments` needs no such guard — it is allow-listed on
    // its own line above, so neither pattern can admit or deny it.)
    { method: 'GET', pattern: /^\/registries\/[^/]+\/log-witness$/ },
    { method: 'GET', pattern: /^\/registries\/log-witness\/alerts$/ },
    // Acknowledging one authority's alert (#84). The file's SECOND
    // middle-variable pattern, so it carries the same over-reach risk as the
    // per-authority read above and gets the same treatment: `[^/]+` for a DNS
    // authority, `$`-anchored, and the route test asserts three adjacent
    // shapes out (a multi-segment authority, a tail, and GET on this path).
    //
    // POST, and the ONLY write this console issues under `/registries/` other
    // than `enroll`. It carries no body: upstream takes no `@Body()` and
    // derives the acknowledger server-side from the caller's own token, so
    // there is nothing for a client to send and nothing for this route to
    // forward beyond the path itself.
    { method: 'POST', pattern: /^\/registries\/[^/]+\/log-witness\/ack$/ },
    { method: 'GET', pattern: /^\/metrics$/ },
    { method: 'GET', pattern: /^\/webhooks$/ },
    { method: 'POST', pattern: /^\/webhooks$/ },
    { method: 'PATCH', pattern: /^\/webhooks\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/webhooks\/[^/]+$/ },
    // ctx_id is an `acdp://authority/uuid` URI (see lib/api/client.ts's
    // getContext) — it contains slashes, so this must NOT be `[^/]+`.
    { method: 'GET', pattern: /^\/contexts\/.+$/ },
    { method: 'GET', pattern: /^\/auth\/revocations$/ },
  ],
  'registry-a': REGISTRY_ROUTES,
  'registry-b': REGISTRY_ROUTES,
};

function isAllowedRoute(service: ProxyService, method: string, pathname: string): boolean {
  return ALLOWED_ROUTES[service].some((r) => r.method === method && r.pattern.test(pathname));
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
  if (!isAllowedRoute(service, method, pathname)) {
    return new Response(
      JSON.stringify({ error: `Forbidden: ${method} ${pathname} is not an allowed proxy route for '${service}'` }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }
  const config = getIntegrationConfig(service);
  const upstreamUrl = buildUpstreamUrl(service, pathname, request.nextUrl.search);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // Authorization is set deterministically per service — never inherited from
  // the client. Only the control-plane gets the server-side bearer token.
  if (config.authHeaderName === 'authorization' && config.authToken) {
    headers.set('authorization', `Bearer ${config.authToken}`);
  }

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.text();

  try {
    const response = await fetch(upstreamUrl, {
      method,
      headers,
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
    responseHeaders.set('cache-control', 'no-store');
    // The body is re-streamed decoded, so length/encoding framing no longer applies.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');

    return new Response(response.body, {
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
