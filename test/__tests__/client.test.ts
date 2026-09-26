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
  getLogWitness,
  listEnrollments,
  enrollRegistry,
  getLineage,
  pingHealth,
} from '@/lib/api/client';
import { buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import type { HealthResult, ProxyService } from '@/lib/types';

/**
 * A response as re-streamed by the proxy — i.e. one that really came from an
 * upstream service, carrying the `x-acdp-ui-proxy` stamp the route sets on
 * that path and only that path. This is the default because nearly every test
 * here is simulating a real backend.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'x-acdp-ui-proxy': 'registry-a' }),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** An upstream response at an explicit status — the stamp is present. */
function upstreamResponse(body: unknown, status: number): Response {
  return jsonResponse(body, false, status);
}

/**
 * An envelope this console minted ITSELF — middleware's 401/503, the proxy
 * route's own 400/403/502, Next's 500. No stamp, because the request never
 * reached an upstream.
 */
function consoleResponse(body: unknown, status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
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

  it('getLogWitness → /registries/{authority}/log-witness', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ authority: 'r-a', consecutiveFailures: 0, alert: { alerted: false }, checkpoints: [], total: 0 }));
    await getLogWitness('registry-a.example.com', false);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/proxy/control-plane/registries/registry-a.example.com/log-witness',
    );
  });

  it('getLogWitness percent-encodes the authority so it can never add a path segment', async () => {
    // A well-formed DNS authority is a fixed point of encodeURIComponent, so
    // the test above would stay green with the encoding deleted. This is the
    // case that makes the call load-bearing: the authority reaches the client
    // from control-plane data, and an unencoded '/' in it would splice a new
    // segment into the proxy path — walking straight off the allow-listed
    // route that the '$' anchor exists to pin down.
    const fetchMock = mockFetch(() => jsonResponse({ authority: 'x', consecutiveFailures: 0, alert: { alerted: false }, checkpoints: [], total: 0 }));
    await getLogWitness('registry-a.example.com/../enroll', false);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      '/api/proxy/control-plane/registries/registry-a.example.com%2F..%2Fenroll/log-witness',
    );
    // The literal form that would escape the route, stated separately so the
    // assertion above cannot be "fixed" by pasting in whatever it produced.
    expect(url).not.toContain('/../');
  });

  it('getLogWitness surfaces a 404 as an ApiError rather than an empty state', async () => {
    // The caller distinguishes "no witness state recorded" from "witnessed,
    // nothing to report" — collapsing the 404 into `{checkpoints: []}` here
    // would make an unwitnessed registry indistinguishable from a witnessed
    // one with an empty retention window.
    mockFetch(() => upstreamResponse({ errorCode: 'REGISTRY_NOT_FOUND' }, 404));
    await expect(getLogWitness('nobody.example.com', false)).rejects.toMatchObject({
      status: 404,
      errorCode: 'REGISTRY_NOT_FOUND',
    });
  });

  it('getLogWitness surfaces a 403 as an ordinary error, with no admin-scope special-casing', async () => {
    // Unlike /auth/revocations this endpoint has no admin guard upstream, so a
    // 403 is a genuine surprise. The client must not translate it into
    // anything reassuring or self-diagnosing.
    mockFetch(() => upstreamResponse({ message: 'nope' }, 403));
    await expect(getLogWitness('registry-a.example.com', false)).rejects.toMatchObject({ status: 403 });
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

  it('reports ok: false with no version when the down response carries none', async () => {
    mockFetch(() => jsonResponse('down', false, 503));
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
  });

  // ── In-band degradation (Phase 6) ───────────────────────────────────
  //
  // Only the registry signals degradation through the HTTP status. The control
  // plane returns 200 with `ok:false`, so a transport-only reading of health
  // renders a control plane whose database is down as `● ok` in the topbar, the
  // observability grid, the connection panel and the SDK matrix at once.
  it('treats the control plane\'s 200-with-ok:false as degraded, keeping its live version', async () => {
    mockFetch(() => jsonResponse({ ok: false, service: 'acdp-control-plane', version: '1.4.2' }));
    const result = await pingHealth('control-plane', false);
    expect(result.ok).toBe(false);
    // The degraded body still carries the version, and the success-path
    // extraction still runs on it — so the row reads `✗ down` AND names the
    // build that is down.
    expect(result.version).toBe('1.4.2');
    // A service that answered is not "unreachable". Two surfaces render this
    // word next to a latency, so the distinction has to survive the trip.
    expect(result.detail).toBe('degraded');
  });

  it('calls the registry\'s 503 DEGRADED, not unreachable — it answered', async () => {
    // The registry's degradation signal IS a 503, and an ApiError is only
    // thrown after a real HTTP response arrived. Labelling that "unreachable"
    // beside the version just read off the same response is the overclaim this
    // phase exists to remove — and it would have been rendered next to a
    // single-digit latency.
    mockFetch(() => jsonResponse({ status: 'degraded', storage: false, version: '0.1.4' }, false, 503));
    const result = await pingHealth('registry-a', false);
    expect(result.detail).toBe('degraded');
    expect(result.version).toBe('0.1.4');
  });

  // Every envelope the CONSOLE mints itself must read `unreachable`, whatever
  // its status. Calling these `degraded` would be a positive claim that the
  // upstream reported itself unwell, when the request never left the box.
  //
  // The 401 is the one that forced this: `Topbar` renders four of these pills
  // on every route including `/login`, and `redirectToLoginOn401` deliberately
  // no-ops there — so a status-based rule made every password-protected
  // deployment's sign-in screen accuse all four services at once.
  it.each([
    ['the proxy\'s own 502', 502, { error: "Upstream 'registry-a' unreachable" }],
    ['middleware\'s 401 for a missing session', 401, { error: 'Unauthorized: sign in at /login required.' }],
    ['middleware\'s 503 for an unconfigured password', 503, { error: 'ACDP_UI_CONSOLE_PASSWORD is not configured.' }],
    ['a 500 from an unset base URL', 500, { error: 'Internal Server Error' }],
  ])('calls %s unreachable — it never left this console', async (_label, status, body) => {
    // No `x-acdp-ui-proxy` header: the proxy stamps that only when
    // re-streaming a real upstream response.
    mockFetch(() => consoleResponse(body, status));
    expect((await pingHealth('registry-a', false)).detail).toBe('unreachable');
  });

  it('calls an upstream 404 degraded — a build with no /healthz still answered', async () => {
    mockFetch(() => upstreamResponse({ error: 'Not Found' }, 404));
    expect((await pingHealth('registry-a', false)).detail).toBe('degraded');
  });

  it('calls a transport failure unreachable, and a healthy response neither', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    expect((await pingHealth('registry-a', false)).detail).toBe('unreachable');

    mockFetch(() => jsonResponse({ ok: true, version: '1.0.0' }));
    expect((await pingHealth('control-plane', false)).detail).toBeUndefined();
  });

  it('treats a 200 body claiming status: degraded as degraded', async () => {
    mockFetch(() => jsonResponse({ status: 'degraded', storage: false, version: '0.1.4' }));
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(false);
    expect(result.version).toBe('0.1.4');
  });

  // The default must be "healthy". Absence of a degradation marker is not
  // evidence of degradation, and inventing one would red-flag every working
  // older backend — the mirror of the bug above, and worse.
  it.each([
    ['an empty object', {} as unknown],
    ['a non-object body', 'not an object' as unknown],
    ['a stringly-typed ok', { ok: 'false' } as unknown],
    // `=== false`, not falsiness. A null or 0 from a sloppy upstream is an
    // absent signal, not a reported failure, and reading it as one would turn
    // the console red on a service that never claimed to be down.
    ['a null ok', { ok: null } as unknown],
    ['a numeric ok', { ok: 0 } as unknown],
    ['an unrecognised status value', { status: 'starting' } as unknown],
  ])('stays healthy for %s', async (_label, body) => {
    mockFetch(() => jsonResponse(body));
    const result = await pingHealth('control-plane', false);
    expect(result.ok).toBe(true);
  });

  // ── Version on the failure path (Phase 7, issue #73 point 3) ────────
  it('reads the version off a 503 degraded body — the exact shape meta.rs emits', async () => {
    mockFetch(() => jsonResponse({ status: 'degraded', storage: false, version: '0.1.4+gdeadbee' }, false, 503));
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(false);
    expect(result.version).toBe('0.1.4+gdeadbee');
  });

  it.each([
    ['an empty body', ''],
    ['a body that is not JSON', 'not json'],
    ['a non-string version', '{"version":7}'],
    ['an upstream HTML error page', '<html><body>502 Bad Gateway</body></html>'],
  ])('survives %s on the failure path with version undefined', async (_label, raw) => {
    // A raw-text failure body, not `jsonResponse` — the point is bytes the
    // caller must parse defensively, including bytes that are not JSON.
    //
    // `headers` is REQUIRED, and its absence made all four of these pass
    // vacuously: `cameFromUpstream(response)` is evaluated as an argument to
    // `new ApiError`, so a fixture without it threw a TypeError inside
    // `fetchJson` before any ApiError existed, `pingHealth` took the
    // non-ApiError branch, and these asserted the fallback instead of the
    // parse guard they exist to pin. A real Response always has headers.
    mockFetch(() => ({
      ok: false,
      status: 503,
      headers: new Headers({ 'x-acdp-ui-proxy': 'registry-a' }),
      json: async () => JSON.parse(raw),
      text: async () => raw,
    }) as unknown as Response);
    const result = await pingHealth('registry-a', false);
    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
  });

  // Phase 6's criterion 5, end to end. `sdk-matrix-utils.test.ts` pins the
  // second half of this seam by hand-feeding an already-reduced HealthResult,
  // which cannot tell you that `pingHealth` produces one — that test passes
  // byte-identically on main. This is the only assertion that carries the
  // control plane's in-band `200 {ok:false}` all the way from the wire to the
  // row an operator reads.
  it('carries a control plane degraded at HTTP 200 from the wire to a down matrix row', async () => {
    mockFetch(() => jsonResponse({ ok: false, service: 'acdp-control-plane', version: '1.4.2' }));
    const health = new Map<ProxyService, HealthResult | undefined>([
      ['control-plane', await pingHealth('control-plane', false)],
    ]);
    const row = buildSdkMatrixRows(false, health).find((r) => r.component === 'Control Plane (NestJS)');
    expect(row?.status).toBe('down');
    expect(row?.version).toBe('1.4.2');
    expect(row?.versionIsLive).toBe(true);
  });

  it('will not put a version on a down row unless the bytes came from upstream', async () => {
    // `sdk-matrix.ts` turns any version here into `versionIsLive: true`, so an
    // ungated read would mark a build name live on a `✗ down` row from bytes
    // that never crossed our boundary. The same `fromUpstream` fact gates both
    // fields; nothing the console mints carries `version` today, but that is a
    // property of today's code, not an invariant.
    mockFetch(() => consoleResponse({ error: 'Internal Server Error', version: '9.9.9' }, 500));
    const minted = await pingHealth('registry-a', false);
    expect(minted.detail).toBe('unreachable');
    expect(minted.version).toBeUndefined();

    // Byte-identical body, stamped: now it is the service's own build string.
    mockFetch(() => upstreamResponse({ error: 'Internal Server Error', version: '9.9.9' }, 500));
    const upstream = await pingHealth('registry-a', false);
    expect(upstream.detail).toBe('degraded');
    expect(upstream.version).toBe('9.9.9');
  });

  it('does not throw when the failure is not an ApiError at all', async () => {
    // A DNS failure or a dead socket — `fetch` itself rejects, so nothing
    // constructs an ApiError. NOT a 401: `redirectToLoginOn401` navigates and
    // then throws an ApiError anyway, so that case takes the narrowing branch
    // and is covered by the console-minted cases above.
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
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
