import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, proxyUrl, fetchJson, fetchText, confirmSessionOrRedirect } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

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

beforeEach(() => {
  // These tests exercise real-mode behavior; confirmSessionOrRedirect has a
  // demo-mode guard, so it needs demoMode explicitly false unless a test
  // says otherwise (see 'does nothing in demo mode' below).
  usePreferencesStore.setState({ demoMode: false });
});

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

  describe('errorCode (federation-proxy verifyCtxIdBinding error envelope)', () => {
    it('parses the top-level errorCode from a structured control-plane error body', () => {
      const body = JSON.stringify({
        statusCode: 502,
        errorCode: 'CONTEXT_ID_MISMATCH',
        message: 'served body does not match requested ctx_id',
        error: { code: 'CONTEXT_ID_MISMATCH', message: 'served body does not match requested ctx_id' },
      });
      const err = new ApiError(502, body, 'control-plane', '/contexts/x');
      expect(err.errorCode).toBe('CONTEXT_ID_MISMATCH');
    });

    it('falls back to the nested error.code when errorCode is absent', () => {
      const body = JSON.stringify({ error: { code: 'CONTEXT_BINDING_UNVERIFIABLE', message: '…' } });
      const err = new ApiError(502, body, 'control-plane', '/contexts/x');
      expect(err.errorCode).toBe('CONTEXT_BINDING_UNVERIFIABLE');
    });

    it('stays undefined for a plain-text body', () => {
      expect(new ApiError(503, 'service unavailable', 'playground', '/runs').errorCode).toBeUndefined();
    });

    it('stays undefined for a malformed-JSON body rather than throwing', () => {
      expect(() => new ApiError(502, '{not json', 'control-plane', '/contexts/x')).not.toThrow();
      expect(new ApiError(502, '{not json', 'control-plane', '/contexts/x').errorCode).toBeUndefined();
    });

    it('stays undefined for an empty body', () => {
      expect(new ApiError(500, '', 'registry-a', '/x').errorCode).toBeUndefined();
    });

    it('stays undefined for valid JSON that carries neither field', () => {
      expect(new ApiError(500, JSON.stringify({ message: 'boom' }), 'registry-a', '/x').errorCode).toBeUndefined();
    });

    it('the REGISTRY wire envelope populates it too — this field is not control-plane-only', () => {
      // `error.code` was added as a fallback for the control plane's own nested
      // copy, but it matches the registry's RFC-ACDP-0007 §5 envelope exactly
      // (`acdp-registry-types/src/error.rs:83-92`), so a direct registry call
      // fills `errorCode` with a lowercase snake_case code from an entirely
      // different vocabulary. Anything keyed by this value has to know that —
      // which is why `lib/utils/api-error-messages.ts` looks the code up
      // exactly, without case-folding, and why the field's own docblock says so.
      const body = JSON.stringify({ error: { code: 'schema_violation', message: 'body failed schema validation' } });
      expect(new ApiError(400, body, 'registry-a', '/contexts').errorCode).toBe('schema_violation');
      const limited = JSON.stringify({ error: { code: 'rate_limited', message: 'rate limited; retry after 30s' } });
      expect(new ApiError(429, limited, 'registry-b', '/contexts/search').errorCode).toBe('rate_limited');
    });
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

describe('401 → redirect to /login', () => {
  // jsdom's real `window.location.assign` is non-configurable (can't be
  // `vi.spyOn`'d directly), so stub the whole global instead — restored by
  // the top-level `vi.unstubAllGlobals()` in `afterEach`.
  function stubLocation(pathname = '/dashboard') {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname, assign });
    return assign;
  }

  it('fetchJson redirects the browser to /login on a 401 (the auth gate)', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401 }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('fetchText redirects the browser to /login on a 401 (the auth gate)', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401 }));
    await expect(fetchText('control-plane', '/metrics')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect on other error statuses', async () => {
    const assign = stubLocation();
    mockFetch(() => response('boom', { ok: false, status: 502 }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 502 });
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not redirect again when already on /login', async () => {
    const assign = stubLocation('/login');
    mockFetch(() => response('unauthorized', { ok: false, status: 401 }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });

  describe('confirmSessionOrRedirect', () => {
    it('redirects to /login when the confirm request comes back 401', async () => {
      const assign = stubLocation();
      const fetchMock = mockFetch(() => response('unauthorized', { ok: false, status: 401 }));
      await confirmSessionOrRedirect();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/control-plane/healthz');
      expect(assign).toHaveBeenCalledWith('/login');
    });

    it('does not redirect and does not throw on a non-401 failure (e.g. a network blip)', async () => {
      const assign = stubLocation();
      mockFetch(() => response('boom', { ok: false, status: 502 }));
      await expect(confirmSessionOrRedirect()).resolves.toBeUndefined();
      expect(assign).not.toHaveBeenCalled();
    });

    it('resolves quietly on success (the happy path)', async () => {
      const assign = stubLocation();
      mockFetch(() => response({ ok: true }));
      await expect(confirmSessionOrRedirect()).resolves.toBeUndefined();
      expect(assign).not.toHaveBeenCalled();
    });

    it('does nothing in demo mode — no request, no redirect', async () => {
      usePreferencesStore.setState({ demoMode: true });
      const assign = stubLocation();
      const fetchMock = mockFetch(() => response({ ok: true }));
      await expect(confirmSessionOrRedirect()).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
