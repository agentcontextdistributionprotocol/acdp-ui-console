// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/server/session';
import { GET, POST, PATCH, DELETE } from '@/app/api/proxy/[service]/[...path]/route';
import { GET as eventsGET } from '@/app/api/stream/events/route';
import { GET as runStreamGET } from '@/app/api/stream/runs/[runId]/route';
import { GET as sessionGET } from '@/app/api/auth/session/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { ALLOWED_ROUTES } from '@/lib/server/proxy-allowlist';
import { consoleRateLimiter, consoleStreamGate } from '@/lib/server/rate-limit';
import { resetCredentialFallbackLog } from '@/lib/server/access';
import type { ProxyService } from '@/lib/types';

const PASSWORD = 'correct-horse-battery-staple';
const HANDLERS = { GET, POST, PATCH, DELETE } as const;

/** One concrete path per allow-list entry; a test below proves full coverage. */
const SAMPLES: [ProxyService, keyof typeof HANDLERS, string][] = [
  ['playground', 'GET', '/healthz'],
  ['playground', 'GET', '/scenarios'],
  ['playground', 'POST', '/runs'],
  ['playground', 'GET', '/runs/r1'],
  ['control-plane', 'GET', '/healthz'],
  ['control-plane', 'GET', '/dashboard/overview'],
  ['control-plane', 'GET', '/runs'],
  ['control-plane', 'GET', '/runs/r1'],
  ['control-plane', 'GET', '/runs/r1/lineage'],
  ['control-plane', 'GET', '/runs/r1/events'],
  ['control-plane', 'GET', '/events'],
  ['control-plane', 'GET', '/agents'],
  ['control-plane', 'GET', '/registries'],
  ['control-plane', 'GET', '/registries/enrollments'],
  ['control-plane', 'POST', '/registries/enroll'],
  ['control-plane', 'GET', '/registries/a.example/log-witness'],
  ['control-plane', 'GET', '/registries/log-witness/alerts'],
  ['control-plane', 'POST', '/registries/a.example/log-witness/ack'],
  ['control-plane', 'GET', '/metrics'],
  ['control-plane', 'GET', '/webhooks'],
  ['control-plane', 'POST', '/webhooks'],
  ['control-plane', 'PATCH', '/webhooks/w1'],
  ['control-plane', 'DELETE', '/webhooks/w1'],
  ['control-plane', 'GET', '/contexts/acdp:/a.example/123'],
  ['control-plane', 'GET', '/auth/revocations'],
  ...(['registry-a', 'registry-b'] as const).flatMap(
    (r) =>
      [
        [r, 'GET', '/healthz'],
        [r, 'GET', '/contexts/search'],
        [r, 'GET', '/lineages/l1'],
        [r, 'GET', '/lineages/l1/current'],
        [r, 'GET', '/.well-known/acdp.json'],
        [r, 'GET', '/.well-known/jwks.json'],
        [r, 'GET', '/.well-known/did.json'],
      ] as [ProxyService, 'GET', string][],
  ),
];

function accessOf(service: ProxyService, method: string, path: string) {
  return ALLOWED_ROUTES[service].find((r) => r.method === method && r.pattern.test(path))!.access;
}
const PUBLIC = SAMPLES.filter(([s, m, p]) => accessOf(s, m, p) === 'public');
const ADMIN = SAMPLES.filter(([s, m, p]) => accessOf(s, m, p) === 'admin');

function upstream(status = 200, body: unknown = null, headers = new Headers()): Response {
  return {
    status,
    statusText: '',
    headers,
    body,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === 'string' ? body : '{}'),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init: RequestInit) => Response = () => upstream()) {
  const fn = vi.fn((url: string | URL | Request, init: RequestInit) => Promise.resolve(impl(String(url), init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function req(service: string, method: string, path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/proxy/${service}${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
}

function call(service: ProxyService, method: keyof typeof HANDLERS, path: string, headers: Record<string, string> = {}) {
  const segments = path.slice(1).split('/');
  return HANDLERS[method](req(service, method, path, headers), { params: Promise.resolve({ service, path: segments }) });
}

async function session(): Promise<Record<string, string>> {
  return { cookie: `${SESSION_COOKIE_NAME}=${await createSessionToken(PASSWORD)}` };
}

function publicOn() {
  vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
  vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
  vi.stubEnv('VERCEL', '1');
}

let ipCounter = 0;
/** A fresh client IP per test, so per-IP buckets never leak between tests. */
function ip(): Record<string, string> {
  ipCounter += 1;
  return { 'x-real-ip': `198.18.${ipCounter >> 8}.${ipCounter & 255}` };
}

beforeEach(() => {
  consoleRateLimiter.reset();
  consoleStreamGate.reset();
  resetCredentialFallbackLog();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the sample table', () => {
  it('covers every allow-list entry', () => {
    for (const [service, routes] of Object.entries(ALLOWED_ROUTES) as [ProxyService, typeof ALLOWED_ROUTES.playground][]) {
      for (const r of routes) {
        expect(
          SAMPLES.some(([s, m, p]) => s === service && m === r.method && r.pattern.test(p)),
          `${service} ${r.method} ${String(r.pattern)}`,
        ).toBe(true);
      }
    }
    expect(ADMIN).toHaveLength(9);
  });
});

describe('flag on — access classes (criterion 2)', () => {
  it.each(PUBLIC)('anonymous %s %s %s is forwarded', async (service, method, path) => {
    publicOn();
    const fetchMock = mockFetch();
    const res = await call(service, method, path, ip());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(ADMIN)('anonymous %s %s %s → 403, unstamped, never fetched', async (service, method, path) => {
    publicOn();
    const fetchMock = mockFetch();
    const res = await call(service, method, path, ip());
    expect(res.status).toBe(403);
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
    expect((await res.json()).errorCode).toBe('CONSOLE_OPERATOR_SESSION_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(ADMIN)('signed-in %s %s %s is forwarded with the admin key', async (service, method, path) => {
    publicOn();
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    const fetchMock = mockFetch();
    const res = await call(service, method, path, { ...ip(), ...(await session()) });
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('authorization')).toBe('Bearer admin-key');
  });

  it('an expired or tampered cookie is anonymous: admin 403, public forwarded', async () => {
    publicOn();
    const fetchMock = mockFetch();
    const bad = { ...ip(), cookie: `${SESSION_COOKIE_NAME}=forged.token` };
    expect((await call('control-plane', 'GET', '/metrics', bad)).status).toBe(403);
    expect((await call('control-plane', 'GET', '/runs', bad)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a route not on the allow-list is 403 and never fetched', async () => {
    publicOn();
    const fetchMock = mockFetch();
    const res = await call('control-plane', 'GET', '/internal/dump', ip());
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an encoded admin path variant is still classified admin', async () => {
    publicOn();
    const fetchMock = mockFetch();
    // `%6Detrics` decodes to `metrics` before classification.
    const res = await GET(new NextRequest('http://localhost/api/proxy/control-plane/%6Detrics', { headers: ip() }), {
      params: Promise.resolve({ service: 'control-plane', path: ['metrics'] }),
    });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('flag on — rate limits (criterion 4)', () => {
  it('the 301st read from one IP → 429 + Retry-After, unstamped, no fetch; another IP unaffected', async () => {
    publicOn();
    const fetchMock = mockFetch();
    const me = ip();
    for (let i = 0; i < 300; i++) expect((await call('playground', 'GET', '/scenarios', me)).status).toBe(200);
    const res = await call('playground', 'GET', '/scenarios', me);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
    const body = await res.json();
    expect(body.errorCode).toBe('CONSOLE_RATE_LIMITED');
    expect(body.retryAfterSeconds).toBe(Number(res.headers.get('retry-after')));
    expect(fetchMock).toHaveBeenCalledTimes(300);
    expect((await call('playground', 'GET', '/scenarios', ip())).status).toBe(200);
  });

  it('the 6th POST /runs → 429 while reads still pass', async () => {
    publicOn();
    mockFetch();
    const me = ip();
    for (let i = 0; i < 5; i++) expect((await call('playground', 'POST', '/runs', me)).status).toBe(200);
    expect((await call('playground', 'POST', '/runs', me)).status).toBe(429);
    expect((await call('playground', 'GET', '/scenarios', me)).status).toBe(200);
  });

  it('a spoofed leftmost x-forwarded-for gets no fresh quota', async () => {
    publicOn();
    mockFetch();
    for (let i = 0; i < 5; i++) {
      const xff = { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.77` };
      expect((await call('playground', 'POST', '/runs', xff)).status).toBe(200);
    }
    expect((await call('playground', 'POST', '/runs', { 'x-forwarded-for': '10.9.9.200, 203.0.113.77' })).status).toBe(429);
  });

  it('refused (403) requests consume no quota', async () => {
    publicOn();
    mockFetch();
    const me = ip();
    for (let i = 0; i < 20; i++) expect((await call('control-plane', 'GET', '/metrics', me)).status).toBe(403);
    for (let i = 0; i < 30; i++) expect((await call('control-plane', 'GET', '/runs', me)).status).toBe(200);
  });

  it('anonymous control-plane reads also draw the per-IP cp-read budget (30/min)', async () => {
    publicOn();
    mockFetch();
    const me = ip();
    for (let i = 0; i < 30; i++) expect((await call('control-plane', 'GET', '/runs', me)).status).toBe(200);
    expect((await call('control-plane', 'GET', '/runs', me)).status).toBe(429);
    expect((await call('playground', 'GET', '/scenarios', me)).status).toBe(200);
  });

  it('the operator is rate-limited too, but not by the anonymous cp-read budget', async () => {
    publicOn();
    mockFetch();
    const op = { ...ip(), ...(await session()) };
    for (let i = 0; i < 40; i++) expect((await call('control-plane', 'GET', '/runs', op)).status).toBe(200);
    for (let i = 0; i < 5; i++) await call('playground', 'POST', '/runs', op);
    expect((await call('playground', 'POST', '/runs', op)).status).toBe(429);
  });

  it('a playground 429 is relayed stamped, distinct from the console 429', async () => {
    publicOn();
    mockFetch(() => upstream(429, '{"detail":{"code":"run_rate_limited"}}'));
    const res = await call('playground', 'POST', '/runs', ip());
    expect(res.status).toBe(429);
    expect(res.headers.get('x-acdp-ui-proxy')).toBe('playground');
  });
});

describe('route-level session (criterion 7, middleware bypassed)', () => {
  it('anonymous admin request: 403 with the flag on, 401 with it off', async () => {
    mockFetch();
    publicOn();
    expect((await call('control-plane', 'GET', '/metrics', ip())).status).toBe(403);
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'off');
    expect((await call('control-plane', 'GET', '/metrics', ip())).status).toBe(401);
  });

  it('flag off, no session: public proxy route and both streams → 401, no fetch', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const fetchMock = mockFetch();
    expect((await call('control-plane', 'GET', '/runs')).status).toBe(401);
    expect((await eventsGET(new NextRequest('http://localhost/api/stream/events'))).status).toBe(401);
    expect(
      (await runStreamGET(new NextRequest('http://localhost/api/stream/runs/r1'), { params: Promise.resolve({ runId: 'r1' }) })).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flag off, signed in: forwarded with no rate limit', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    mockFetch();
    const op = await session();
    for (let i = 0; i < 8; i++) expect((await call('playground', 'POST', '/runs', op)).status).toBe(200);
  });

  it('password unset outside production: fail-open in both modes', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const fetchMock = mockFetch();
    expect((await call('control-plane', 'GET', '/metrics')).status).toBe(200);
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
    expect((await call('control-plane', 'GET', '/metrics')).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('password unset in production: flag off → 503 everywhere; flag on → public works, admin 503', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://pg');
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://cp');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    vi.stubEnv('VERCEL', '1');
    const fetchMock = mockFetch();
    expect((await call('playground', 'GET', '/scenarios', ip())).status).toBe(503);
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
    expect((await call('playground', 'GET', '/scenarios', ip())).status).toBe(200);
    const admin = await call('control-plane', 'GET', '/metrics', ip());
    expect(admin.status).toBe(503);
    expect((await admin.json()).errorCode).toBe('CONSOLE_AUTH_NOT_CONFIGURED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('control-plane credential (criterion 8, leader-amended fallback)', () => {
  const auth = (fetchMock: ReturnType<typeof mockFetch>, n = 0) =>
    (fetchMock.mock.calls[n][1].headers as Headers).get('authorization');

  it('anonymous requests carry the read key; signed-in ones the admin key', async () => {
    publicOn();
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    const fetchMock = mockFetch();
    await call('control-plane', 'GET', '/runs', ip());
    await call('control-plane', 'GET', '/runs', { ...ip(), ...(await session()) });
    expect(auth(fetchMock, 0)).toBe('Bearer read-key');
    expect(auth(fetchMock, 1)).toBe('Bearer admin-key');
  });

  it('read key unset → admin key, fallback logged once', async () => {
    publicOn();
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', '');
    const fetchMock = mockFetch();
    await call('control-plane', 'GET', '/runs', ip());
    await call('control-plane', 'GET', '/agents', ip());
    expect(auth(fetchMock, 0)).toBe('Bearer admin-key');
    const warns = vi.mocked(console.warn).mock.calls.filter(([m]) => String(m).includes('CONTROL_PLANE_READ_API_KEY is not set'));
    expect(warns).toHaveLength(1);
  });

  it('a 401 to the read key is retried once with the admin key and logged', async () => {
    publicOn();
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    const fetchMock = mockFetch((_u, init) =>
      (init.headers as Headers).get('authorization') === 'Bearer read-key' ? upstream(401) : upstream(200),
    );
    const res = await call('control-plane', 'GET', '/runs', ip());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth(fetchMock, 1)).toBe('Bearer admin-key');
    expect(vi.mocked(console.warn).mock.calls.some(([m]) => String(m).includes('rejected CONTROL_PLANE_READ_API_KEY'))).toBe(true);
  });

  it('the CP events stream uses the read key for anonymous visitors, with the same fallback', async () => {
    publicOn();
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    const sse = () =>
      upstream(200, new ReadableStream({ start: (c) => c.close() }), new Headers({ 'content-type': 'text/event-stream' }));
    const fetchMock = mockFetch((_u, init) =>
      (init.headers as Record<string, string>).authorization === 'Bearer read-key' ? upstream(401) : sse(),
    );
    const res = await eventsGET(new NextRequest('http://localhost/api/stream/events', { headers: ip() }));
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer read-key');
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).authorization).toBe('Bearer admin-key');
  });
});

describe('streams in public mode (criteria 4, 9)', () => {
  const sse = () =>
    upstream(
      200,
      new ReadableStream({ start: () => {} }), // never ends: holds the slot
      new Headers({ 'content-type': 'text/event-stream' }),
    );
  const openRun = (headers: Record<string, string>) =>
    runStreamGET(new NextRequest('http://localhost/api/stream/runs/r1', { headers }), { params: Promise.resolve({ runId: 'r1' }) });

  it('anonymous streams are relayed; the 5th concurrent stream from one IP → 429', async () => {
    publicOn();
    const fetchMock = mockFetch(sse);
    const me = ip();
    const open: Response[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await openRun(me);
      expect(res.status).toBe(200);
      open.push(res);
    }
    const fifth = await eventsGET(new NextRequest('http://localhost/api/stream/events', { headers: me }));
    expect(fifth.status).toBe(429);
    expect(fifth.headers.get('retry-after')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Closing one frees its slot.
    await open[0].body!.cancel();
    expect((await openRun(me)).status).toBe(200);
  });

  it('a slot is released when the upstream stream ends', async () => {
    publicOn();
    mockFetch(() =>
      upstream(200, new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode('data: x\n\n')); c.close(); } }), new Headers({ 'content-type': 'text/event-stream' })),
    );
    const me = ip();
    for (let i = 0; i < 6; i++) {
      const res = await openRun(me);
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(consoleStreamGate.size).toBe(0);
  });

  it('a relay refusal (non-200) releases its slot without being drained', async () => {
    publicOn();
    mockFetch(() => upstream(502));
    const me = ip();
    for (let i = 0; i < 6; i++) expect((await openRun(me)).status).toBe(502);
    expect(consoleStreamGate.size).toBe(0);
  });

  it('a slot is released when the upstream fetch throws', async () => {
    publicOn();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const me = ip();
    for (let i = 0; i < 6; i++) expect((await openRun(me)).status).toBe(502);
    expect(consoleStreamGate.size).toBe(0);
  });

  it('each stream open takes a read token', async () => {
    publicOn();
    mockFetch(() => upstream(502));
    const me = ip();
    for (let i = 0; i < 300; i++) await openRun(me);
    expect((await call('playground', 'GET', '/scenarios', me)).status).toBe(429);
  });
});

describe('anonymous GET /registries strips baseUrl (criterion 11)', () => {
  const list = JSON.stringify({ data: [{ authority: 'a.example', baseUrl: 'http://registry-a.internal:8100', seen: 3 }] });
  const textUpstream = (status: number, text: string) =>
    ({ status, statusText: '', ok: status < 300, headers: new Headers({ 'content-type': 'application/json' }), body: text, text: () => Promise.resolve(text) }) as unknown as Response;

  it('anonymous: no baseUrl, other fields kept', async () => {
    publicOn();
    mockFetch(() => textUpstream(200, list));
    const res = await call('control-plane', 'GET', '/registries', ip());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ authority: 'a.example', seen: 3 }] });
  });

  it('signed in: byte-for-byte', async () => {
    publicOn();
    mockFetch(() => textUpstream(200, list));
    const res = await call('control-plane', 'GET', '/registries', { ...ip(), ...(await session()) });
    expect(await res.text()).toBe(list);
  });

  it('non-2xx: byte-for-byte, stamped', async () => {
    publicOn();
    const raw = '{"errorCode":"X","baseUrl":"kept"}';
    mockFetch(() => textUpstream(500, raw));
    const res = await call('control-plane', 'GET', '/registries', ip());
    expect(res.status).toBe(500);
    expect(res.headers.get('x-acdp-ui-proxy')).toBe('control-plane');
    expect(await res.text()).toBe(raw);
  });

  it('an unparseable 2xx is not relayed to an anonymous caller', async () => {
    publicOn();
    mockFetch(() => textUpstream(200, 'http://registry-a.internal'));
    const res = await call('control-plane', 'GET', '/registries', ip());
    expect(res.status).toBe(502);
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });
});

describe('middleware with the flag on', () => {
  it('passes an anonymous request through to the route', async () => {
    publicOn();
    const res = await middleware(req('control-plane', 'GET', '/runs'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('still refuses a cross-origin mutation', async () => {
    publicOn();
    const res = await middleware(
      new NextRequest('http://localhost/api/proxy/playground/runs', { method: 'POST', headers: { host: 'localhost', origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(403);
  });

  it('flag off still answers 401 for an anonymous public route (criterion 1)', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const res = await middleware(req('control-plane', 'GET', '/runs'));
    expect(res.status).toBe(401);
  });

  it('production, flag on, no password: passes through (the route decides)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const res = await middleware(req('control-plane', 'GET', '/runs'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('production, flag on, no password: still refuses a cross-origin mutation', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const res = await middleware(
      new NextRequest('http://localhost/api/proxy/playground/runs', { method: 'POST', headers: { host: 'localhost', origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(403);
    const same = await middleware(
      new NextRequest('http://localhost/api/proxy/playground/runs', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' } }),
    );
    expect(same.headers.get('x-middleware-next')).toBe('1');
  });

  it('production, flag off, no password: 503 as before', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    expect((await middleware(req('control-plane', 'GET', '/runs'))).status).toBe(503);
  });

  it('a garbage flag value is off: anonymous → 401', async () => {
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'yes');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    expect((await middleware(req('control-plane', 'GET', '/runs'))).status).toBe(401);
  });
});

describe('GET /api/auth/session (criterion 6)', () => {
  it('returns exactly {publicMode, signedIn}', async () => {
    publicOn();
    const anon = await sessionGET(new NextRequest('http://localhost/api/auth/session'));
    expect(await anon.json()).toEqual({ publicMode: true, signedIn: false });
    expect(anon.headers.get('cache-control')).toBe('no-store');
    const op = await sessionGET(new NextRequest('http://localhost/api/auth/session', { headers: await session() }));
    expect(await op.json()).toEqual({ publicMode: true, signedIn: true });
  });

  it('flag off and no password: both false', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const res = await sessionGET(new NextRequest('http://localhost/api/auth/session'));
    expect(await res.json()).toEqual({ publicMode: false, signedIn: false });
  });
});

describe('login limiter (criteria 9, 10)', () => {
  const attempt = (headers: Record<string, string>) =>
    loginPOST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ passphrase: 'wrong' }),
      }),
    );

  it('the 11th attempt in 10 min from one IP → 429 with Retry-After', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    vi.stubEnv('VERCEL', '1');
    const me = ip();
    for (let i = 0; i < 10; i++) expect((await attempt(me)).status).toBe(401);
    const res = await attempt(me);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect((await attempt(ip())).status).toBe(401);
  });

  it('never refuses when the client IP is unknown', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('ACDP_UI_CLIENT_IP_HEADER', '');
    for (let i = 0; i < 15; i++) expect((await attempt({ 'x-real-ip': '1.2.3.4' })).status).toBe(401);
  });
});
