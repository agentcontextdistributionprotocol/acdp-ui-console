// ══════════════════════════════════════════════════════════════════════
// `useLogWitnessAlerts` — the two properties its docblock asserts.
//
// This hook is a thin wrapper and stays on `vitest.config.mts`'s named
// hook-exclude list for coverage. That is about COVERAGE ACCOUNTING, not about
// whether its behaviour is checked: the docblock makes two claims a reader
// would rely on, and before this file neither was true of anything but the
// prose. A mutation sweep dropped `includeAcknowledged` from the query key and
// forced `demoMode` to `false`, and the entire suite stayed green.
//
//   1. `includeAcknowledged` is IN THE QUERY KEY. The two listings are
//      different responses from one endpoint, so sharing a cache entry would
//      serve the filtered list to a caller that asked for the full one — which
//      on this surface means hiding outstanding alerts behind a cache hit.
//   2. `demoMode` is passed through. Without it demo mode reaches the network.
// ══════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listLogWitnessAlerts = vi.fn<
  (...args: unknown[]) => Promise<{ data: unknown[]; total: number }>
>(async () => ({ data: [], total: 0 }));

vi.mock('@/lib/api/client', () => ({
  listLogWitnessAlerts: (...a: unknown[]) => listLogWitnessAlerts(...a),
}));

let demoMode = false;
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode }),
}));

const { useLogWitnessAlerts } = await import('@/lib/hooks/use-security');

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * `staleTime: Infinity` is what makes the key assertions mean anything.
 *
 * With the default `staleTime: 0` every remount refetches whatever the key is,
 * so "two calls" would prove nothing about key distinctness and the
 * same-argument case could never show a cache hit. Pinning the data fresh
 * forever isolates the ONE variable under test: whether two argument values
 * address the same cache entry. (The app's own client sets 20s per
 * `CLAUDE.md`; the exact number is irrelevant here, only that it is not zero.)
 */
function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

afterEach(() => {
  cleanup();
  listLogWitnessAlerts.mockClear();
  demoMode = false;
});

describe('useLogWitnessAlerts — the two listings never share a cache entry', () => {
  it('refetches when includeAcknowledged changes, rather than serving the cached list', async () => {
    // The realistic defect: a surface asks for the full listing, gets the
    // filtered one out of cache, and renders "no alert is recorded" over a
    // still-outstanding detection.
    const client = newClient();
    const wrapper = wrapperWith(client);

    const first = renderHook(() => useLogWitnessAlerts(false), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts).toHaveBeenCalledTimes(1);
    expect(listLogWitnessAlerts.mock.calls[0][0]).toEqual({ includeAcknowledged: false });

    // Same QueryClient, different argument: a shared key would resolve from
    // cache and never call the client a second time.
    const second = renderHook(() => useLogWitnessAlerts(true), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts).toHaveBeenCalledTimes(2);
    expect(listLogWitnessAlerts.mock.calls[1][0]).toEqual({ includeAcknowledged: true });
  });

  it('serves the SAME argument from cache, so the key is not merely unique', async () => {
    // Anti-vacuity for the test above: if the key were uncacheable (a fresh
    // value each render) the first assertion would pass for the wrong reason.
    const client = newClient();
    const wrapper = wrapperWith(client);

    const first = renderHook(() => useLogWitnessAlerts(true), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts).toHaveBeenCalledTimes(1);

    const again = renderHook(() => useLogWitnessAlerts(true), { wrapper });
    await waitFor(() => expect(again.result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts).toHaveBeenCalledTimes(1);
  });
});

describe('useLogWitnessAlerts — demo mode does not reach the network', () => {
  it('passes demoMode through to the client', async () => {
    demoMode = true;
    const wrapper = wrapperWith(newClient());
    const { result } = renderHook(() => useLogWitnessAlerts(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts.mock.calls[0][1]).toBe(true);
  });

  it('passes it through as false when demo mode is off', async () => {
    demoMode = false;
    const wrapper = wrapperWith(newClient());
    const { result } = renderHook(() => useLogWitnessAlerts(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listLogWitnessAlerts.mock.calls[0][1]).toBe(false);
  });
});
