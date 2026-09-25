// ══════════════════════════════════════════════════════════════════════
// The dashboard's Key Revocation card.
//
// UI-2 gated the card on `{d.keyRevocation && …}`, on the premise that the
// control plane omits the field when `KEY_REVOCATION_CHECK_ENABLED=false`. It
// does not: `dashboard.service.ts` builds the object unconditionally with
// `?? 0` on every member and no reference to the flag — which defaults to
// false. So the shipped render was a green "Pre-compromise (authorized) 0", a
// red "Revoked at/after boundary 0" and an amber "Revoked time unverifiable 0"
// from a deployment that never checked anything.
//
// These tests come in discriminating pairs: for each "renders absent" case
// there is a sibling that differs only in the payload and demands the numbers
// back. Inverting the render condition, or deleting it, fails one of each pair
// — neither can pass on an empty render.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpDashboardOverview } from '@/lib/types';

const useDashboard = vi.fn();
vi.mock('@/lib/hooks/use-dashboard', () => ({ useDashboard: () => useDashboard() }));
vi.mock('@/lib/hooks/use-scenarios', () => ({ useScenarios: () => ({ data: [] }) }));
vi.mock('@/lib/hooks/use-global-events', () => ({ useGlobalEvents: () => ({ events: [], live: false }) }));
// recharts needs a measured container it never gets in jsdom, and this page
// loads it through `next/dynamic`. The chart is not what is under test.
vi.mock('@/components/charts/bar-chart-card', () => ({ BarChartCard: () => <div data-testid="chart" /> }));
// `RecentRunsTable` calls `useRouter`, which throws outside an App Router tree.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DashboardPage from '@/app/dashboard/page';

function overview(over: Partial<CpDashboardOverview> = {}): CpDashboardOverview {
  return {
    window: '24h',
    totalRuns: 4,
    totalContexts: 9,
    totalAgents: 2,
    recentRuns: [],
    byScenario: [],
    byRegistry: [{ registry_authority: 'registry-a.playground.local', event_count: 9 }],
    ...over,
  };
}

function renderWith(data: CpDashboardOverview) {
  useDashboard.mockReturnValue({ isLoading: false, error: null, data });
  return render(<DashboardPage />);
}

/** The Key Revocation card, located by its heading rather than by position. */
function revocationCard(): HTMLElement {
  const el = screen.getByText('Key Revocation').closest('.card');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

afterEach(() => {
  cleanup();
  useDashboard.mockReset();
});

describe('dashboard — Key Revocation with an all-zero payload', () => {
  it('keeps the card but renders NO figure — not even a 0', () => {
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    // Half one: the card is still there. A card that vanishes is
    // indistinguishable from a control plane that predates the feature.
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('Revocation checking is not reported by this deployment');
    // Half two: no numeric KPI inside it. Asserted structurally rather than by
    // searching for the string "0" — the citation `acdp-control-plane#176`
    // contains digits, and a substring check would be satisfied by them.
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(card.textContent).not.toContain('Pre-compromise (authorized)');
    expect(card.textContent).not.toContain('Revoked at/after boundary');
    expect(card.textContent).not.toContain('Revoked time unverifiable');
  });

  it('DISCRIMINATES: one non-zero count renders all three figures, zeros included', () => {
    // The 9 proves the check ran, which makes the two zeros beside it real
    // information rather than an unexamined default.
    renderWith(
      overview({ keyRevocation: { preCompromise: 9, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    const values = [...card.querySelectorAll('.kpi-value')].map((v) => v.textContent);
    expect(values).toEqual(['9', '0', '0']);
    expect(card.textContent).not.toContain('not reported by this deployment');
  });

  it('a pre-Phase-14 backend that omits the field lands in the same absent state', () => {
    renderWith(overview({ keyRevocation: undefined }));
    const card = revocationCard();
    expect(card.textContent).toContain('Revocation checking is not reported by this deployment');
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
  });

  it('names the upstream issue, so the provisional heuristic points somewhere', () => {
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    expect(revocationCard().textContent).toContain('acdp-control-plane#176');
  });

  it('records that the counters are window-scoped and counted at audit time', () => {
    // A retroactive re-audit deliberately never touches `checked_at` upstream,
    // so an amendment marking hundreds of older events fail-closed leaves this
    // card at its old figures while the per-run panel is current. An operator
    // reading the card cannot infer that; it has to be written down.
    renderWith(overview({ keyRevocation: { preCompromise: 1, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }));
    expect(revocationCard().textContent).toContain('a re-audit amending an event older than this window is not reflected here');
  });
});

describe('dashboard — Recent Runs', () => {
  it('shows no count when the window has no runs, rather than "Most recent 0"', () => {
    // The table already has its own "No runs yet" empty state; a count beside
    // it would be a header contradicting the body.
    renderWith(overview({ recentRuns: [] }));
    expect(screen.queryByText(/Most recent/)).toBeNull();
  });

  it('DISCRIMINATES: it does show the count when there are runs', () => {
    renderWith(overview({ recentRuns: [{ runId: 'r1' }] as unknown as CpDashboardOverview['recentRuns'] }));
    expect(screen.getByText('Most recent 1')).toBeInTheDocument();
  });
});

describe('dashboard — the window is selectable', () => {
  it('offers exactly the windows the control plane accepts', () => {
    renderWith(overview());
    const picker = screen.getByLabelText('Dashboard time window') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['1h', '6h', '24h', '7d', '30d']);
  });

  it('is reachable on the error path too, so a failed window is recoverable', () => {
    useDashboard.mockReturnValue({ isLoading: false, error: new Error('boom'), data: undefined });
    render(<DashboardPage />);
    expect(screen.getByLabelText('Dashboard time window')).toBeInTheDocument();
  });
});
