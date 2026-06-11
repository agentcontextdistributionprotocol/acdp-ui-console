import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, proxyUrl, fetchJson, fetchText } from '@/lib/api/fetcher';

function response(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = 200 } = init;
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: () => Response) {
  const fn = vi.fn((_url: string | URL | Request, _init?: RequestInit) => Promise.resolve(impl()));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('proxyUrl', () => {
  it('normalizes a path missing its leading slash', () => {
    expect(proxyUrl('registry-a', 'contexts/search')).toBe('/api/proxy/registry-a/contexts/search');
  });

  it('keeps a path that already has a leading slash', () => {
    expect(proxyUrl('control-plane', '/runs')).toBe('/api/proxy/control-plane/runs');
  });
});

describe('ApiError', () => {
  it('flags 404 via isNotFound and carries service + path', () => {
    const err = new ApiError(404, 'nope', 'registry-b', '/contexts/x');
    expect(err.isNotFound).toBe(true);
    expect(err.status).toBe(404);
    expect(err.service).toBe('registry-b');
    expect(err.path).toBe('/contexts/x');
    expect(err.name).toBe('ApiError');
  });

  it('falls back to a synthesized message when the body is empty', () => {
    expect(new ApiError(500, '', 'playground', '/runs').message).toBe('Request failed with status 500');
  });

  it('isNotFound is false for non-404 statuses', () => {
    expect(new ApiError(403, 'forbidden', 'control-plane', '/x').isNotFound).toBe(false);
  });
});

describe('fetchJson', () => {
  it('hits the proxy url and parses the JSON body', async () => {
    const fetchMock = mockFetch(() => response({ run_id: 'r1' }));
    const out = await fetchJson<{ run_id: string }>('playground', '/runs');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/playground/runs');
    expect(out.run_id).toBe('r1');
  });

  it('sends a default content-type but lets callers override it', async () => {
    const fetchMock = mockFetch(() => response({}));
    await fetchJson('control-plane', '/x');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'content-type': 'application/json' });
    await fetchJson('control-plane', '/x', { headers: { 'content-type': 'text/plain' } });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'content-type': 'text/plain' });
  });

  it('returns undefined for a 204 with no body', async () => {
    mockFetch(() => response('', { status: 204 }));
    await expect(fetchJson('control-plane', '/webhooks/wh-1')).resolves.toBeUndefined();
  });

  it('throws an ApiError carrying the upstream status + body on failure', async () => {
    mockFetch(() => response('boom', { ok: false, status: 502 }));
    await expect(fetchJson('registry-a', '/contexts/search')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: 'boom',
      service: 'registry-a',
    });
  });
});

describe('fetchText', () => {
  it('returns the raw text body', async () => {
    mockFetch(() => response('# HELP foo\nfoo 1'));
    await expect(fetchText('control-plane', '/metrics')).resolves.toBe('# HELP foo\nfoo 1');
  });

  it('throws an ApiError on a non-ok response', async () => {
    mockFetch(() => response('down', { ok: false, status: 503 }));
    await expect(fetchText('control-plane', '/metrics')).rejects.toMatchObject({ status: 503 });
  });
});
