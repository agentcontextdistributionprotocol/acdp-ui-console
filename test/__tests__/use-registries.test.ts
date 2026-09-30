import { describe, expect, it } from 'vitest';
import { registryProbeView } from '@/lib/hooks/use-registries';
import { ApiError } from '@/lib/api/fetcher';

// ══════════════════════════════════════════════════════════════════════
// #129: `RegistryCard`'s header used to render `<StatusDot tone="ok" />` /
// `● healthy` unconditionally, for every registry, including one this console
// never probed at all (outside the `a`/`b` capabilities map). `registryProbeView`
// is the verdict, computed from the capabilities-probe query object rather than
// asserted by the card. Pure function, no React Query mocking needed — it takes
// the SHAPE of a `UseQueryResult`, not the hook itself.
// ══════════════════════════════════════════════════════════════════════

describe('registryProbeView', () => {
  it('undefined (no query object at all — never probed) reads "not probed"', () => {
    expect(registryProbeView(undefined)).toEqual({ tone: 'warn', variant: 'neutral', label: 'not probed' });
  });

  it('isPending, no data, no error — still fetching — reads "checking…"', () => {
    expect(registryProbeView({ isPending: true })).toEqual({
      tone: 'warn',
      variant: 'neutral',
      label: 'checking…',
    });
  });

  it('data present (even an empty object) — a 200 answered — reads "responding"', () => {
    expect(registryProbeView({ data: {} })).toEqual({ tone: 'ok', variant: 'complete', label: 'responding' });
  });

  it('an upstream error (fromUpstream: true) reads "degraded"', () => {
    const view = registryProbeView({ error: new ApiError(503, '', 'registry-a', '/x', true) });
    expect(view).toEqual({ tone: 'err', variant: 'failed', label: 'degraded' });
  });

  it('a console-minted error (fromUpstream: false) reads "unreachable"', () => {
    const view = registryProbeView({ error: new ApiError(503, '', 'registry-a', '/x', false) });
    expect(view).toEqual({ tone: 'err', variant: 'failed', label: 'unreachable' });
  });

  it('error wins over a stale data value from a prior successful fetch', () => {
    // A real `UseQueryResult` can carry both after a refetch fails — `data`
    // does not clear on error. Reporting "responding" from stale data would be
    // exactly the unearned claim #129 exists to remove.
    const view = registryProbeView({ data: {}, error: new ApiError(500, '', 'registry-a', '/x', true) });
    expect(view.label).toBe('degraded');
  });

  it('the five labels are five distinct strings', () => {
    const labels = [
      registryProbeView(undefined).label,
      registryProbeView({ isPending: true }).label,
      registryProbeView({ data: {} }).label,
      registryProbeView({ error: new ApiError(503, '', 'registry-a', '/x', true) }).label,
      registryProbeView({ error: new ApiError(503, '', 'registry-a', '/x', false) }).label,
    ];
    expect(new Set(labels).size).toBe(5);
  });
});
