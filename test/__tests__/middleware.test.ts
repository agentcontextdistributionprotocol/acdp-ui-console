// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from '@/middleware';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/server/session';
import { GET as proxyGET, POST as proxyPOST, PATCH as proxyPATCH, DELETE as proxyDELETE } from '@/app/api/proxy/[service]/[...path]/route';
import { GET as streamEventsGET } from '@/app/api/stream/events/route';

const PASSWORD = 'correct-horse-battery-staple';

function proxyCtx(service: string, path?: string[]) {
  return { params: Promise.resolve({ service, path }) };
}

/** A minimal upstream Response stand-in (see proxy-route.test.ts for why a
 * plain object, not `new Response`, is used here). */
function upstream(): Response {
  return { status: 200, statusText: 'OK', headers: new Headers(), body: null } as unknown as Response;
}

function mockFetch() {
  const fn = vi.fn(() => Promise.resolve(upstream()));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Mirrors how Next.js actually dispatches a gated request in production:
 * middleware runs first, and the route handler only runs at all if
 * middleware returns a pass-through response (NextResponse.next() stamps
 * `x-middleware-next: 1`). This is what makes "the upstream fetch is never
 * called" a meaningful assertion rather than a tautology.
 */
async function runGated(
  request: NextRequest,
  // `any` here deliberately: this glue has to accept both the 2-arg proxy
  // route handlers (which take a `{ params }` context) and the 1-arg stream
  // handlers, so a precise shared type isn't worth the friction in a test file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: NextRequest, ctx?: any) => Promise<Response>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlerCtx?: any,
): Promise<Response> {
  const gateResult = await middleware(request);
  if (gateResult.headers.get('x-middleware-next') === '1') {
    return handler(request, handlerCtx);
  }
  return gateResult;
}

function cookieHeader(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('middleware — unauthenticated requests are rejected before upstream is touched', () => {
  it('401s an unauthenticated GET to a proxy route, never calling upstream', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs');
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PATCH', 'DELETE'] as const)(
    '401s an unauthenticated mutating %s to a proxy route, never calling upstream',
    async (method) => {
      vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
      const fetchMock = mockFetch();
      const handler = method === 'POST' ? proxyPOST : method === 'PATCH' ? proxyPATCH : proxyDELETE;
      const path = method === 'PATCH' || method === 'DELETE' ? ['webhooks', 'wh1'] : ['registries', 'enroll'];
      const req = new NextRequest(`http://localhost/api/proxy/control-plane/${path.join('/')}`, { method });
      const res = await runGated(req, handler, proxyCtx('control-plane', path));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('401s an unauthenticated GET to /api/stream/events, never calling upstream', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/stream/events');
    const res = await runGated(req, streamEventsGET);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gates an unprivileged service (registry-a) the same as control-plane, for uniformity', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/registry-a/healthz');
    const res = await runGated(req, proxyGET, proxyCtx('registry-a', ['healthz']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('middleware — session validation', () => {
  it('passes a valid session cookie through to the route handler', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs', {
      headers: cookieHeader(token),
    });
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).not.toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered HMAC signature', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const [payload, signature] = token.split('.');
    // Flip the FIRST base64url character, not the last: a signature's final
    // sextet is partly unused padding bits (256 bits doesn't divide evenly
    // into 6-bit groups), so flipping it can — depending on the byte values
    // — decode to the identical byte and produce a false negative here.
    const flipped = signature[0] === 'A' ? 'B' : 'A';
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs', {
      headers: cookieHeader(tampered),
    });
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    vi.useFakeTimers();
    const token = await createSessionToken(PASSWORD);
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000); // past the ~12h TTL
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs', {
      headers: cookieHeader(token),
    });
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a session signed under a different password', async () => {
    const token = await createSessionToken('a-totally-different-password');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs', {
      headers: cookieHeader(token),
    });
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing session cookie the same as a garbage one', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs', {
      headers: cookieHeader('not-a-real-token'),
    });
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('middleware — missing ACDP_UI_CONSOLE_PASSWORD behaves per environment', () => {
  it('fails CLOSED (503) in production when the var is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs');
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails OPEN in development when the var is unset, and logs a warning', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/runs');
    const res = await runGated(req, proxyGET, proxyCtx('control-plane', ['runs']));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('ACDP_UI_CONSOLE_PASSWORD');
  });
});

describe('middleware — CSRF Origin backstop on state-changing methods', () => {
  it('403s a state-changing request whose Origin does not match this host', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: { ...cookieHeader(token), origin: 'https://evil.example.com' },
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a same-origin state-changing request with a valid session', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: {
        ...cookieHeader(token),
        host: 'localhost',
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for the bug the verifier found: `request.nextUrl.host`
  // is `localhost` for every request constructed above (it's synthesized from
  // the URL string, not from any header), which is exactly the one value that
  // makes a buggy `nextUrl.host`-based comparison coincide with the correct
  // answer. A realistic deployment host is required to actually exercise
  // `resolveRequestHost`'s use of the `Host`/`X-Forwarded-Host` headers.
  it('passes a matching Origin + real-world Host on a non-localhost deployment', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('https://console.example.com/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: {
        ...cookieHeader(token),
        host: 'console.example.com',
        origin: 'https://console.example.com',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('403s a mismatched Origin on a non-localhost deployment even though nextUrl.host would coincidentally match a naive check', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('https://console.example.com/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: {
        ...cookieHeader(token),
        host: 'console.example.com',
        origin: 'https://evil.example.com',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers X-Forwarded-Host over Host (reverse-proxy scenario: Host is the upstream address)', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('https://console.example.com/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: {
        ...cookieHeader(token),
        host: 'internal-upstream:3000',
        'x-forwarded-host': 'console.example.com',
        origin: 'https://console.example.com',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The three cases above all construct the request URL and the Host/
  // X-Forwarded-Host headers with the *same* hostname, so they'd still pass
  // even against the original buggy `originHost !== request.nextUrl.host`
  // comparison — nextUrl.host derives from the URL string, and here the URL
  // string happens to already equal the header value. That's not the shape
  // standalone Next actually produces: `next start` / `.next/standalone`
  // synthesize nextUrl from the bind address (effectively localhost), while
  // the real deployment host only ever shows up in the Host/X-Forwarded-Host
  // headers. This test deliberately splits the two so it fails against
  // nextUrl.host-based logic and only passes against the fixed
  // header-based resolveRequestHost().
  it('CSRF check uses the real Host, not the synthesized nextUrl.host (standalone runtime shape)', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const token = await createSessionToken(PASSWORD);
    const fetchMock = mockFetch();
    const req = new NextRequest('http://localhost:3000/api/proxy/control-plane/registries/enroll', {
      method: 'POST',
      headers: {
        ...cookieHeader(token),
        host: 'console.example.com',
        'x-forwarded-host': 'console.example.com',
        origin: 'https://console.example.com',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await runGated(req, proxyPOST, proxyCtx('control-plane', ['registries', 'enroll']));
    expect(res.status).not.toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('middleware — route matcher config', () => {
  it('only gates /api/proxy and /api/stream, matching what Next.js actually wires up', () => {
    expect(config.matcher).toEqual(['/api/proxy/:path*', '/api/stream/:path*']);
  });
});
