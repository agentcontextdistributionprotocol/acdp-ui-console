import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegistryCapabilities,
  listWebhooks,
  createWebhook,
  getCpMetrics,
  searchContexts,
  getCpDashboard,
  startRun,
  listRevocations,
  getRegistryJwks,
  listEnrollments,
  enrollRegistry,
  getLineage,
} from '@/lib/api/client';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => Promise.resolve(impl(String(url), init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Path-drift guard: these assertions pin the exact proxy paths the UI calls so a
 * future change that diverges from the verified backend routes fails loudly.
 */
describe('real-mode proxy paths', () => {
  it('registry capabilities → /.well-known/acdp.json', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ acdp_version: '0.1.0' }));
    await getRegistryCapabilities('a', false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/registry-a/.well-known/acdp.json');
  });

  it('dashboard overview → /dashboard/overview with window', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ window: '24h' }));
    await getCpDashboard('24h', false);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/proxy/control-plane/dashboard/overview?window=24h');
  });

  it('startRun → POST /runs on playground', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ run_id: 'r1' }));
    await startRun('s1_single_publish', { topic: 'x' }, 'single', false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/playground/runs');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('listRevocations → /auth/revocations with since + limit', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ entries: [], next_cursor: null }));
    await listRevocations({ since: 123, limit: 25 }, false);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/proxy/control-plane/auth/revocations?');
    expect(url).toContain('since=123');
    expect(url).toContain('limit=25');
  });

  it('getRegistryJwks → /.well-known/jwks.json on the registry', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ keys: [] }));
    await getRegistryJwks('b', false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/registry-b/.well-known/jwks.json');
  });

  it('listEnrollments → reads { data } from /registries/enrollments', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [{ authority: 'r-a', tenantId: 'default', enabled: true, createdAt: '' }], total: 1 }));
    const rows = await listEnrollments(false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/control-plane/registries/enrollments');
    expect(rows[0].authority).toBe('r-a');
  });

  it('enrollRegistry → POST /registries/enroll', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ authority: 'r-a', tenantId: 'default', enabled: true, createdAt: '' }));
    await enrollRegistry({ authority: 'r-a', enabled: true }, false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/control-plane/registries/enroll');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('getLineage → /lineages/{id} on the registry', async () => {
    const fetchMock = mockFetch(() => jsonResponse([]));
    await getLineage('lin-cashflow-001', 'a', false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/registry-a/lineages/lin-cashflow-001');
  });
});

describe('listWebhooks', () => {
  it('reads the bare array (no { data } envelope)', async () => {
    mockFetch(() => jsonResponse([{ id: 'wh-1', url: 'https://x', events: [], active: true, createdAt: '', updatedAt: '' }]));
    const hooks = await listWebhooks(false);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe('wh-1');
  });
});

describe('createWebhook', () => {
  it('POSTs to /webhooks', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ id: 'wh-2', url: 'https://y', events: [], active: true, createdAt: '', updatedAt: '' }));
    await createWebhook({ url: 'https://y', events: [], secret: 's' }, false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/control-plane/webhooks');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });
});

describe('getCpMetrics', () => {
  it('aggregates labelled samples for the same metric name', async () => {
    const text = [
      '# TYPE acdp_events_total counter',
      'acdp_events_total{registry="a"} 3',
      'acdp_events_total{registry="b"} 4',
    ].join('\n');
    mockFetch(() => jsonResponse(text));
    const metrics = await getCpMetrics(false);
    const m = metrics.find((x) => x.name === 'acdp_events_total');
    expect(m?.value).toBe(7);
    expect(m?.type).toBe('counter');
  });

  it('captures HELP text and defaults the type to "untyped"', async () => {
    const text = ['# HELP acdp_pool_size Database connection pool size', 'acdp_pool_size 5'].join('\n');
    mockFetch(() => jsonResponse(text));
    const m = (await getCpMetrics(false)).find((x) => x.name === 'acdp_pool_size');
    expect(m?.value).toBe(5);
    expect(m?.type).toBe('untyped');
    expect(m?.help).toBe('Database connection pool size');
  });

  it('skips comments and non-finite samples', async () => {
    const text = ['# some unrelated comment', 'acdp_bad NaN', 'acdp_good 12', ''].join('\n');
    mockFetch(() => jsonResponse(text));
    const names = (await getCpMetrics(false)).map((m) => m.name);
    expect(names).toContain('acdp_good');
    expect(names).not.toContain('acdp_bad');
  });
});

describe('searchContexts both', () => {
  it('survives one registry failing and merges the rest', async () => {
    mockFetch((url) => {
      if (url.includes('registry-a')) return jsonResponse({ matches: [{ ctx_id: 'a1' }] });
      return jsonResponse('boom', false, 500); // registry-b fails
    });
    const res = await searchContexts('both', { q: 'q' }, false);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['a1']);
    expect(res.partial).toBe(true);
  });

  it('threads facet params + cursor into the registry query string', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ matches: [], next_cursor: null }));
    await searchContexts('a', { q: 'arctic', type: 'analysis', domain: 'finance', tags: 'a,b', cursor: '20' }, false);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/proxy/registry-a/contexts/search?');
    expect(url).toContain('q=arctic');
    expect(url).toContain('type=analysis');
    expect(url).toContain('domain=finance');
    expect(url).toContain('cursor=20');
  });
});
