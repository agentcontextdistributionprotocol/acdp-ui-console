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
  pingHealth,
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

describe('pingHealth (real mode)', () => {
  it('hits /healthz and parses registry-rs\'s {status, storage, version} envelope', async () => {
    mockFetch(() => jsonResponse({ status: 'ok', storage: true, version: '0.1.0+g4f8a1c2' }));
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(true);
    expect(result.version).toBe('0.1.0+g4f8a1c2');
  });

  it('parses control-plane/playground\'s {ok, service, version} envelope identically', async () => {
    mockFetch(() => jsonResponse({ ok: true, service: 'acdp-control-plane', version: '1.4.2' }));
    const result = await pingHealth('control-plane', false);
    expect(result.ok).toBe(true);
    expect(result.version).toBe('1.4.2');
  });

  it('leaves version undefined when the response has none (older deployment predating the field)', async () => {
    mockFetch(() => jsonResponse({ status: 'ok', storage: true }));
    const result = await pingHealth('registry-b', false);
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('leaves version undefined (not a crash) when the response body is not an object', async () => {
    mockFetch(() => jsonResponse('not an object'));
    const result = await pingHealth('playground', false);
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('reports ok: false with no version when the service is down', async () => {
    mockFetch(() => jsonResponse('down', false, 503));
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it('hits the same /healthz path for every service (the dead-ternary cleanup)', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: true, version: '0.3.0' }));
    await pingHealth('playground', false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/playground/healthz');
  });
});

describe('searchContexts all', () => {
  it('survives one registry failing and merges the rest', async () => {
    mockFetch((url) => {
      if (url.includes('registry-a')) return jsonResponse({ matches: [{ ctx_id: 'a1' }] });
      return jsonResponse('boom', false, 500); // registry-b fails
    });
    const res = await searchContexts('all', { q: 'q' }, false);
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

// ══════════════════════════════════════════════════════════════════════
// The `key-revocation` facet fans out over both RFC-ACDP-0014 §10 spellings.
//
// Registry search matches `type` as an exact string
// (`acdp-registry-sqlite/src/store.rs`), and `acdp-primitives` defines both
// `key-revocation` and the interim `acdp:key-revocation`, with a ≥0.5.0
// registry still SERVING bodies published under the interim name. So the
// single-value query returned none of them and the UI reported "no contexts
// found" — claiming absence without having looked, the defect this phase
// exists to remove.
// ══════════════════════════════════════════════════════════════════════
describe('searchContexts — the revocation facet union', () => {
  const typeOf = (url: string) => new URLSearchParams(url.split('?')[1]).get('type');

  it('queries BOTH spellings and merges the results', async () => {
    const fetchMock = mockFetch((url) =>
      typeOf(url) === 'key-revocation'
        ? jsonResponse({ matches: [{ ctx_id: 'canonical-1' }], next_cursor: 'c1' })
        : jsonResponse({ matches: [{ ctx_id: 'interim-1' }], next_cursor: 'c2' }),
    );
    const res = await searchContexts('a', { type: 'key-revocation' }, false);

    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(fetchMock.mock.calls.map((c) => typeOf(String(c[0])))).toEqual([
      'key-revocation',
      'acdp:key-revocation',
    ]);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['canonical-1', 'interim-1']);
    expect(res.total_estimate).toBe(2);
    // Neither upstream cursor survives: a keyset cursor from one of two merged
    // queries silently skips or repeats rows. Same rule, same reason, as the
    // pre-existing `authority === 'all'` merge.
    expect(res.next_cursor).toBeUndefined();
  });

  it('selecting the INTERIM value gets the same union, not the mirror blind spot', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ matches: [] }));
    await searchContexts('a', { type: 'acdp:key-revocation' }, false);
    expect(fetchMock.mock.calls.map((c) => typeOf(String(c[0])))).toEqual([
      'key-revocation',
      'acdp:key-revocation',
    ]);
  });

  it('dedupes a context a registry serves under both spellings', async () => {
    mockFetch(() => jsonResponse({ matches: [{ ctx_id: 'same-1' }, { ctx_id: 'other-1' }] }));
    const res = await searchContexts('a', { type: 'key-revocation' }, false);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['same-1', 'other-1']);
  });

  it('does NOT dedupe the same ctx_id across two registries', async () => {
    // A federation observation the combined view has always shown. The type
    // axis is deduped; the authority axis deliberately is not.
    mockFetch(() => jsonResponse({ matches: [{ ctx_id: 'shared-1' }] }));
    const res = await searchContexts('all', { type: 'key-revocation' }, false);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['shared-1', 'shared-1']);
  });

  it('still survives a down registry on the four-way fan-out', async () => {
    mockFetch((url) =>
      url.includes('registry-b') ? jsonResponse('boom', false, 500) : jsonResponse({ matches: [{ ctx_id: 'a1' }] }),
    );
    const res = await searchContexts('all', { type: 'key-revocation' }, false);
    expect(res.partial).toBe(true);
    expect(res.matches.map((m) => m.ctx_id)).toEqual(['a1']);
  });

  it('reports the SUM of the upstream estimates, not the merged page size', async () => {
    // `total_estimate: matches.length` told the operator "2 contexts" for a
    // query that read only the first page of each of two upstream queries —
    // and, because the hedge in `app/contexts/page.tsx` only fires when the
    // estimate EXCEEDS what is on screen, it also suppressed the one signal
    // that would have said otherwise.
    mockFetch(() => jsonResponse({ matches: [{ ctx_id: 'x' }], total_estimate: 31 }));
    const res = await searchContexts('a', { type: 'key-revocation' }, false);
    expect(res.total_estimate).toBe(62);
    expect(res.merged).toBe(true);
  });

  it('never reports an estimate below what it actually returned', async () => {
    mockFetch((url) =>
      typeOf(url) === 'key-revocation'
        ? jsonResponse({ matches: [{ ctx_id: 'a' }, { ctx_id: 'b' }] }) // no estimate at all
        : jsonResponse({ matches: [{ ctx_id: 'c' }] }),
    );
    const res = await searchContexts('a', { type: 'key-revocation' }, false);
    expect(res.total_estimate).toBe(3);
  });

  it('marks `authority: all` merged as well — it has always suppressed its cursor', async () => {
    mockFetch(() => jsonResponse({ matches: [], total_estimate: 5, next_cursor: 'nope' }));
    const res = await searchContexts('all', {}, false);
    expect(res.merged).toBe(true);
    expect(res.next_cursor).toBeUndefined();
    expect(res.total_estimate).toBe(10);
  });

  it('DISCRIMINATES: any other facet keeps one request and its upstream cursor', async () => {
    // The suppression is per-query, never sticky state. Without this pair the
    // fan-out could have been implemented by dropping `next_cursor` globally
    // and every other assertion here would still pass.
    const fetchMock = mockFetch(() => jsonResponse({ matches: [{ ctx_id: 'x' }], next_cursor: 'keep-me' }));
    const res = await searchContexts('a', { type: 'analysis' }, false);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(res.next_cursor).toBe('keep-me');
    // Not a merge, so the page must not caption it as one.
    expect(res.merged).toBeUndefined();
  });

  it('DISCRIMINATES: no facet at all is also one request with its cursor intact', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ matches: [], next_cursor: 'keep-me' }));
    const res = await searchContexts('a', {}, false);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('type=');
    expect(res.next_cursor).toBe('keep-me');
  });

  it('a switch back to a normal facet restores paging on the very next call', async () => {
    const fetchMock = mockFetch((url) =>
      typeOf(url) === 'analysis'
        ? jsonResponse({ matches: [], next_cursor: 'back' })
        : jsonResponse({ matches: [], next_cursor: 'n' }),
    );
    expect((await searchContexts('a', { type: 'key-revocation' }, false)).next_cursor).toBeUndefined();
    expect((await searchContexts('a', { type: 'analysis' }, false)).next_cursor).toBe('back');
    expect(fetchMock.mock.calls).toHaveLength(3); // 2 + 1
  });
});

describe('searchContexts — paging a fully-filtered result set terminates', () => {
  it('walks short pages with live cursors and stops at next_cursor null', async () => {
    // The registry's documented short-page contract: a page consumed by the
    // handler's visibility/tenant post-filters returns FEWER rows than `limit`
    // while still emitting a cursor. Making "Load more" reachable in that state
    // (fold-in A) is only safe if the walk provably ends, so the exact rule the
    // page uses — `getNextPageParam: (last) => last.next_cursor` — is driven
    // here against a registry that returns three empty pages before the last.
    const cursors: Array<string | null> = ['p1', 'p2', 'p3', null];
    let call = 0;
    mockFetch(() => jsonResponse({ matches: [], next_cursor: cursors[call++] ?? null }));

    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await searchContexts('a', { type: 'analysis', cursor }, false);
      cursor = page.next_cursor ?? undefined;
      pages++;
    } while (cursor && pages < 20);

    expect(pages).toBe(4);
    expect(cursor).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// A merge that lost EVERY upstream is a failure, not an empty result.
//
// `Promise.allSettled` cannot fail, so the fan-out branch turned a total outage
// into `matches: []` with `partial: true` — which `app/contexts/page.tsx`
// renders as an amber "one of the upstream queries did not respond" above "No
// matches in this view". Every non-fanned-out facet raises the `ErrorPanel`
// instead. So selecting the revocation facet (or `authority: all`) against dead
// registries downgraded a security investigation that could not run into a
// search that found nothing.
// ══════════════════════════════════════════════════════════════════════
describe('searchContexts — every upstream down', () => {
  it('THROWS rather than reporting an empty result set', async () => {
    mockFetch(() => jsonResponse('boom', false, 503));
    await expect(searchContexts('all', { type: 'key-revocation' }, false)).rejects.toThrow();
  });

  it('propagates the upstream status, so the page renders the real cause', async () => {
    mockFetch(() => jsonResponse('boom', false, 503));
    await expect(searchContexts('all', {}, false)).rejects.toMatchObject({ status: 503 });
  });

  it('DISCRIMINATES: one surviving upstream is still a partial result, not a throw', async () => {
    // The pairing that keeps the existing resilience honest — the throw must be
    // conditional on TOTAL loss, not on any rejection.
    mockFetch((url) =>
      url.includes('registry-a') ? jsonResponse({ matches: [{ ctx_id: 'a1' }] }) : jsonResponse('boom', false, 503),
    );
    const res = await searchContexts('all', {}, false);
    expect(res.partial).toBe(true);
    expect(res.matches).toHaveLength(1);
  });

  it('DISCRIMINATES: a genuinely empty merge is still an empty merge', async () => {
    // Zero matches from upstreams that all ANSWERED is a real result and must
    // keep rendering the honest zero-match state, not an error panel.
    mockFetch(() => jsonResponse({ matches: [], total_estimate: 0 }));
    const res = await searchContexts('all', {}, false);
    expect(res.matches).toHaveLength(0);
    expect(res.partial).toBeUndefined();
    expect(res.merged).toBe(true);
  });
});
