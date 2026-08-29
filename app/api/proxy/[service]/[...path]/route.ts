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
      redirect: 'manual',
      cache: 'no-store',
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-acdp-ui-proxy', service);
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
