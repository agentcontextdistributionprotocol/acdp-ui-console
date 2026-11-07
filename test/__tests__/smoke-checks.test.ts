// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import {
  GATE_PROBES,
  PAGE_ROUTES,
  checkGate,
  classifyGateResponse,
  runSmoke,
} from '@/scripts/smoke-checks.mjs';

const BASE = 'https://console.example.test';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Ask the REAL middleware.ts what an anonymous GET of `path` gets, so the
 * smoke check's contract can't drift from the gate it is probing. */
async function realGateAnswer(path: string): Promise<Response> {
  const res = await middleware(new NextRequest(BASE + path, { method: 'GET' }));
  return res as Response;
}

function fetchFrom(answer: (url: string) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL) => Promise.resolve(answer(String(input)))) as unknown as typeof fetch;
}

describe('classifyGateResponse', () => {
  it('passes only the gate\'s own 401 JSON body', () => {
    expect(classifyGateResponse(401, JSON.stringify({ error: 'Unauthorized: sign in at /login required.' })).ok).toBe(true);
    expect(classifyGateResponse(401, 'Unauthorized').ok).toBe(false);
    expect(classifyGateResponse(401, JSON.stringify({ error: 'nope' })).ok).toBe(false);
  });

  it('fails a 503 and names the reason', () => {
    const r = classifyGateResponse(503, JSON.stringify({ error: 'ACDP_UI_CONSOLE_PASSWORD is not configured on this deployment.' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unconfigured.*ACDP_UI_CONSOLE_PASSWORD/);
  });

  it('fails a 2xx (gate open), a 3xx and any other 5xx', () => {
    for (const s of [200, 204, 302, 403, 500, 502]) {
      expect(classifyGateResponse(s, '{}').ok, String(s)).toBe(false);
    }
  });
});

describe('gate probes against the real middleware', () => {
  it('pass when ACDP_UI_CONSOLE_PASSWORD is set in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', 'correct-horse-battery-staple');
    for (const path of GATE_PROBES) {
      const r = await checkGate(BASE, path, fetchFrom((url) => realGateAnswer(url.slice(BASE.length))));
      expect(r, path).toEqual({ ok: true, reason: 'gate configured (401 Unauthorized)' });
    }
  });

  it('fail when ACDP_UI_CONSOLE_PASSWORD is missing in production (the incident)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    for (const path of GATE_PROBES) {
      const r = await checkGate(BASE, path, fetchFrom((url) => realGateAnswer(url.slice(BASE.length))));
      expect(r.ok, path).toBe(false);
      expect(r.reason).toMatch(/^503/);
    }
  });

  it('every probe path is actually covered by the middleware matcher', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', 'x');
    const { config } = await import('@/middleware');
    for (const path of GATE_PROBES) {
      const prefix = path.split('/').slice(0, 3).join('/');
      expect(config.matcher, path).toContain(`${prefix}/:path*`);
    }
  });
});

describe('checkGate transport handling', () => {
  it('does not read an open SSE body and fails on its status', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const res = {
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { cancel },
      text: () => new Promise<string>(() => {}), // would hang forever
    } as unknown as Response;
    const r = await checkGate(BASE, '/api/stream/events', fetchFrom(() => res));
    expect(cancel).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OPEN/);
  });

  it('does not follow redirects and fails on a network error', async () => {
    const f = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    const r = await checkGate(BASE, '/api/proxy/control-plane/healthz', f);
    expect(r).toEqual({ ok: false, reason: 'ECONNREFUSED' });
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });
});

describe('runSmoke', () => {
  function deployment(gateStatus: number, gateBody: object) {
    return fetchFrom((url) => {
      const path = url.slice(BASE.length);
      if (GATE_PROBES.includes(path)) return new Response(JSON.stringify(gateBody), { status: gateStatus });
      return new Response('<html></html>', { status: 200 });
    });
  }
  const quiet = { log: () => {}, error: () => {} };

  it('is red on the incident deployment: every page 200, every gate probe 503', async () => {
    const failures = await runSmoke(BASE, {
      fetchImpl: deployment(503, { error: 'ACDP_UI_CONSOLE_PASSWORD is not configured on this deployment.' }),
      ...quiet,
    });
    expect(failures).toBe(GATE_PROBES.length);
  });

  it('is green on a correctly configured deployment', async () => {
    const failures = await runSmoke(BASE, {
      fetchImpl: deployment(401, { error: 'Unauthorized: sign in at /login required.' }),
      ...quiet,
    });
    expect(failures).toBe(0);
  });

  it('still fails on a non-200 page', async () => {
    const f = fetchFrom((url) => {
      const path = url.slice(BASE.length);
      if (GATE_PROBES.includes(path)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      return new Response('', { status: path === '/trust' ? 500 : 200 });
    });
    expect(await runSmoke(BASE, { fetchImpl: f, ...quiet })).toBe(1);
    expect(PAGE_ROUTES).toContain('/trust');
  });
});

// ── Public mode (2f) ──────────────────────────────────────────────────
import {
  PUBLIC_ADMIN_PROBES,
  PUBLIC_DENY_PROBES,
  PUBLIC_OPEN_PROBES,
  PUBLIC_TRAVERSAL_PROBE,
  checkDirectBackend,
  classifyTraversal,
  classifyAdminDenied,
  classifyDenied,
  classifyPublicOpen,
  detectMode,
  probe,
  probesFor,
} from '@/scripts/smoke-checks.mjs';
import { GET as proxyGET } from '@/app/api/proxy/[service]/[...path]/route';
import { consoleRateLimiter } from '@/lib/server/rate-limit';

describe('public-mode classifiers', () => {
  it('open: 2xx only', () => {
    expect(classifyPublicOpen(200).ok).toBe(true);
    for (const s of [401, 403, 429, 502]) expect(classifyPublicOpen(s).ok, String(s)).toBe(false);
  });

  it("admin: only the console's own 403 code passes", () => {
    expect(classifyAdminDenied(403, '{"errorCode":"CONSOLE_OPERATOR_SESSION_REQUIRED"}').ok).toBe(true);
    expect(classifyAdminDenied(403, '{"errorCode":"ADMIN_REQUIRED"}').ok).toBe(false);
    expect(classifyAdminDenied(403, 'Forbidden').ok).toBe(false);
    const open = classifyAdminDenied(200, '{}');
    expect(open.ok).toBe(false);
    expect(open.reason).toMatch(/OPEN/);
  });

  it("traversal: only the guard's own 403 passes", () => {
    expect(classifyTraversal(403, '{"error":"Forbidden: path traversal"}').ok).toBe(true);
    expect(classifyTraversal(403, '{"errorCode":"CONSOLE_OPERATOR_SESSION_REQUIRED"}').ok).toBe(false);
    expect(classifyTraversal(200, '{}').reason).toMatch(/forwarded/);
  });

  it('the traversal probe survives URL normalisation, so it reaches the guard', () => {
    expect(new URL(BASE + PUBLIC_TRAVERSAL_PROBE).pathname).toBe(PUBLIC_TRAVERSAL_PROBE);
  });

  it('deny: 400/403/404 pass, 2xx fails', () => {
    for (const s of [400, 403, 404]) expect(classifyDenied(s).ok, String(s)).toBe(true);
    for (const s of [200, 500, 502]) expect(classifyDenied(s).ok, String(s)).toBe(false);
  });
});

describe('detectMode', () => {
  const json = (body: unknown, status = 200) => fetchFrom(() => new Response(JSON.stringify(body), { status }));
  it('reads publicMode from /api/auth/session', async () => {
    expect(await detectMode(BASE, json({ publicMode: true, signedIn: false }))).toMatchObject({ publicMode: true, ok: true });
    expect(await detectMode(BASE, json({ publicMode: false, signedIn: false }))).toMatchObject({ publicMode: false, ok: true });
  });
  it('an unreadable endpoint is assumed off, unless an expectation says otherwise', async () => {
    const html = fetchFrom(() => new Response('<html>', { status: 200 }));
    expect(await detectMode(BASE, html)).toMatchObject({ publicMode: false, ok: true });
    expect(await detectMode(BASE, fetchFrom(() => new Response('', { status: 404 })), 'on')).toMatchObject({ publicMode: true, ok: true });
  });
  it('a mismatch with SMOKE_EXPECT_PUBLIC_MODE fails', async () => {
    const r = await detectMode(BASE, json({ publicMode: false, signedIn: false }), 'on');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expected public mode on/);
  });
});

describe('public probes against the real proxy route', () => {
  /** Dispatch an anonymous GET exactly as Next would: middleware, then the route. */
  async function realAnswer(url: string): Promise<Response> {
    const path = url.slice(BASE.length);
    const req = new NextRequest(BASE + path, { headers: { 'x-real-ip': '198.18.7.7' } });
    const gate = await middleware(req);
    if (gate.headers.get('x-middleware-next') !== '1') return gate as Response;
    // Next splits on literal '/' first, then percent-decodes each segment.
    const [, , , service, ...rest] = new URL(BASE + path).pathname.split('/').map(decodeURIComponent);
    return proxyGET(req, { params: Promise.resolve({ service, path: rest }) });
  }

  it('every public probe passes on a public-mode production deployment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ACDP_UI_PUBLIC_MODE', 'on');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', 'correct-horse-battery-staple');
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://pg.internal');
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://cp.internal');
    consoleRateLimiter.reset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Upstreams answer 200 to anything forwarded.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 200, statusText: 'OK', headers: new Headers(), body: null } as unknown as Response)),
    );
    const f = fetchFrom((url) => realAnswer(url));
    // /api/stream/events is a different route; its open answer is covered in
    // public-mode-access.test.ts.
    for (const { path, classify } of probesFor(true).filter((p) => !p.path.startsWith('/api/stream/'))) {
      const r = await probe(BASE, path, classify, f);
      expect(r.ok, `${path}: ${r.reason}`).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  it('the public set is the probe lists plus the traversal probe, and off mode keeps the gate probes', () => {
    expect(probesFor(true).map((p) => p.path)).toEqual([
      ...PUBLIC_OPEN_PROBES,
      ...PUBLIC_ADMIN_PROBES,
      ...PUBLIC_DENY_PROBES,
      PUBLIC_TRAVERSAL_PROBE,
    ]);
    expect(probesFor(false).map((p) => p.path)).toEqual(GATE_PROBES);
  });
});

describe('runSmoke in public mode', () => {
  const quiet = { log: () => {}, error: () => {} };
  function publicDeployment(override: Record<string, Response> = {}) {
    return fetchFrom((url) => {
      const path = url.slice(BASE.length);
      if (override[path]) return override[path];
      if (path === '/api/auth/session') return new Response('{"publicMode":true,"signedIn":false}');
      if (PUBLIC_ADMIN_PROBES.includes(path)) return new Response('{"errorCode":"CONSOLE_OPERATOR_SESSION_REQUIRED"}', { status: 403 });
      if (PUBLIC_DENY_PROBES.includes(path)) return new Response('{}', { status: 403 });
      if (path === PUBLIC_TRAVERSAL_PROBE) return new Response('{"error":"Forbidden: path traversal"}', { status: 403 });
      return new Response('{}', { status: 200 });
    });
  }

  it('is green on a correct public deployment', async () => {
    expect(await runSmoke(BASE, { fetchImpl: publicDeployment(), ...quiet })).toBe(0);
  });

  it('is red when an admin route is open', async () => {
    const f = publicDeployment({ '/api/proxy/control-plane/metrics': new Response('# metrics', { status: 200 }) });
    expect(await runSmoke(BASE, { fetchImpl: f, ...quiet })).toBe(1);
  });

  it('is red when a public read fails', async () => {
    const f = publicDeployment({ '/api/proxy/playground/scenarios': new Response('{}', { status: 502 }) });
    expect(await runSmoke(BASE, { fetchImpl: f, ...quiet })).toBe(1);
  });

  it('is red when the expected mode differs', async () => {
    expect(await runSmoke(BASE, { fetchImpl: publicDeployment(), expectPublicMode: 'off', ...quiet })).toBeGreaterThan(0);
  });

  it('direct backends must refuse a keyless request', async () => {
    expect((await checkDirectBackend('https://pg.example/', fetchFrom(() => new Response('', { status: 401 })))).ok).toBe(true);
    expect((await checkDirectBackend('https://pg.example', fetchFrom(() => new Response('[]', { status: 200 })))).ok).toBe(false);
    const f = fetchFrom((url) =>
      url.startsWith('https://pg.example') ? new Response('[]', { status: 200 }) : publicDeployment()(url as unknown as RequestInfo),
    );
    expect(await runSmoke(BASE, { fetchImpl: f, directBackendUrls: ['https://pg.example'], ...quiet })).toBe(1);
  });
});
