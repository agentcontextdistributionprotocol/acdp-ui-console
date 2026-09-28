import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
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

const { useHealth } = await import('@/lib/hooks/use-health');

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

  it('reports a failure rather than going back to checking on a refetch', async () => {
    // `isLoading` is first-fetch-only, so a service that was green and has just
    // gone dark keeps showing the failure through the 15-second poll instead of
    // blanking to `checking…`. Asserted by settling once, then rejecting is not
    // possible — see the next test — so this settles twice.
    pingHealth
      .mockResolvedValueOnce({ ok: true, latencyMs: 7 } satisfies HealthResult)
      .mockResolvedValue({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult);
    const { result, rerender } = mount();

    await waitFor(() => expect(result.current.kind).toBe('healthy'));
    rerender();
    expect(result.current.kind).not.toBe('checking');
  });
});

describe('why the incoherent state is unreachable rather than handled', () => {
  it('pingHealth resolves a HealthResult on every path, including its catch', async () => {
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
