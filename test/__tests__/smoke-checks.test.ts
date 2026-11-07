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
