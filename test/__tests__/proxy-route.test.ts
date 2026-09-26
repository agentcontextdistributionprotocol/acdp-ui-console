// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH, DELETE } from '@/app/api/proxy/[service]/[...path]/route';

/** Build the Next 15 async-params context the route handler expects. */
function ctx(service: string, path?: string[]) {
  return { params: Promise.resolve({ service, path }) };
}

/**
 * A minimal upstream Response stand-in. Casting a plain object (rather than a
 * real `new Response`) keeps undici's header guards from dropping the
 * `content-length` / `content-encoding` framing headers we want to assert on.
 */
function upstream(
  init: Partial<{ status: number; statusText: string; headers: Headers; body: unknown }> = {},
): Response {
  return {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? new Headers(),
    body: init.body ?? null,
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn((url: string | URL | Request, init: RequestInit) =>
    Promise.resolve(impl(String(url), init)),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('proxy route — routing & validation', () => {
  it('rejects an unknown service with 400 and never calls upstream', async () => {
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(new NextRequest('http://localhost/api/proxy/nope/x'), ctx('nope', ['x']));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Unknown service: nope' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the upstream url from the path segments and forwards the query string', async () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
    const fetchMock = mockFetch(() => upstream());
    await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/runs?limit=5'),
      ctx('control-plane', ['runs']),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/runs?limit=5');
  });

  it('hits the base url root when no path segments are given, for an allowed route', async () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
    const fetchMock = mockFetch(() => upstream());
    await GET(new NextRequest('http://localhost/api/proxy/playground/healthz'), ctx('playground', ['healthz']));
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/healthz');
  });
});

/**
 * Mirrors how Next.js resolves a `[...path]` catch-all: the raw URL is split
 * on LITERAL '/' first, and each resulting piece is percent-decoded
 * independently — so a `%2F` inside one raw segment (e.g. an
 * `encodeURIComponent`'d ctx_id, which itself contains '/') decodes into a
 * literal '/' EMBEDDED IN THAT SAME array element, not into extra array
 * entries. Empirically confirmed against a real `next start` server: a raw
 * segment `%2E%2E%2Fadmin%2Fsecrets` arrives as the single element
 * `'../admin/secrets'`, not as `['..', 'admin', 'secrets']`.
 */
function decodedCatchAllPath(...rawSegments: string[]): string[] {
  return rawSegments.map((s) => decodeURIComponent(s));
}

describe('proxy route — route allow-list', () => {
  it('rejects a path the console never calls, before touching upstream', async () => {
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/playground'),
      ctx('playground', undefined),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Forbidden: GET / is not an allowed proxy route for 'playground'",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Console-minted envelope: no upstream was contacted at all, so the
    // pass-through stamp must be absent. See the 502 test for why this
    // invariant is load-bearing for `ApiError.fromUpstream`.
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it('rejects a known path with the wrong method', async () => {
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/registries/enroll'),
      ctx('control-plane', ['registries', 'enroll']),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a dot-segment embedded (post-decode) inside one raw path segment, before it can traverse a `.+` pattern to another upstream route', async () => {
    // Encodes exactly the attack the widened /contexts/.+ pattern makes
    // reachable: one raw segment `%2E%2E%2Fadmin%2Fsecrets` decodes into the
    // single array element '../admin/secrets' (see decodedCatchAllPath) —
    // which would otherwise resolve upstream to /admin/secrets once joined
    // into the pathname.
    const path = decodedCatchAllPath('contexts', '%2E%2E%2Fadmin%2Fsecrets');
    expect(path).toEqual(['contexts', '../admin/secrets']);
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`),
      ctx('control-plane', path),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bare `..` array segment too (belt-and-suspenders, regardless of how it was split)', async () => {
    const path = ['contexts', '..', 'admin', 'secrets'];
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`),
      ctx('control-plane', path),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a DOUBLE-encoded dot segment that survives Next\'s single decode as the literal text "%2E%2E"', async () => {
    // Next decodes %252E%252E once, landing here as the plain 6-character
    // string "%2E%2E" — not '.'/'..', so the literal pathComponents check
    // never fires. But the WHATWG URL parser fetch() itself uses DOES
    // recognize this spelling as a dot segment and normalizes it away, so
    // without the URL-diff guard this would still reach an arbitrary route.
    const path = ['contexts', '%2E%2E', 'admin', 'secrets'];
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`),
      ctx('control-plane', path),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a path segment carrying an embedded query string (%3F), before it reaches the allow-list', async () => {
    const path = decodedCatchAllPath('contexts', encodeURIComponent('id?all=1'));
    expect(path).toEqual(['contexts', 'id?all=1']);
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`),
      ctx('control-plane', path),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a real acdp:// ctx_id — which decodes to a segment containing embedded slashes', async () => {
    // getContext() in lib/api/client.ts sends `/contexts/${encodeURIComponent(ctxId)}`.
    // A real ctx_id is an `acdp://authority/uuid` URI, so the one raw,
    // encoded URL segment decodes back into a single array element that
    // itself contains '/' characters — never a flat, slash-free id.
    const ctxId = 'acdp://registry-a.playground.local/f4a2c9e1-1d2b-4a3c-9e8f-001';
    const path = decodedCatchAllPath('contexts', encodeURIComponent(ctxId));
    expect(path).toEqual(['contexts', ctxId]); // sanity: decodes in place, no re-split
    const fetchMock = mockFetch(() => upstream());
    const res = await GET(
      new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`),
      ctx('control-plane', path),
    );
    expect(res.status).not.toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows every route lib/api/client.ts actually issues', async () => {
    const cases: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; service: string; path: string[] }> = [
      { method: 'GET', service: 'playground', path: ['healthz'] },
      { method: 'GET', service: 'playground', path: ['scenarios'] },
      { method: 'POST', service: 'playground', path: ['runs'] },
      { method: 'GET', service: 'playground', path: ['runs', 'r1'] },
      { method: 'GET', service: 'control-plane', path: ['healthz'] },
      { method: 'GET', service: 'control-plane', path: ['dashboard', 'overview'] },
      { method: 'GET', service: 'control-plane', path: ['runs'] },
      { method: 'GET', service: 'control-plane', path: ['runs', 'r1'] },
      { method: 'GET', service: 'control-plane', path: ['runs', 'r1', 'lineage'] },
      { method: 'GET', service: 'control-plane', path: ['runs', 'r1', 'events'] },
      { method: 'GET', service: 'control-plane', path: ['events'] },
      { method: 'GET', service: 'control-plane', path: ['agents'] },
      { method: 'GET', service: 'control-plane', path: ['registries'] },
      { method: 'GET', service: 'control-plane', path: ['registries', 'enrollments'] },
      { method: 'POST', service: 'control-plane', path: ['registries', 'enroll'] },
      { method: 'GET', service: 'control-plane', path: ['metrics'] },
      { method: 'GET', service: 'control-plane', path: ['webhooks'] },
      { method: 'POST', service: 'control-plane', path: ['webhooks'] },
      { method: 'PATCH', service: 'control-plane', path: ['webhooks', 'wh1'] },
      { method: 'DELETE', service: 'control-plane', path: ['webhooks', 'wh1'] },
      { method: 'GET', service: 'control-plane', path: ['contexts', 'ctx1'] },
      {
        method: 'GET',
        service: 'control-plane',
        path: decodedCatchAllPath('contexts', encodeURIComponent('acdp://registry-a.playground.local/f4a2c9e1')),
      },
      { method: 'GET', service: 'control-plane', path: ['auth', 'revocations'] },
      // A DNS authority: dots, no slashes — so the `[^/]+` in the pattern is
      // the right shape here, unlike the ctx_id case above.
      { method: 'GET', service: 'control-plane', path: ['registries', 'registry-a.example.com', 'log-witness'] },
      { method: 'GET', service: 'registry-a', path: ['healthz'] },
      { method: 'GET', service: 'registry-a', path: ['contexts', 'search'] },
      { method: 'GET', service: 'registry-a', path: ['lineages', 'l1'] },
      { method: 'GET', service: 'registry-a', path: ['lineages', 'l1', 'current'] },
      { method: 'GET', service: 'registry-a', path: ['.well-known', 'acdp.json'] },
      { method: 'GET', service: 'registry-a', path: ['.well-known', 'jwks.json'] },
      { method: 'GET', service: 'registry-b', path: ['contexts', 'search'] },
    ];
    for (const { method, service, path } of cases) {
      const fetchMock = mockFetch(() => upstream());
      const url = `http://localhost/api/proxy/${service}/${path.join('/')}`;
      const handler = method === 'GET' ? GET : method === 'POST' ? POST : method === 'PATCH' ? PATCH : DELETE;
      const res = await handler(new NextRequest(url, { method }), ctx(service, path));
      expect(res.status, `${method} ${service}/${path.join('/')}`).not.toBe(403);
      expect(fetchMock, `${method} ${service}/${path.join('/')}`).toHaveBeenCalledTimes(1);
    }
  });

  // The `:authority/log-witness` entry is the only pattern in the file with a
  // variable segment in the MIDDLE, so it is the one most able to over-reach.
  // Each case below is a route that sits one character away from it and must
  // stay out: the admin acknowledgement sibling, the collection-level alerts
  // route, a multi-segment authority, the wrong method, and an arbitrary
  // second tail under a legitimate authority.
  it('the log-witness pattern admits exactly one shape and nothing adjacent to it', async () => {
    const cases: Array<{ method: 'GET' | 'POST'; path: string[]; why: string }> = [
      {
        method: 'POST',
        path: ['registries', 'registry-a.example.com', 'log-witness'],
        why: 'read-only: no write verb is allow-listed on this path',
      },
      {
        method: 'GET',
        path: ['registries', 'registry-a.example.com', 'log-witness', 'ack'],
        why: 'the admin acknowledgement sibling is deliberately not proxied',
      },
      {
        method: 'GET',
        path: ['registries', 'log-witness', 'alerts'],
        why: 'the collection-level alerts route is a different, unproxied feature',
      },
      {
        method: 'GET',
        path: ['registries', 'a', 'b', 'log-witness'],
        why: 'a DNS authority is one segment; [^/]+ must not span a slash',
      },
      {
        method: 'GET',
        path: ['registries', 'registry-a.example.com', 'enrollments'],
        why: 'the variable segment must not admit an arbitrary tail',
      },
    ];
    for (const { method, path, why } of cases) {
      const fetchMock = mockFetch(() => upstream());
      const url = `http://localhost/api/proxy/control-plane/${path.join('/')}`;
      const handler = method === 'GET' ? GET : POST;
      const res = await handler(new NextRequest(url, { method }), ctx('control-plane', path));
      expect(res.status, `${method} ${path.join('/')} — ${why}`).toBe(403);
      expect(fetchMock, `${method} ${path.join('/')} — ${why}`).not.toHaveBeenCalled();
    }
  });
});

describe('proxy route — request header hygiene', () => {
  it('forwards allow-listed headers but strips cookies and client authorization', async () => {
    const fetchMock = mockFetch(() => upstream());
    const req = new NextRequest('http://localhost/api/proxy/registry-a/contexts/search', {
      headers: {
        cookie: 'session=abc',
        authorization: 'Bearer client-token',
        'x-tenant-id': 'tenant-7',
        'content-type': 'application/json',
      },
    });
    await GET(req, ctx('registry-a', ['contexts', 'search']));
    const sent = fetchMock.mock.calls[0][1].headers as Headers;
    expect(sent.get('x-tenant-id')).toBe('tenant-7');
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('cookie')).toBeNull();
    expect(sent.get('authorization')).toBeNull();
  });

  it('injects the server-side bearer token only for the control-plane', async () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'cp-secret');
    const fetchMock = mockFetch(() => upstream());
    await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/runs'),
      ctx('control-plane', ['runs']),
    );
    const sent = fetchMock.mock.calls[0][1].headers as Headers;
    expect(sent.get('authorization')).toBe('Bearer cp-secret');
  });

  it('never lets a client authorization header reach a registry', async () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'cp-secret');
    const fetchMock = mockFetch(() => upstream());
    const req = new NextRequest('http://localhost/api/proxy/registry-b/contexts/search', {
      headers: { authorization: 'Bearer client-token' },
    });
    await GET(req, ctx('registry-b', ['contexts', 'search']));
    const sent = fetchMock.mock.calls[0][1].headers as Headers;
    expect(sent.get('authorization')).toBeNull();
  });
});

describe('proxy route — body & fetch options', () => {
  it('passes a POST body through and pins the fetch options', async () => {
    const fetchMock = mockFetch(() => upstream());
    const req = new NextRequest('http://localhost/api/proxy/playground/runs', {
      method: 'POST',
      body: '{"scenario":"s1"}',
      headers: { 'content-type': 'application/json' },
    });
    await POST(req, ctx('playground', ['runs']));
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe('{"scenario":"s1"}');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
  });
});

describe('proxy route — response header scrubbing & errors', () => {
  it('drops framing headers, tags the proxy, and propagates status', async () => {
    mockFetch(() =>
      upstream({
        status: 201,
        statusText: 'Created',
        headers: new Headers({
          'content-encoding': 'gzip',
          'content-length': '99',
          'transfer-encoding': 'chunked',
          'x-upstream': 'keep-me',
        }),
      }),
    );
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/registry-a/contexts/search'),
      ctx('registry-a', ['contexts', 'search']),
    );
    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Created');
    expect(res.headers.get('x-acdp-ui-proxy')).toBe('registry-a');
    expect(res.headers.get('x-upstream')).toBe('keep-me');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('transfer-encoding')).toBeNull();
  });

  it('returns 502 when the upstream fetch throws', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/runs'),
      ctx('control-plane', ['runs']),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Upstream 'control-plane' unreachable");
    expect(body.detail).toContain('ECONNREFUSED');
    // The stamp must be ABSENT here. `ApiError.fromUpstream` reads exactly this
    // header to decide whether bytes crossed our boundary, and `pingHealth`
    // turns that into the word an operator reads. Stamping this envelope would
    // report the proxy's own "upstream unreachable" as the SERVICE reporting
    // itself degraded — the defect Phase 6 round 3 caught, in its purest form.
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The non-2xx passthrough.
//
// Everything the console does with a structured upstream error — the
// federation proxy's `CONTEXT_ID_MISMATCH` / `CONTEXT_BINDING_UNVERIFIABLE`
// split, `FEDERATION_UPSTREAM_RATE_LIMITED`, `ApiError.errorCode` and the
// message map keyed off it — rests on the error BODY surviving this hop
// intact. Every existing assertion here is about status, headers or the
// request; none of them read a relayed error body, so a change that swallowed
// or rewrote one (an error-shaped JSON wrapper, say) would have left this
// suite green while every error message in the console silently degraded to
// its status fallback.
// ══════════════════════════════════════════════════════════════════════
describe('proxy route — a non-2xx upstream body is relayed byte-for-byte', () => {
  /** A one-chunk stream, so the relayed bytes are the upstream's own. */
  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  it('a 502 structured error round-trips, errorCode and all', async () => {
    const upstreamBody = JSON.stringify({
      statusCode: 502,
      errorCode: 'CONTEXT_BINDING_UNVERIFIABLE',
      message: "upstream registry 'registry-a.playground.local' returned a response whose ctx_id binding could not be verified",
      error: { code: 'CONTEXT_BINDING_UNVERIFIABLE', message: 'could not verify' },
    });
    mockFetch(() =>
      upstream({
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: streamOf(upstreamBody),
      }),
    );
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/contexts/acdp%3A%2F%2Fa%2Fb'),
      ctx('control-plane', ['contexts', 'acdp://a/b']),
    );

    expect(res.status).toBe(502);
    // Byte-for-byte: the exact string, not a re-serialization of a parsed copy.
    await expect(res.text()).resolves.toBe(upstreamBody);
  });

  it('the relayed body is what ApiError reads its errorCode from', async () => {
    // The end-to-end link, asserted rather than assumed: the passthrough above
    // is only useful because `ApiError` parses exactly those bytes, and the
    // message map then keys off the result.
    const { ApiError } = await import('@/lib/api/fetcher');
    const upstreamBody = JSON.stringify({ errorCode: 'FEDERATION_UPSTREAM_RATE_LIMITED', message: "upstream 'r' is rate limiting (Retry-After: 30)" });
    mockFetch(() =>
      upstream({
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: streamOf(upstreamBody),
      }),
    );
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/control-plane/contexts/acdp%3A%2F%2Fa%2Fb'),
      ctx('control-plane', ['contexts', 'acdp://a/b']),
    );
    const relayed = await res.text();
    expect(new ApiError(res.status, relayed, 'control-plane', '/contexts/x').errorCode).toBe(
      'FEDERATION_UPSTREAM_RATE_LIMITED',
    );
  });

  it('a non-JSON error body is relayed unchanged too, rather than being coerced', async () => {
    // A proxy or WAF in front of a registry answering with HTML is one of the
    // documented causes of CONTEXT_BINDING_UNVERIFIABLE upstream. This hop must
    // not turn it into something that parses — an `errorCode` invented here
    // would be a claim no upstream made.
    const html = '<html><head><title>504 Gateway Time-out</title></head><body>nginx</body></html>';
    mockFetch(() =>
      upstream({
        status: 504,
        statusText: 'Gateway Timeout',
        headers: new Headers({ 'content-type': 'text/html' }),
        body: streamOf(html),
      }),
    );
    const res = await GET(
      new NextRequest('http://localhost/api/proxy/registry-a/contexts/search'),
      ctx('registry-a', ['contexts', 'search']),
    );
    expect(res.status).toBe(504);
    await expect(res.text()).resolves.toBe(html);
  });
});
