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
  init: Partial<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }> = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
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

  it('relays the upstream body with SSE headers on success', async () => {
    mockFetch(() => upstream({ body: sseBody('data: hello\n\n') }));
    const res = await eventsGet(new NextRequest('http://localhost/api/stream/events'));
    expect(res.status).toBe(200);
    expectSseHeaders(res);
    await expect(res.text()).resolves.toBe('data: hello\n\n');
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

  it('relays the upstream body with SSE headers on success', async () => {
    mockFetch(() => upstream({ body: sseBody('data: tick\n\n') }));
    const res = await runGet(
      new NextRequest('http://localhost/api/stream/runs/r1'),
      runCtx('r1'),
    );
    expect(res.status).toBe(200);
    expectSseHeaders(res);
    await expect(res.text()).resolves.toBe('data: tick\n\n');
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
