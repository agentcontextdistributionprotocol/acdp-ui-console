// ══════════════════════════════════════════════════════════════════════
// The aggregate /trust page.
//
// The defect this locks down: a run carrying a live `revoked_at_or_after`
// verdict fell into the "No trust violations / Every audited receipt bound
// cleanly to its served context" empty state, because the violations filter
// read `flagged.length` alone. The page asserted the opposite of its own data.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpRun, RunTrustSummary } from '@/lib/types';
import type { TrustOverview } from '@/lib/hooks/use-trust';

const useTrust = vi.fn();
vi.mock('@/lib/hooks/use-trust', async (orig) => ({
  ...(await orig<typeof import('@/lib/hooks/use-trust')>()),
  useTrust: () => useTrust(),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import TrustPage from '@/app/trust/page';

type Revoked = NonNullable<RunTrustSummary['revoked']>;

function revocation(status: string, eventId = status): Revoked[number] {
  return {
    eventId,
    ctxId: 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status,
    boundary: '2026-08-01 00:00:00+00',
    trustClass: 'producer_signed',
    sources: [],
  };
}

function trust(over: Partial<RunTrustSummary> = {}): RunTrustSummary {
  return {
    audited: 2,
    verified: 2,
    verifiedHistorical: 0,
    structural: 0,
    noReceipt: 0,
    errors: 0,
    flagged: [],
    ...over,
  };
}

function overview(runs: Array<{ runId: string; trust: RunTrustSummary }>, totals: Partial<TrustOverview['totals']> = {}): TrustOverview {
  return {
    runs: runs.map((r) => ({
      run: { runId: r.runId, startedAt: '2026-09-25T00:00:00.000Z', completedAt: '2026-09-25T00:01:00.000Z' } as unknown as CpRun,
      trust: r.trust,
    })),
    totals: {
      audited: 0, verified: 0, verifiedHistorical: 0, structural: 0, noReceipt: 0, errors: 0,
      flaggedRuns: 0, flaggedEvents: 0, revokedRuns: 0, revokedEvents: 0, preCompromiseEvents: 0,
      revocationReportedRuns: 1,
      ...totals,
    },
    receiptCoverage: [],
    didMethods: [],
  };
}

function renderWith(data: TrustOverview) {
  useTrust.mockReturnValue({ isLoading: false, error: null, data });
  return render(<TrustPage />);
}

afterEach(() => {
  cleanup();
  useTrust.mockReset();
});

describe('/trust — the violations list', () => {
  it('a revoked-only run is listed, and the "No trust violations" empty state is NOT rendered', () => {
    const { container } = renderWith(
      overview(
        [{ runId: 'run-revoked-1', trust: trust({ revoked: [revocation('revoked_at_or_after')] }) }],
        { revokedEvents: 1, revokedRuns: 1 },
      ),
    );
    expect(screen.queryByText('No trust violations')).not.toBeInTheDocument();
    // …and it is actually SHOWN, not merely counted. The list flat-mapped
    // `flagged` alone, so a revoked-only run would have rendered an empty
    // table even once it passed the filter — the same false "nothing to see".
    expect(container.textContent).toContain('run-revoked-1');
    expect(screen.getByText('revoked_at_or_after')).toBeInTheDocument();
  });

  it('DISCRIMINATES: a pre_compromise-only run still shows the empty state', () => {
    // This is the half that proves the test above is not passing vacuously.
    // If the filter were inverted (or simply "any revoked entry"), this case
    // would fail — an authorized historical event is not a violation.
    renderWith(
      overview([{ runId: 'run-authorized', trust: trust({ revoked: [revocation('pre_compromise')] }) }], {
        preCompromiseEvents: 1,
      }),
    );
    expect(screen.getByText('No trust violations')).toBeInTheDocument();
  });

  it('a run with both mechanisms lists both findings', () => {
    const { container } = renderWith(
      overview(
        [
          {
            runId: 'run-both',
            trust: trust({
              flagged: [{ eventId: 'f1', ctxId: null, status: 'discrepancy', discrepancies: ['content_hash_mismatch:x'] }],
              revoked: [revocation('revoked_time_unverifiable')],
            }),
          },
        ],
        { flaggedEvents: 1, revokedEvents: 1 },
      ),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('content_hash_mismatch:x')).toBeInTheDocument();
    expect(screen.getByText('revoked_time_unverifiable')).toBeInTheDocument();
  });

  it('an authorized entry is not listed as a finding even on a run that has one', () => {
    const { container } = renderWith(
      overview(
        [
          {
            runId: 'run-mixed',
            trust: trust({ revoked: [revocation('pre_compromise'), revocation('revoked_at_or_after')] }),
          },
        ],
        { revokedEvents: 1, preCompromiseEvents: 1 },
      ),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.queryByText('pre_compromise')).not.toBeInTheDocument();
  });
});

describe('/trust — the revocation KPI', () => {
  it('its hint describes the SUM it actually renders, not one of the two statuses', () => {
    renderWith(overview([], { revokedEvents: 3 }));
    // Asserted verbatim: the old copy said only "signed at/after a compromise
    // boundary", which describes one of the two fail-closed statuses summed
    // into the number beside it.
    expect(
      screen.getByText('RFC-ACDP-0014 · signed at/after a compromise boundary, or signing time unverifiable'),
    ).toBeInTheDocument();
  });

  // ── Phase 3 ──────────────────────────────────────────────────────────
  it('renders an em-dash, not 0, when no run in this view reported a classification', () => {
    renderWith(overview([{ runId: 'r1', trust: trust() }], { revokedEvents: 0, revocationReportedRuns: 0 }));
    const kpi = screen.getByText('Revoked events').closest('.kpi-card') as HTMLElement;
    expect(kpi).toBeTruthy();
    // The VALUE node specifically — the not-reported hint beside it also
    // contains an em-dash, so asserting on the card's whole text would pass
    // even if the number were still rendered.
    expect(kpi.querySelector('.kpi-value')?.textContent).toBe('—');
    expect(kpi.textContent).toContain('Not reported by this deployment');
  });

  it('DISCRIMINATES: one reporting run brings the numeric 0 back', () => {
    // The paired mirror of the test above. A genuine "we checked, nothing was
    // revoked" is exactly what SHOULD read 0 — the fix must not swallow it —
    // so the two together prove the KPI discriminates rather than always
    // hiding the number.
    renderWith(overview([{ runId: 'r1', trust: trust() }], { revokedEvents: 0, revocationReportedRuns: 1 }));
    const kpi = screen.getByText('Revoked events').closest('.kpi-card') as HTMLElement;
    expect(kpi.querySelector('.kpi-value')?.textContent).toBe('0');
    expect(kpi.textContent).not.toContain('Not reported');
  });

  it('the violations card header does not restate the suppressed zero in prose', async () => {
    // Suppressing the KPI number while the card below reads "0 revoked across
    // 0 runs" would make exactly the unestablished claim the em-dash exists to
    // avoid, two inches lower and in words.
    renderWith(overview([{ runId: 'r1', trust: trust() }], { revocationReportedRuns: 0 }));
    const header = screen.getByText('Trust violations').closest('.feed-header, .card') as HTMLElement;
    expect(header.textContent).toContain('revocation not reported');
    expect(header.textContent).not.toContain('0 revoked across');
  });

  it('DISCRIMINATES: a reporting deployment gets the counts in prose', async () => {
    renderWith(
      overview([{ runId: 'r1', trust: trust() }], { revokedEvents: 2, revokedRuns: 1, revocationReportedRuns: 1 }),
    );
    const header = screen.getByText('Trust violations').closest('.feed-header, .card') as HTMLElement;
    expect(header.textContent).toContain('2 revoked across 1 run');
    expect(header.textContent).not.toContain('revocation not reported');
  });
});
