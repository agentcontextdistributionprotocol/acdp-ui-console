import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, proxyUrl, fetchJson, fetchText, confirmSessionOrRedirect } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

/**
 * Placeholder for the stamp value, filled in by `mockFetch` from the proxy URL
 * the call actually went to.
 *
 * `cameFromUpstream` compares the stamp's VALUE against the service asked
 * about, not just its presence, so a fixture cannot hardcode one service (this
 * one said `control-plane`) and still mean "relayed from upstream" for a call
 * to any of the other three. `stamp` below is how a test asks for a specific —
 * including a deliberately WRONG — service instead.
 */
const STAMP_FROM_URL = '<service from url>';

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; fromUpstream?: boolean; stamp?: string } = {},
): Response {
  const { ok = true, status = 200, fromUpstream = true, stamp = STAMP_FROM_URL } = init;
  return {
    ok,
    status,
    // A real `Response` always has `headers`, and `ApiError.fromUpstream` reads
    // the proxy's `x-acdp-ui-proxy` stamp off it. `fromUpstream: false` models
    // an envelope the console minted itself (middleware's 401/503, the route's
    // own 502) — those never carry the stamp.
    headers: new Headers(fromUpstream ? { 'x-acdp-ui-proxy': stamp } : {}),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const res = impl(String(url), init);
    // Stand in for the route handler, which stamps the service it forwarded
    // to — `/api/proxy/<service>/...` — not a fixed one.
    if (res.headers.get('x-acdp-ui-proxy') === STAMP_FROM_URL) {
      res.headers.set('x-acdp-ui-proxy', String(url).replace('/api/proxy/', '').split('/')[0]);
    }
    return Promise.resolve(res);
  });
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

  describe('body (the raw response text, for callers that need the bytes)', () => {
    it('holds the response text verbatim', () => {
      const raw = JSON.stringify({ status: 'degraded', storage: false, version: '0.1.4+gdeadbee' });
      expect(new ApiError(503, raw, 'registry-a', '/healthz').body).toBe(raw);
    });

    it('holds the EMPTY string, where `message` substitutes prose', () => {
      // This is the whole reason `body` exists rather than reusing `message`:
      // the constructor falls back to a human sentence for an empty body, so a
      // caller parsing `message` would hand `JSON.parse` the word "Request".
      const err = new ApiError(502, '', 'control-plane', '/healthz');
      expect(err.body).toBe('');
      expect(err.message).toBe('Request failed with status 502');
    });

    it('does not parse or normalise the body it stores', () => {
      expect(new ApiError(500, '  not json  ', 'playground', '/x').body).toBe('  not json  ');
    });
  });

  describe('fromUpstream (did these bytes cross our own boundary?)', () => {
    it('is true when the proxy stamped the response', async () => {
      mockFetch(() => response('degraded', { ok: false, status: 503 }));
      await expect(fetchJson('registry-a', '/healthz')).rejects.toMatchObject({ fromUpstream: true });
    });

    it.each([401, 403, 500, 502, 503])(
      'is false for a console-minted %i, whatever the status says',
      async (status) => {
        // middleware's 401/503, the proxy route's own 403/502, Next's 500 for
        // an unset base URL. Status alone cannot tell these from an upstream's
        // — only the absent stamp can.
        mockFetch(() => response('console', { ok: false, status, fromUpstream: false }));
        await expect(fetchJson('registry-a', '/healthz')).rejects.toMatchObject({ fromUpstream: false });
      },
    );

    it('defaults to false when constructed directly, so a new caller cannot over-claim', () => {
      expect(new ApiError(503, 'x', 'registry-a', '/healthz').fromUpstream).toBe(false);
    });

    // The stamp's VALUE, not merely its presence. The route writes the service
    // it forwarded to, so a stamp naming another service is evidence about
    // another service — and `degraded`, plus the version printed beside it, are
    // claims about the one named. Presence-only checking called that "from
    // upstream" and attributed registry-b's answer to registry-a.
    it('is false when the stamp names a DIFFERENT service than the one asked about', async () => {
      mockFetch(() => response('degraded', { ok: false, status: 503, stamp: 'registry-b' }));
      await expect(fetchJson('registry-a', '/healthz')).rejects.toMatchObject({ fromUpstream: false });
    });

    it('is true only for the matching service — same fixture, the call that asked for registry-b', async () => {
      // Pins that the assertion above fails for the RIGHT reason (a mismatch),
      // not because the fixture is unreadable or the comparison always false.
      mockFetch(() => response('degraded', { ok: false, status: 503, stamp: 'registry-b' }));
      await expect(fetchJson('registry-b', '/healthz')).rejects.toMatchObject({ fromUpstream: true });
    });

    it('is false for a stamp that is a prefix of the service name, not an exact match', async () => {
      mockFetch(() => response('degraded', { ok: false, status: 503, stamp: 'registry' }));
      await expect(fetchJson('registry-a', '/healthz')).rejects.toMatchObject({ fromUpstream: false });
    });

    // fetchText is a second, independent throw site. Without these two, the
    // argument could be dropped from it — or hardcoded `true` — and every
    // other test in the repo still passes, because only fetchJson's site is
    // exercised above.
    it.each([
      ['stamped', true],
      ['unstamped', false],
    ] as const)('threads the stamp through fetchText too (%s)', async (_label, fromUpstream) => {
      mockFetch(() => response('boom', { ok: false, status: 503, fromUpstream }));
      await expect(fetchText('control-plane', '/metrics')).rejects.toMatchObject({ fromUpstream });
    });

    it.each([
      // The POSITIVE case is the load-bearing one. Every other fetchText
      // assertion asks for control-plane, so hardcoding
      // `cameFromUpstream(response, 'control-plane')` inside fetchText would
      // still yield `false` for the mismatch below — non-discriminating for
      // exactly the mutation it was written to catch. A registry-a call whose
      // stamp genuinely says registry-a must come back TRUE, which the
      // hardcoded value cannot produce. Same standard the plan set for the
      // argument's existence, applied to its value.
      ['the stamp names the service asked for', undefined, true],
      ['the stamp names a different service', 'registry-b', false],
    ] as const)('threads the SERVICE through fetchText too — %s', async (_label, stamp, fromUpstream) => {
      mockFetch(() => response('boom', { ok: false, status: 503, ...(stamp ? { stamp } : {}) }));
      await expect(fetchText('registry-a', '/metrics')).rejects.toMatchObject({ fromUpstream });
    });
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

// ══════════════════════════════════════════════════════════════════════
// The stamp on the SUCCESS path — detection, never enforcement.
//
// An unstamped 2xx from `/api/proxy/*` is impossible in a correctly deployed
// console: only the route's pass-through can produce a 2xx there, and it
// always stamps. So one arriving is proof of something the repo could not
// otherwise see — an intermediary stripping unknown `x-*` response headers
// (which silently turns every genuine `degraded` into `unreachable` on all
// four health surfaces), or a redirect the BROWSER followed off this boundary,
// after which the response it inspects is the target's and carries no stamp of
// ours. The route refuses to relay a 3xx itself now, so that second arm is
// about an intermediary in front of the console — or that guard regressing.
//
// It must WARN and not throw: this is a signal, and a console that refused to
// render because a header went missing would trade a cosmetic wrongness for a
// total outage.
// ══════════════════════════════════════════════════════════════════════
describe('an unstamped 2xx is warned about, never thrown on', () => {
  /**
   * A fresh module instance per test.
   *
   * The warning is deliberately once-per-page-load, which is module state — so
   * without this the first test to trip it would silence every later one, and
   * "once" could not be asserted at all.
   */
  async function freshFetcher() {
    vi.resetModules();
    return import('@/lib/api/fetcher');
  }

  function spyOnWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  it('warns, names the route and says the stamp was absent — and still returns the body', async () => {
    const warn = spyOnWarn();
    mockFetch(() => response({ ok: true, service: 'cp', version: '1.4.2' }, { fromUpstream: false }));
    const { fetchJson: fresh } = await freshFetcher();
    // The app keeps working: the parsed body comes back exactly as it would
    // have with the stamp present. This is the assertion that stops the
    // detector from ever being upgraded into a gate by accident.
    await expect(fresh('control-plane', '/healthz')).resolves.toMatchObject({ version: '1.4.2' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('/api/proxy/control-plane/healthz');
    expect(String(warn.mock.calls[0][0])).toContain('absent');
  });

  it('warns when the stamp names a different service, and quotes what it saw', async () => {
    const warn = spyOnWarn();
    mockFetch(() => response({ ok: true }, { stamp: 'registry-b' }));
    const { fetchJson: fresh } = await freshFetcher();
    await expect(fresh('registry-a', '/healthz')).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("'registry-b'");
    expect(String(warn.mock.calls[0][0])).toContain("expected 'registry-a'");
  });

  it('stays silent on a correctly stamped 2xx — the happy path pays nothing', async () => {
    const warn = spyOnWarn();
    mockFetch(() => response({ ok: true }));
    const { fetchJson: fresh } = await freshFetcher();
    await expect(fresh('control-plane', '/healthz')).resolves.toMatchObject({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per page load, not once per request', async () => {
    // Health is polled every 15s across four services. Without the latch this
    // line would repeat until it buried the rest of the console log, which is
    // how a real signal gets ignored.
    const warn = spyOnWarn();
    mockFetch(() => response({ ok: true }, { fromUpstream: false }));
    const { fetchJson: fresh } = await freshFetcher();
    await fresh('control-plane', '/healthz');
    await fresh('registry-a', '/healthz');
    await fresh('registry-b', '/healthz');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns for an unstamped 204, which returns before any body is parsed', async () => {
    // Pins the check ABOVE the 204 early return rather than after it: a
    // DELETE /webhooks/{id} answering 204 is as much a boundary crossing as a
    // body-bearing 200, and the `x-*`-stripping deployment this detects would
    // hit it too.
    const warn = spyOnWarn();
    mockFetch(() => response('', { status: 204, fromUpstream: false }));
    const { fetchJson: fresh } = await freshFetcher();
    await expect(fresh('control-plane', '/webhooks/wh-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns on fetchText\'s success path too — a second, independent reader', async () => {
    // Without this, the detector could be wired into fetchJson alone and go
    // quiet for `/metrics`, the one surface that uses the other function.
    const warn = spyOnWarn();
    mockFetch(() => response('# HELP foo\nfoo 1', { fromUpstream: false }));
    const { fetchText: fresh } = await freshFetcher();
    await expect(fresh('control-plane', '/metrics')).resolves.toBe('# HELP foo\nfoo 1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('/api/proxy/control-plane/metrics');
  });

  it('compares the service at fetchText\'s success site too, not just the presence of a stamp', async () => {
    // Every other fetchText assertion asks for control-plane, so hardcoding the
    // service at this call site would pass the whole suite — the same gap the
    // plan called out for the argument on the failure path.
    const warn = spyOnWarn();
    mockFetch(() => response('# HELP foo\nfoo 1', { stamp: 'control-plane' }));
    const { fetchText: fresh } = await freshFetcher();
    await expect(fresh('registry-a', '/metrics')).resolves.toBe('# HELP foo\nfoo 1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("expected 'registry-a'");
  });

  // Renamed, not widened. The old name promised "stamped or not"; round 2 of
  // verification asked for the missing half and round 3 proved the half I added
  // could not fail under any single-point change — `warnOnUnstampedSuccess` is
  // unreachable past the `!ok` throw, and would early-return on a correct stamp
  // even if it were reachable. A test that reads as a guard and guards nothing
  // is the thing this branch exists to remove, so the honest fix is the name.
  // The unstamped case below is the one with teeth: it dies if the warn call is
  // ever hoisted above the failure throw.
  it('does not warn on an unstamped FAILURE response — that path already reads the stamp', async () => {
    // A console-minted 401/503 arriving unstamped is normal and expected;
    // warning there would fire on every signed-out page load and mean nothing.
    const warn = spyOnWarn();
    mockFetch(() => response('unauthorized', { ok: false, status: 401, fromUpstream: false }));
    const { fetchJson: fresh } = await freshFetcher();
    vi.stubGlobal('location', { pathname: '/login', assign: vi.fn() });
    await expect(fresh('control-plane', '/healthz')).rejects.toMatchObject({ fromUpstream: false });
    expect(warn).not.toHaveBeenCalled();
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

  // `fromUpstream: false` is load-bearing in these two, and was missing before
  // #91: `response()` defaults it to TRUE (see :21), so these cases were
  // modelling a stamped, relayed 401 while calling themselves "the auth gate".
  // The auth gate is `middleware.ts:94`, whose 401 the console mints itself and
  // never stamps. The assertions are unchanged; only the fixture now says what
  // the test name always claimed.
  it('fetchJson redirects the browser to /login on a 401 (the auth gate)', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401, fromUpstream: false }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('fetchText redirects the browser to /login on a 401 (the auth gate)', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401, fromUpstream: false }));
    await expect(fetchText('control-plane', '/metrics')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  // The #91 pair. A 401 that carries the proxy's stamp came from the service
  // itself — a wrong or rotated CONTROL_PLANE_API_KEY — and the operator's own
  // session is fine. Bouncing them to /login sends them to re-enter a
  // passphrase that was never the problem, and returns them to a page that
  // 401s again: a loop signing in cannot break.
  it('fetchJson does NOT redirect on an upstream 401 — the session is valid', async () => {
    const assign = stubLocation();
    mockFetch(() => response('upstream refused', { ok: false, status: 401 }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({
      status: 401,
      fromUpstream: true,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('fetchText does NOT redirect on an upstream 401 — the session is valid', async () => {
    const assign = stubLocation();
    mockFetch(() => response('upstream refused', { ok: false, status: 401 }));
    await expect(fetchText('control-plane', '/metrics')).rejects.toMatchObject({
      status: 401,
      fromUpstream: true,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  // `cameFromUpstream` compares the stamp's VALUE, so a stamp naming another
  // service is not evidence that the service we asked about refused us, and
  // `ApiError.fromUpstream` is false — which is right, because that flag is a
  // provenance claim about one named service.
  //
  // Reusing it for the redirect gate is slightly over-broad and worth being
  // honest about: the route stamps only on the pass-through, and in production
  // that runs only after middleware validated the session — so ANY stamp,
  // matching or not, is proof the operator's session was fine, and redirecting
  // is useless either way. (In development with ACDP_UI_CONSOLE_PASSWORD unset
  // middleware fails open, so the route stamps with nothing validated; there is
  // no session to expire on that path either, so the conclusion survives.)
  // The case is unreachable in a correct deployment and fails towards
  // redirecting rather than away, so it stands; it is not, however, the crisp
  // "conservative" argument an earlier version of this comment claimed.
  //
  // Unlike the four cases above this one does not gate the change — every 401
  // redirected before it. It pins the direction the value comparison must fail
  // in, which is the part a future "simplify to a presence check" would break.
  it('redirects when the stamp names a DIFFERENT service than the call asked about', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401, stamp: 'registry-b' }));
    await expect(fetchJson('registry-a', '/contexts')).rejects.toMatchObject({
      status: 401,
      fromUpstream: false,
    });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  // The `fetchText` twin. Round 4 of verification mutation-tested both call
  // sites separately and found this one was the single remaining unpinned
  // change in the file: weakening `fetchText`'s redirect argument to a
  // presence check killed no test, while the same weakening in `fetchJson`
  // died at the case above. Two call sites, two tests.
  it('fetchText redirects too when the stamp names a DIFFERENT service', async () => {
    const assign = stubLocation();
    mockFetch(() => response('unauthorized', { ok: false, status: 401, stamp: 'registry-b' }));
    await expect(fetchText('registry-a', '/metrics')).rejects.toMatchObject({
      status: 401,
      fromUpstream: false,
    });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  // UNSTAMPED, and that is the whole point of this case. The guard is
  // `status !== 401 || fromUpstream || …`; with a stamped 502 the second arm
  // short-circuits and the status arm is never exercised, so the test would
  // survive its own deletion. An unstamped 502 is also the honest fixture: a
  // backend that is down surfaces as the proxy route's OWN 502, which it mints
  // and never stamps.
  //
  // Losing the status arm would be strictly worse than the bug #91 fixes — any
  // console-minted non-401 (that 502, middleware's 503 for an unset
  // ACDP_UI_CONSOLE_PASSWORD, Next's 500 for an unset *_BASE_URL) would sign
  // the operator out because a backend was unreachable.
  it('does not redirect on other error statuses', async () => {
    const assign = stubLocation();
    mockFetch(() => response('boom', { ok: false, status: 502, fromUpstream: false }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 502 });
    expect(assign).not.toHaveBeenCalled();
  });

  // The SSR arm of the same guard, which had no test at all. `fetchJson` and
  // `fetchText` are plain module functions — usually a React Query `queryFn`,
  // but nothing stops one running where there is no `window`. A redirect is
  // meaningless there, and without this arm the very next line dereferences
  // `window.location` and turns a 401 into a `TypeError` the caller never asked
  // for. The assertion is that the `ApiError` reaches the caller intact.
  //
  // Round 3 of verification found this arm killed no test in the whole suite,
  // then demonstrated it IS observable under jsdom rather than accepting the
  // usual "can't test SSR here" excuse.
  it('does not touch window on a 401 when there is no window (SSR)', async () => {
    mockFetch(() => response('unauthorized', { ok: false, status: 401, fromUpstream: false }));
    vi.stubGlobal('window', undefined);
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 401 });
  });

  // `fromUpstream: false` for the same reason as the two above, and it matters
  // more here: with a stamped 401 this test would exit at the `fromUpstream`
  // arm and never reach the pathname guard it is named for, asserting nothing.
  // That guard is load-bearing — `Topbar` renders on every route including
  // `/login` and polls health every 15s, so losing it makes the sign-in page
  // navigate to itself every 15 seconds, before an operator can finish typing.
  it('does not redirect again when already on /login', async () => {
    const assign = stubLocation('/login');
    mockFetch(() => response('unauthorized', { ok: false, status: 401, fromUpstream: false }));
    await expect(fetchJson('control-plane', '/runs')).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });

  describe('confirmSessionOrRedirect', () => {
    it('redirects to /login when the confirm request comes back 401', async () => {
      const assign = stubLocation();
      const fetchMock = mockFetch(() =>
        response('unauthorized', { ok: false, status: 401, fromUpstream: false }),
      );
      await confirmSessionOrRedirect();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/control-plane/healthz');
      expect(assign).toHaveBeenCalledWith('/login');
    });

    // Asserted here rather than through the hooks: `use-live-run.ts` and
    // `use-global-events.ts` both call this helper after an EventSource error,
    // and both of their test files `vi.mock` it — so nothing over there would
    // ever catch this regressing. A rotated CONTROL_PLANE_API_KEY makes this
    // probe 401 with the operator's session perfectly valid; before #91 that
    // bounced them to /login on every SSE hiccup.
    it('does NOT redirect when the probe gets a stamped upstream 401', async () => {
      const assign = stubLocation();
      mockFetch(() => response('upstream refused', { ok: false, status: 401 }));
      await expect(confirmSessionOrRedirect()).resolves.toBeUndefined();
      expect(assign).not.toHaveBeenCalled();
    });

    // Unstamped, for both reasons given on the `fetchJson` sibling above: a
    // stamped 502 masks the status arm behind the `fromUpstream` arm, and a
    // network blip reaching an upstream IS the proxy route's own unstamped 502.
    it('does not redirect and does not throw on a non-401 failure (e.g. a network blip)', async () => {
      const assign = stubLocation();
      mockFetch(() => response('boom', { ok: false, status: 502, fromUpstream: false }));
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
