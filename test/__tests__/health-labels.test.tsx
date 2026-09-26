import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthResult } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// The two surfaces that render a WORD for health, not just a dot.
//
// `pingHealth`'s own `detail` assignments are pinned in `client.test.ts`. What
// these tests pin is the other half: that the word actually reaches the
// screen. Both components hardcoded "unreachable" for every `ok === false`
// until this plan's Phase 6, and `health-checks.tsx` prints the latency right
// beside it — so a service that answered in 8 ms read "unreachable · 8 ms".
// That is the display claiming more than the evidence supports, which is the
// defect class this whole plan exists to close.
//
// `components/**` is outside `vitest.config.mts`'s coverage `include`, so this
// logic cannot show up as uncovered either. Without these tests, reverting
// either component to the hardcoded string leaves the suite green.
// ══════════════════════════════════════════════════════════════════════

const pingHealth = vi.fn();
vi.mock('@/lib/api/client', () => ({ pingHealth: (...a: unknown[]) => pingHealth(...a) }));
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const { ConnectionStatus } = await import('@/components/layout/connection-status');
const { HealthChecks } = await import('@/components/observability/health-checks');

afterEach(() => {
  vi.clearAllMocks();
});

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const RESULTS: Array<[string, HealthResult, string]> = [
  ['a healthy service', { ok: true, latencyMs: 7, version: '1.0.0' }, 'healthy'],
  ['a service that answered and reported itself unwell', { ok: false, detail: 'degraded', latencyMs: 8 }, 'degraded'],
  ['a service that never answered', { ok: false, detail: 'unreachable', latencyMs: 30 }, 'unreachable'],
  // A HealthResult from before `detail` existed, or any future path that
  // forgets to set it. The old word is the safe default: it was the only
  // thing these surfaces said for every failure until now.
  ['a failure carrying no detail at all', { ok: false, latencyMs: 12 }, 'unreachable'],
];

describe('HealthChecks renders the failure kind, not just "unreachable"', () => {
  it.each(RESULTS)('says "%s" → %s', async (_label, result, word) => {
    pingHealth.mockResolvedValue(result);
    mount(<HealthChecks />);

    await waitFor(() => expect(screen.getAllByText(word).length).toBeGreaterThan(0));
  });

  it('shows a loading word before the first probe settles', async () => {
    pingHealth.mockImplementation(() => new Promise(() => {}));
    mount(<HealthChecks />);

    expect(screen.getAllByText('checking…').length).toBeGreaterThan(0);
    // And specifically NOT an assertion about reachability it cannot yet make.
    expect(screen.queryByText('unreachable')).toBeNull();
  });

  it('renders the degraded word beside the latency that contradicts "unreachable"', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
    mount(<HealthChecks />);

    await waitFor(() => expect(screen.getAllByText('degraded').length).toBeGreaterThan(0));
    expect(screen.getAllByText('8 ms').length).toBeGreaterThan(0);
  });
});

describe('ConnectionStatus titles the pill with the failure kind', () => {
  it.each(RESULTS)('says "%s" → %s', async (_label, result, word) => {
    pingHealth.mockResolvedValue(result);
    const { container } = mount(<ConnectionStatus label="Registry A" service="registry-a" />);

    await waitFor(() => {
      const titled = Array.from(container.querySelectorAll('[title]'))
        .map((el) => el.getAttribute('title') ?? '');
      expect(titled.some((t) => t.endsWith(`: ${word}`))).toBe(true);
    });
  });
});
