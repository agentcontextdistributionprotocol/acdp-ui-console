// Public live mode, phase 2d: the 429 / operator-sign-in copy, the fetcher's
// parsing of FastAPI `detail.code` and `Retry-After`, the health word for a
// throttled probe, and the sidebar's Sign in / Sign out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, fetchJson, parseRetryAfter } from '@/lib/api/fetcher';
import { failureKind, getConsoleSession } from '@/lib/api/client';
import { OPERATOR_SIGN_IN_REQUIRED, operatorErrorMessage, rateLimitMessage } from '@/lib/utils/api-error-messages';
import { settledHealthView } from '@/lib/hooks/use-health';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PG_RATE = '{"detail":{"code":"run_rate_limited","limit":5,"retry_after":120,"detail":"x"}}';
const PG_CONC = '{"detail":{"code":"max_concurrent_runs","limit":3,"retry_after":10,"detail":"x"}}';
const CONSOLE_429 = '{"error":"…","errorCode":"CONSOLE_RATE_LIMITED","retryAfterSeconds":42,"limit":300}';
const CONSOLE_403 = '{"error":"…","errorCode":"CONSOLE_OPERATOR_SESSION_REQUIRED"}';

describe('ApiError parsing (criterion 1)', () => {
  it('reads FastAPI detail.code, limit and retry_after', () => {
    const e = new ApiError(429, PG_RATE, 'playground', '/runs', true);
    expect(e.errorCode).toBe('run_rate_limited');
    expect(e.limit).toBe(5);
    expect(e.retryAfterSeconds).toBe(120);
  });

  it('a plain-string detail carries no code', () => {
    expect(new ApiError(404, '{"detail":"unknown scenario: x"}', 'playground', '/runs', true).errorCode).toBeUndefined();
  });

  it('errorCode still wins over error.code and detail.code', () => {
    const e = new ApiError(400, '{"errorCode":"A","error":{"code":"B"},"detail":{"code":"C"}}', 'control-plane', '/x', true);
    expect(e.errorCode).toBe('A');
  });

  it('the Retry-After header wins over the body', () => {
    expect(new ApiError(429, PG_RATE, 'playground', '/runs', true, '7').retryAfterSeconds).toBe(7);
  });

  it('the console body retryAfterSeconds is used without a header', () => {
    expect(new ApiError(429, CONSOLE_429, 'playground', '/runs', false).retryAfterSeconds).toBe(42);
  });

  it('an HTTP-date Retry-After is converted to seconds from now', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(parseRetryAfter('Sat, 07 Nov 2026 12:01:30 GMT', undefined, now)).toBe(90);
    expect(parseRetryAfter('Sat, 07 Nov 2026 11:00:00 GMT', undefined, now)).toBe(0);
  });

  it('absent or garbage Retry-After with no body value → undefined', () => {
    expect(parseRetryAfter(null, undefined)).toBeUndefined();
    expect(parseRetryAfter('soon', undefined)).toBeUndefined();
    expect(parseRetryAfter('-5', undefined)).toBeUndefined();
    expect(new ApiError(429, 'Too Many Requests', 'playground', '/runs', true, 'later').retryAfterSeconds).toBeUndefined();
  });

  it('fetchJson passes the Retry-After header through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(PG_RATE, { status: 429, headers: { 'retry-after': '33', 'x-acdp-ui-proxy': 'playground' } }),
        ),
      ),
    );
    const err = await fetchJson('playground', '/runs', { method: 'POST' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).retryAfterSeconds).toBe(33);
    expect((err as ApiError).fromUpstream).toBe(true);
  });
});

describe('copy (criterion 2: exact strings)', () => {
  it('console 429', () => {
    expect(rateLimitMessage(new ApiError(429, CONSOLE_429, 'control-plane', '/runs', false, '42'))).toBe(
      'Too many requests from your network. Try again in 42 s.',
    );
  });

  it('run_rate_limited', () => {
    expect(rateLimitMessage(new ApiError(429, PG_RATE, 'playground', '/runs', true, '120'))).toBe(
      'Run launch limit reached (5 per window). Try again in 120 s.',
    );
  });

  it('max_concurrent_runs', () => {
    expect(rateLimitMessage(new ApiError(429, PG_CONC, 'playground', '/runs', true, '10'))).toBe(
      'The playground is already running 3 scenarios. Try again in 10 s.',
    );
  });

  it('operator sign-in required', () => {
    expect(rateLimitMessage(new ApiError(403, CONSOLE_403, 'control-plane', '/metrics', false))).toBe(
      'This action needs the operator sign-in. Sign in at /login.',
    );
    expect(operatorErrorMessage(new ApiError(403, CONSOLE_403, 'control-plane', '/metrics', false), 'Could not load metrics')).toBe(
      `Could not load metrics. ${OPERATOR_SIGN_IN_REQUIRED}`,
    );
  });

  it('omits the time phrase without a usable Retry-After, and the limit when not reported', () => {
    expect(rateLimitMessage(new ApiError(429, '{"detail":{"code":"run_rate_limited"}}', 'playground', '/runs', true))).toBe(
      'Run launch limit reached.',
    );
    expect(rateLimitMessage(new ApiError(429, '{"detail":{"code":"max_concurrent_runs"}}', 'playground', '/runs', true))).toBe(
      'The playground is already running as many scenarios as it allows.',
    );
  });

  it('a zero Retry-After says "now", not "0 s"', () => {
    expect(rateLimitMessage(new ApiError(429, CONSOLE_429, 'control-plane', '/runs', false, '0'))).toBe(
      'Too many requests from your network. Try again now.',
    );
  });

  it('honours console codes only unstamped, playground codes only stamped', () => {
    expect(rateLimitMessage(new ApiError(429, CONSOLE_429, 'playground', '/runs', true))).toBeUndefined();
    expect(rateLimitMessage(new ApiError(403, CONSOLE_403, 'control-plane', '/metrics', true))).toBeUndefined();
    expect(rateLimitMessage(new ApiError(429, PG_RATE, 'playground', '/runs', false))).toBeUndefined();
    expect(rateLimitMessage(new ApiError(429, PG_RATE, 'control-plane', '/runs', true))).toBeUndefined();
  });
});

describe('a throttled health probe (failureKind)', () => {
  it('a console 429 is "rate limited", never "unreachable"', () => {
    const e = new ApiError(429, CONSOLE_429, 'control-plane', '/healthz', false);
    expect(failureKind(e)).toBe('rate limited');
    expect(settledHealthView({ ok: false, detail: failureKind(e) }).word).toBe('rate limited');
  });

  it('other unstamped errors stay "unreachable"; stamped stay "degraded"', () => {
    expect(failureKind(new ApiError(502, '{}', 'control-plane', '/healthz', false))).toBe('unreachable');
    expect(failureKind(new ApiError(429, '{}', 'control-plane', '/healthz', true))).toBe('degraded');
  });
});

describe('getConsoleSession', () => {
  it('demo mode reports the operator chrome without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getConsoleSession(true)).toEqual({ publicMode: false, signedIn: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('real mode reads /api/auth/session, coercing to booleans', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"publicMode":true,"signedIn":"yes"}'))));
    expect(await getConsoleSession(false)).toEqual({ publicMode: true, signedIn: false });
  });

  it('a failed read throws (the sidebar then keeps "Sign out")', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 500 }))));
    await expect(getConsoleSession(false)).rejects.toThrow('500');
  });
});

describe('sidebar sign-in control (criterion 4)', () => {
  async function renderSidebar(session: { publicMode: boolean; signedIn: boolean } | 'error') {
    const { usePreferencesStore } = await import('@/lib/stores/preferences-store');
    usePreferencesStore.setState({ demoMode: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(session === 'error' ? new Response('', { status: 500 }) : new Response(JSON.stringify(session))),
      ),
    );
    const { Sidebar } = await import('@/components/layout/sidebar');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Sidebar />
      </QueryClientProvider>,
    );
  }

  it('public mode, anonymous → "Sign in" link to /login', async () => {
    await renderSidebar({ publicMode: true, signedIn: false });
    await waitFor(() => expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login'));
    expect(screen.queryByRole('button', { name: /Sign out/ })).toBeNull();
  });

  it.each([
    { publicMode: true, signedIn: true },
    { publicMode: false, signedIn: true },
    { publicMode: false, signedIn: false },
  ])('%o → "Sign out"', async (session) => {
    await renderSidebar(session);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Let the query settle, so this asserts the settled state, not the loading one.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sign in/ })).toBeNull();
  });

  it('a failed session read keeps "Sign out"', async () => {
    await renderSidebar('error');
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Let the query settle, so this asserts the settled state, not the loading one.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });
});
