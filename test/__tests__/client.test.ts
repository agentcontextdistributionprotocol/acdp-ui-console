import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegistryCapabilities,
  listWebhooks,
  createWebhook,
  getCpMetrics,
  searchContexts,
  getCpDashboard,
  startRun,
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
});

describe('searchContexts both', () => {
  it('survives one registry failing and merges the rest', async () => {
    mockFetch((url) => {
      if (url.includes('registry-a')) return jsonResponse({ matches: [{ ctx_id: 'a1' }] });
      return jsonResponse('boom', false, 500); // registry-b fails
    });
    const res = await searchContexts('both', 'q', undefined, false);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['a1']);
    expect(res.partial).toBe(true);
  });
});
