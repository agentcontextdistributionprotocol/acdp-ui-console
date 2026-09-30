import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthResult } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// `useHealth` — the one definition of the word an operator is told.
//
// This exists as a HOOK rather than a `healthWord(result, isLoading)` helper
// for a reason these tests are the place to state. A two-argument helper can be
// called in a state that does not exist: `healthWord(undefined, false)` — no
// data and not loading — has to answer something, and every implementation
// answers `'unreachable'`, which asserts a service is dead from the absence of
// any evidence whatsoever. That is the same over-claim as #100's tooltip, moved
// one file along.
//
// A hook that owns the query cannot be asked that question, and the last test
// below demonstrates why the state is unreachable rather than merely awkward:
// `pingHealth` has no rejection path at all.
//
// `lib/hooks/use-health.ts` is deliberately NOT on `vitest.config.mts`'s
// hook-exclude list. That list is for thin React Query wrappers; this one holds
// the word mapping, which is the logic under test — the same reasoning that
// took `use-trust.ts` off it.
// ══════════════════════════════════════════════════════════════════════

const pingHealth = vi.fn();
vi.mock('@/lib/api/client', () => ({ pingHealth: (...a: unknown[]) => pingHealth(...a) }));
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const { useHealth, settledHealthView } = await import('@/lib/hooks/use-health');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useHealth('registry-a'), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('the four states', () => {
  it('is checking before the first probe settles, and claims nothing', async () => {
    pingHealth.mockImplementation(() => new Promise(() => {}));
    const { result } = mount();

    expect(result.current).toEqual({ kind: 'checking', word: 'checking…' });
    // No latency, no version, and above all no reachability claim. The union
    // makes those unrepresentable on this arm rather than merely absent.
    expect('latencyMs' in result.current).toBe(false);
  });

  it('is healthy with the latency and the version the probe read', async () => {
    pingHealth.mockResolvedValue({ ok: true, latencyMs: 7, version: '1.0.0' } satisfies HealthResult);
    const { result } = mount();

    await waitFor(() => expect(result.current.kind).toBe('healthy'));
    expect(result.current).toEqual({ kind: 'healthy', word: 'healthy', latencyMs: 7, version: '1.0.0' });
  });

  it('is degraded when something answered and the answer was unhealthy', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
    const { result } = mount();

    await waitFor(() => expect(result.current.kind).toBe('failing'));
    // The latency comes WITH the word, not instead of it. "degraded · 8 ms" is
    // corroboration; the same 8 ms beside "unreachable" was the contradiction
    // that started this.
    expect(result.current).toEqual({ kind: 'failing', word: 'degraded', latencyMs: 8 });
  });

  it('is unreachable when nothing beyond the boundary answered', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult);
    const { result } = mount();

    await waitFor(() => expect(result.current.kind).toBe('failing'));
    expect(result.current.word).toBe('unreachable');
  });
});

describe('the edges of a field that is a union in TypeScript only', () => {
  it('defaults a failure with no detail to the word every surface used to say', async () => {
    pingHealth.mockResolvedValue({ ok: false, latencyMs: 12 } satisfies HealthResult);
    const { result } = mount();

    await waitFor(() => expect(result.current.kind).toBe('failing'));
    expect(result.current.word).toBe('unreachable');
  });

  it('passes an out-of-union detail through rather than substituting unreachable', async () => {
    // A newer backend, a `pingHealth` arm nobody has written yet, or a
    // hand-built fixture. `detail` is closed at compile time and open at
    // runtime, so the cast is the honest way to test it.
    // `as unknown as` because the union really is closed at compile time —
    // TypeScript refuses the single-step cast, which is the type doing its job.
    // The double cast is the honest way to reach a value only the runtime can
    // produce.
    pingHealth.mockResolvedValue({ ok: false, detail: 'quarantined', latencyMs: 5 } as unknown as HealthResult);
    const { result } = mount();

    await waitFor(() => expect(result.current.kind).toBe('failing'));
    // Surfacing the unfamiliar word says "it answered and said this".
    // Substituting `unreachable` would report a service that demonstrably
    // replied as one that never did — the fail-CLOSED direction here is the
    // dishonest one.
    expect(result.current.word).toBe('quarantined');
  });

  it('reports the failure across a refetch instead of blinking back to checking', async () => {
    // A REAL second fetch. The first version of this test called `rerender()`
    // and asserted `kind !== 'checking'` — but `rerender()` does not refetch
    // and the 15-second interval never elapses under the test clock, so
    // `pingHealth` was called exactly ONCE, the second stub was never consumed,
    // no failure was ever observed, and the assertion reduced to
    // `'healthy' !== 'checking'`, which the healthy test above already proves.
    // It gated nothing while its name and the hook's docblock both cited it as
    // the gate on React Query's first-fetch-only `isLoading` semantics.
    //
    // `refetchQueries` drives the transition the 15-second poll would: React
    // Query keeps the previous `data` while refetching, so the hook must report
    // the NEW failure and must never pass through `checking…` on the way.
    pingHealth
      .mockResolvedValueOnce({ ok: true, latencyMs: 7 } satisfies HealthResult)
      .mockResolvedValue({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Every value the hook RETURNS, render by render. Sampling `result.current`
    // on a timer would miss intermediate renders entirely — React's updates are
    // what this claim is about, so the render is where it has to be observed.
    const seen: string[] = [];
    const { result } = renderHook(
      () => {
        const view = useHealth('registry-a');
        seen.push(view.kind);
        return view;
      },
      { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
    );

    await waitFor(() => expect(result.current.kind).toBe('healthy'));
    const afterFirstSettle = seen.length;

    await act(async () => {
      await client.refetchQueries({ queryKey: ['health', 'registry-a', false] });
    });
    await waitFor(() => expect(result.current.kind).toBe('failing'));

    // The probe really ran a second time — without this the rest is vacuous,
    // which is exactly how the previous version of this test passed.
    expect(pingHealth).toHaveBeenCalledTimes(2);
    expect(result.current.word).toBe('unreachable');
    // And there was at least one render in between to have an opinion about.
    expect(seen.length).toBeGreaterThan(afterFirstSettle);
    expect(seen.slice(afterFirstSettle)).not.toContain('checking');
  });
});

describe('why the incoherent state is unreachable rather than handled', () => {
  // One path, not "every path" — an earlier title claimed the latter, which is
  // the same over-claiming this batch exists to remove. The transport-failure
  // path is the one that would otherwise reject, and therefore the one worth
  // demonstrating; the success path cannot reject by construction.
  it('pingHealth resolves rather than rejects when the fetch itself fails', async () => {
    // The load-bearing fact behind the hook's shape. `lib/api/client.ts`'s
    // `pingHealth` wraps its fetch in a `try/catch` and RETURNS
    // `{ ok: false, detail: failureKind(err) }` from the catch rather than
    // rethrowing — so this query has no error arm, and "settled with no data"
    // does not occur.
    //
    // `vi.importActual`, not a plain dynamic import: the `vi.mock` at the top
    // of this file is keyed on the RESOLVED path, so `'../../lib/api/client'`
    // would have come back mocked and this test would have asserted on its own
    // stub.
    const real = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    try {
      await expect(real.pingHealth('registry-a', false)).resolves.toMatchObject({ ok: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('settledHealthView — the extracted settled half, callable without the hook', () => {
  // `connection-panel.tsx`'s "Test All" already holds a `HealthResult` from an
  // ad hoc probe outside this hook's query, so it needs the word mapping
  // without needing a query. These three mirror "the four states" above
  // (minus `checking`, which this function cannot express) to pin that
  // extracting it changed nothing about what it returns.
  it('maps a healthy result', () => {
    expect(settledHealthView({ ok: true, latencyMs: 7, version: '1.0.0' } satisfies HealthResult)).toEqual({
      kind: 'healthy',
      word: 'healthy',
      latencyMs: 7,
      version: '1.0.0',
    });
  });

  it('maps a degraded result', () => {
    expect(settledHealthView({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult)).toEqual({
      kind: 'failing',
      word: 'degraded',
      latencyMs: 8,
    });
  });

  it('maps an unreachable result, including the pre-detail default', () => {
    expect(settledHealthView({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult)).toEqual({
      kind: 'failing',
      word: 'unreachable',
      latencyMs: 30,
    });
    expect(settledHealthView({ ok: false, latencyMs: 12 } satisfies HealthResult).word).toBe('unreachable');
  });
});

describe('the query config the hook owns', () => {
  // Two copies of this config used to live in `connection-status.tsx` and
  // `health-checks.tsx`, byte-identical including the cache key. The docblock
  // argues that sharing a cache KEY across two files is a correctness hazard
  // rather than ordinary duplication — so the key's own shape is worth pinning,
  // and neither claim was gated before.

  it('does not share a cache entry between demo and real mode', async () => {
    // The `demoMode` segment of the key is why `/observability` does not show a
    // real probe's answer after a toggle, and vice versa. Dropping it from the
    // key kills no render assertion anywhere — the words are identical — so
    // this is the only thing standing between the segment and a tidy-up.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    pingHealth.mockResolvedValue({ ok: true, latencyMs: 7 } satisfies HealthResult);
    renderHook(() => useHealth('registry-a'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(client.getQueryData(['health', 'registry-a', false])).toBeDefined());

    // The other mode's slot is a DIFFERENT entry and is still empty.
    expect(client.getQueryData(['health', 'registry-a', true])).toBeUndefined();
    // And so is another service's.
    expect(client.getQueryData(['health', 'control-plane', false])).toBeUndefined();
  });

  it('does not retry a failed probe', async () => {
    // `retry: false` is kept deliberately, not inherited: a health probe that
    // retries reports the RETRY's outcome, and the operator is watching a
    // 15-second poll — the next honest answer is closer than a backoff would
    // be. Asserted through the query's own options, since `pingHealth` never
    // rejects and so cannot demonstrate a retry by failing.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
    pingHealth.mockResolvedValue({ ok: false, detail: 'unreachable' } satisfies HealthResult);
    const { result } = renderHook(() => useHealth('registry-a'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.kind).toBe('failing'));

    // Read off the cache entry's own options. `QueryOptions` does not declare
    // `refetchInterval` (it lives on the observer, not the query), so the two
    // are read through the shape the cache actually stores rather than through
    // a cast that would also hide a rename.
    const entry = client.getQueryCache().find({ queryKey: ['health', 'registry-a', false] })!;
    const opts = entry.options as { retry?: unknown; refetchInterval?: unknown };
    expect(opts.retry).toBe(false);
    expect(opts.refetchInterval).toBe(15_000);
  });
});
