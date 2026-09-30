// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as eventsGet } from '@/app/api/stream/events/route';
import { GET as runGet } from '@/app/api/stream/runs/[runId]/route';

/** A one-shot SSE body the relay can pass straight through. */
function sseBody(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function upstream(
  init: Partial<{
    ok: boolean;
    status: number;
    type: ResponseType;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
  }> = {},
): Response {
  const status = init.status ?? 200;
  return {
    type: init.type ?? 'basic',
    // `ok` DERIVES from `status` unless a case deliberately makes them
    // disagree. It used to default to `true`, which let a fixture claim a 302
    // was also `ok` — a response no real fetch can produce, and one that would
    // have let the redirect-refusal tests below pass before the fix existed.
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    // Defaults to a well-labelled SSE response for the same reason `ok`
    // derives from `status` above: a fixture that didn't care about
    // content-type used to get a free pass through the new check by omission,
    // which is a response no real upstream SSE endpoint sends.
    headers: init.headers ?? new Headers({ 'content-type': 'text/event-stream' }),
    body: init.body ?? null,
  } as unknown as Response;
}

/** A 3xx as `redirect: 'manual'` actually surfaces it: not ok, Location readable. */
function redirectUpstream(status: number, location?: string): Response {
  return upstream({
    status,
    headers: new Headers(location ? { location } : {}),
    body: sseBody(''),
  });
}

/**
 * What browser-semantics `fetch` answers `redirect: 'manual'` with, per spec:
 * a synthetic `status: 0` and no body. undici returns the real 3xx instead
 * (measured on Node 24.20.0), so this shape is unreachable in the Node runtime
 * these handlers run in today — it is pinned because `maxDuration = 60` marks
 * them as edge-runtime candidates, and there the range check alone would drop
 * an opaque redirect into the generic bail as `upstream returned 0`. Same
 * fixture rationale as `proxy-route.test.ts`, which guards the identical case.
 */
function opaqueRedirectUpstream(): Response {
  return upstream({ ok: false, status: 0, type: 'opaqueredirect', body: null });
}

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn((url: string | URL | Request, init: RequestInit) =>
    Promise.resolve(impl(String(url), init)),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function expectSseHeaders(res: Response) {
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
  expect(res.headers.get('x-accel-buffering')).toBe('no');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('events SSE relay', () => {
  it('injects the control-plane bearer token and requests an event stream', async () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'cp-secret');
    const fetchMock = mockFetch(() => upstream({ body: sseBody('') }));
    await eventsGet(new NextRequest('http://localhost/api/stream/events?since=42'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/events/stream?since=42');
    const headers = init.headers as Record<string, string>;
    expect(headers.accept).toBe('text/event-stream');
    expect(headers.authorization).toBe('Bearer cp-secret');
    expect(init.cache).toBe('no-store');
  });

  it('omits authorization when no token is configured', async () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', '');
    const fetchMock = mockFetch(() => upstream({ body: sseBody('') }));
    await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  // The load-bearing assertion for #106. A stubbed fetch never follows a
  // redirect whatever this option says, so no call-count test can prove the
  // target was spared — only pinning the option itself can.
  it("pins redirect: 'manual' so the injected bearer cannot follow a Location", async () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'cp-secret');
    const fetchMock = mockFetch(() => upstream({ body: sseBody('') }));
    await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it.each([301, 302, 303, 307, 308])(
    'refuses an upstream %i with a 502 naming the URL, the status and the Location',
    async (status) => {
      vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
      const fetchMock = mockFetch(() => redirectUpstream(status, 'https://evil.example/steal'));
      const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
      expect(res.status).toBe(502);
      const body = await res.text();
      expect(body).toContain(`answered ${status}`);
      expect(body).toContain('http://localhost:3001/events/stream');
      expect(body).toContain('https://evil.example/steal');
      expect(body).toContain('does not follow 3xx');
      // Our own code issues no second request. (The stub would not follow one
      // either way — see the redirect-option test above for the real guarantee.)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // A 3xx must not be mistaken for the generic not-ok bail, which would
      // lose both the status and the Location.
      expect(body).not.toBe(`upstream returned ${status}`);
    },
  );

  it('names (no Location header) when the 3xx carries none', async () => {
    mockFetch(() => redirectUpstream(302));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain('(no Location header)');
  });

  it('refuses an opaque redirect by name rather than as "upstream returned 0"', async () => {
    mockFetch(() => opaqueRedirectUpstream());
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('an opaque redirect');
    expect(body).not.toContain('upstream returned 0');
  });

  // The stamp means "something beyond our boundary answered". This 502 is the
  // console's own refusal, so stamping it would report our decision as the
  // control plane reporting itself unwell.
  //
  // NOTE: unlike its neighbours this case does NOT gate the phase — the
  // pre-fix generic bail also minted an unstamped 502, so it passes either
  // way. It is here as a standing invariant guard, not as proof of the fix.
  it('mints the redirect refusal without the proxy stamp', async () => {
    mockFetch(() => redirectUpstream(307, 'http://elsewhere'));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it('relays the upstream body with SSE headers on success', async () => {
    mockFetch(() => upstream({ body: sseBody('data: hello\n\n') }));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(200);
    expectSseHeaders(res);
    expect(res.headers.get('connection')).toBe('keep-alive');
    await expect(res.text()).resolves.toBe('data: hello\n\n');
  });

  // #112. A 200 relabelled `text/event-stream` by this relay would otherwise
  // reach the browser as a healthy live feed no matter what the upstream
  // actually sent — an HTML error or login page included.
  it('refuses a 200 whose content-type is not text/event-stream', async () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
    mockFetch(() =>
      upstream({
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: sseBody('<html>not a stream</html>'),
      }),
    );
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("content-type 'text/html; charset=utf-8'");
    expect(body).toContain('only relays text/event-stream');
    expect(body).toContain('http://localhost:3001/events/stream');
    // A mislabelled 200 must not be mistaken for the generic not-ok bail,
    // which would lose the content-type entirely.
    expect(body).not.toBe('upstream returned 200');
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it('refuses a 200 with no content-type at all, naming it (none)', async () => {
    mockFetch(() => upstream({ headers: new Headers(), body: sseBody('') }));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain("content-type '(none)'");
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it.each([
    ['text/event-stream-foo', 502],
    ['application/json', 502],
    ['text/plain', 502],
    ['TEXT/EVENT-STREAM', 200],
    ['text/event-stream ; charset=utf-8', 200],
  ] as const)('content-type %s is accepted/refused by MIME essence (-> %i)', async (contentType, expectedStatus) => {
    mockFetch(() =>
      upstream({ headers: new Headers({ 'content-type': contentType }), body: sseBody('data: x\n\n') }),
    );
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(expectedStatus);
  });

  it('returns 502 when the upstream is not ok', async () => {
    mockFetch(() => upstream({ ok: false, status: 503, body: sseBody('') }));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toBe('upstream returned 503');
  });

  it('returns 502 when the upstream has no body', async () => {
    mockFetch(() => upstream({ ok: true, status: 200, body: null }));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
  });

  it('returns 502 when the fetch throws', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain('stream relay failed');
  });
});

describe('per-run SSE relay', () => {
  function runCtx(runId: string) {
    return { params: Promise.resolve({ runId }) };
  }

  it('percent-encodes the run id and passes the abort signal through', async () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
    const fetchMock = mockFetch(() => upstream({ body: sseBody('') }));
    const req = new NextRequest('http://localhost/api/stream/runs/run%2F1');
    await runGet(req, runCtx('run/1 β'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/runs/run%2F1%20%CE%B2/events');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(req.signal);
  });

  // This relay sends no credential, so the 3xx exposure here is the target's
  // bytes arriving under the playground's identity rather than a leak. Pinned
  // identically so the asymmetry cannot trap whoever adds auth upstream.
  it("pins redirect: 'manual' even though it injects no bearer", async () => {
    const fetchMock = mockFetch(() => upstream({ body: sseBody('') }));
    await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it.each([301, 302, 303, 307, 308])(
    'refuses an upstream %i with a 502 naming the URL, the status and the Location',
    async (status) => {
      vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
      const fetchMock = mockFetch(() => redirectUpstream(status, 'https://evil.example/steal'));
      const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
      expect(res.status).toBe(502);
      const body = await res.text();
      expect(body).toContain(`answered ${status}`);
      expect(body).toContain('http://localhost:8000/runs/r1/events');
      expect(body).toContain('https://evil.example/steal');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body).not.toBe(`upstream returned ${status}`);
    },
  );

  it('refuses an opaque redirect by name rather than as "upstream returned 0"', async () => {
    mockFetch(() => opaqueRedirectUpstream());
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('an opaque redirect');
    expect(body).not.toContain('upstream returned 0');
  });

  it('names (no Location header) when the 3xx carries none, and carries no stamp', async () => {
    mockFetch(() => redirectUpstream(302));
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
    await expect(res.text()).resolves.toContain('(no Location header)');
  });

  it('relays the upstream body with SSE headers on success', async () => {
    mockFetch(() => upstream({ body: sseBody('data: tick\n\n') }));
    const res = await runGet(
      new NextRequest('http://localhost/api/stream/runs/r1'),
      runCtx('r1'),
    );
    expect(res.status).toBe(200);
    expectSseHeaders(res);
    expect(res.headers.get('connection')).toBe('keep-alive');
    await expect(res.text()).resolves.toBe('data: tick\n\n');
  });

  // #112. Identical to the control-plane relay's case: a 200 relabelled
  // `text/event-stream` here would reach the browser as a healthy live feed
  // no matter what the playground actually answered.
  it('refuses a 200 whose content-type is not text/event-stream', async () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
    mockFetch(() =>
      upstream({
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: sseBody('<html>not a stream</html>'),
      }),
    );
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("content-type 'text/html; charset=utf-8'");
    expect(body).toContain('only relays text/event-stream');
    expect(body).toContain('http://localhost:8000/runs/r1/events');
    expect(body).not.toBe('upstream returned 200');
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it('refuses a 200 with no content-type at all, naming it (none)', async () => {
    mockFetch(() => upstream({ headers: new Headers(), body: sseBody('') }));
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain("content-type '(none)'");
    expect(res.headers.get('x-acdp-ui-proxy')).toBeNull();
  });

  it.each([
    ['text/event-stream-foo', 502],
    ['application/json', 502],
    ['text/plain', 502],
    ['TEXT/EVENT-STREAM', 200],
    ['text/event-stream ; charset=utf-8', 200],
  ] as const)('content-type %s is accepted/refused by MIME essence (-> %i)', async (contentType, expectedStatus) => {
    mockFetch(() =>
      upstream({ headers: new Headers({ 'content-type': contentType }), body: sseBody('data: x\n\n') }),
    );
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(expectedStatus);
  });

  it('returns 502 when the upstream is not ok', async () => {
    mockFetch(() => upstream({ ok: false, status: 404, body: sseBody('') }));
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toBe('upstream returned 404');
  });

  it('returns 502 when the fetch throws', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const res = await runGet(new NextRequest('http://localhost/api/stream/runs/r1'), runCtx('r1'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain('stream relay failed');
  });
});
