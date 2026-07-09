// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/proxy/[service]/[...path]/route';

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

  it('hits the base url root when no path segments are given', async () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
    const fetchMock = mockFetch(() => upstream());
    await GET(new NextRequest('http://localhost/api/proxy/playground'), ctx('playground', undefined));
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/');
  });
});

describe('proxy route — request header hygiene', () => {
  it('forwards allow-listed headers but strips cookies and client authorization', async () => {
    const fetchMock = mockFetch(() => upstream());
    const req = new NextRequest('http://localhost/api/proxy/registry-a/contexts', {
      headers: {
        cookie: 'session=abc',
        authorization: 'Bearer client-token',
        'x-tenant-id': 'tenant-7',
        'content-type': 'application/json',
      },
    });
    await GET(req, ctx('registry-a', ['contexts']));
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
    const req = new NextRequest('http://localhost/api/proxy/registry-b/contexts', {
      headers: { authorization: 'Bearer client-token' },
    });
    await GET(req, ctx('registry-b', ['contexts']));
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
      new NextRequest('http://localhost/api/proxy/registry-a/contexts'),
      ctx('registry-a', ['contexts']),
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
  });
});
