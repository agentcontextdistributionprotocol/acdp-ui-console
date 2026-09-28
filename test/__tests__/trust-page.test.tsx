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

/** All six flags on, the shape a post-#178 control plane always sends. */
const FEATURES_ON: NonNullable<TrustOverview['features']> = {
  receiptAudit: true,
  keyRevocationCheck: true,
  logWitness: true,
  logInclusionAudit: true,
  witnessCosigning: true,
  witnessQuorum: true,
};

function overview(
  runs: Array<{ runId: string; trust: RunTrustSummary }>,
  totals: Partial<TrustOverview['totals']> = {},
  features: TrustOverview['features'] = FEATURES_ON,
): TrustOverview {
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
    features,
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
      screen.getByText(/signed at\/after a compromise boundary, or signing time unverifiable/),
    ).toBeInTheDocument();
  });

  it('names its coverage: the gate is per-run but the number spans the view', () => {
    // One reporting run un-suppresses a total summed across every run in the
    // view, including runs that reported nothing — reachable on a deployment
    // that enabled the check recently, since older audit rows classify as
    // `none` and read as not-reported. The number is a lower bound and can
    // never hide a known violation, but the hint must not imply completeness.
    renderWith(
      overview(
        [
          { runId: 'r1', trust: trust({ revoked: [revocation('revoked_at_or_after')] }) },
          { runId: 'r2', trust: trust() },
          { runId: 'r3', trust: trust() },
        ],
        { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
      ),
    );
    expect(screen.getByText(/across the 1 of 3 runs that reported a classification/)).toBeInTheDocument();
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

// ══════════════════════════════════════════════════════════════════════
// The counter-only payload, on the aggregate surface.
//
// `/trust`'s violations filter and its table body read different things — the
// filter asks "is this run a violation", the body flat-maps the per-event
// arrays. A run admitted by aggregate counters it has no entries for would
// therefore contribute zero rows: present in the count above, invisible in the
// list below. That is the same false "nothing to see" as the original defect,
// reached from the other side.
// ══════════════════════════════════════════════════════════════════════
describe('/trust — a run whose fail-closed verdicts have no per-event detail', () => {
  const counterOnly = () =>
    overview(
      [
        {
          runId: 'run-counters-only',
          trust: trust({ revoked: [], keyRevocationRevokedAtOrAfter: 2 }),
        },
      ],
      { revokedEvents: 2, revokedRuns: 1, revocationReportedRuns: 1 },
    );

  it('is listed as a violation rather than falling into the empty state', () => {
    const { container } = renderWith(counterOnly());
    expect(screen.queryByText('No trust violations')).not.toBeInTheDocument();
    expect(container.textContent).toContain('run-counters-only');
  });

  it('contributes a row saying the count is known and the events are not', () => {
    const { container } = renderWith(counterOnly());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByText('reported without detail')).toBeInTheDocument();
    expect(screen.getByText(/2 fail-closed verdicts counted with no per-event detail/)).toBeInTheDocument();
  });

  it('DISCRIMINATES: the ordinary payload gets its event rows and no such row', () => {
    // Both sources populated from one row set — upstream's only real shape.
    // If the extra row were unconditional this would render three rows for two
    // findings, and the surface would over-report as reliably as it under-reported.
    const { container } = renderWith(
      overview(
        [
          {
            runId: 'run-detailed',
            trust: trust({
              revoked: [revocation('revoked_at_or_after', 'a'), revocation('revoked_time_unverifiable', 'b')],
              keyRevocationRevokedAtOrAfter: 1,
              keyRevocationRevokedTimeUnverifiable: 1,
            }),
          },
        ],
        { revokedEvents: 2, revokedRuns: 1, revocationReportedRuns: 1 },
      ),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.queryByText('reported without detail')).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The deployment flag on /trust, and — as importantly — what it must NOT do
// here (#97).
//
// `features` is DEPLOYMENT-scoped; every total on this page is RUN-scoped. A
// run audited before the flag was flipped keeps `key_revocation_status: 'none'`
// forever, so `keyRevocationCheck === true` with `revocationReportedRuns === 0`
// still cannot tell a clean estate from one whose runs predate the check. Only
// the `false` arm carries information this page may state, which is why the
// dashboard's `checked-clean` is deliberately NOT extended here.
// ══════════════════════════════════════════════════════════════════════
describe('/trust — the deployment revocation flag', () => {
  const RUN = [{ runId: 'run-quiet', trust: trust() }];
  const NONE = { revocationReportedRuns: 0 };

  it('says the check is off when the deployment says so', () => {
    const { container } = renderWith(
      overview(RUN, NONE, { ...FEATURES_ON, keyRevocationCheck: false }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Revocation checking is switched off on this deployment');
    // NOT "nothing was measured". This page's gate is
    // `revocationReportedRuns === 0`, which is satisfied precisely by runs that
    // WERE audited and found clean — so that wording claimed the opposite of
    // what the payload may hold, with no scope at all to soften it.
    // NOT "no figures are sent while it is off" either — that was a
    // replacement over-claim. These figures are RUN-scoped: `summarizeByRun`
    // always emits the three counters and `revoked: []`, so with the check off
    // they arrive as zeros and the suppression is this console's own. Saying
    // the control plane withheld them contradicts `run-trust-panel.tsx`, which
    // renders the correct explanation on the identical predicate.
    // Asserted with its scope attached. `toContain('the counters still
    // arrive')` on its own is satisfied by the unscoped sentence that round 5's
    // gate found false over an empty run set, so the phrase that makes it a
    // claim about audited runs is part of the pin.
    expect(text).toContain('the counters still arrive with every audited run');
    expect(text).toContain('a zero from a check that never ran is not a finding');
    expect(text).not.toContain('nothing was measured');
    expect(text).not.toMatch(/no figures are sent|stops sending/i);
    // And the card subtitle agrees with the KPI hint — two strings, one fact.
    expect(text).toContain('revocation checking off');
  });

  it('DISCRIMINATES: with no audited run at all it does NOT say counters arrive', () => {
    // Round 5's blocking finding, and the reason the arm above is gated on
    // `runs.length`. `revocationReportedRuns === 0` is satisfied vacuously by
    // an empty run set: `useTrust` keeps only the runs that came back carrying
    // a `trust` member, and `summarizeByRun` returns `null` outright for a run
    // with no audit rows. On the upstream default posture — `RECEIPT_AUDIT_
    // ENABLED=false`, which is also the only posture that FORCES the revocation
    // flag false — no run carries a summary, so nothing arrives and the
    // previous single sentence told the operator counters were flowing while
    // the console held none.
    //
    // The fixture is the payload the defect needed and the old test lacked:
    // zero runs, flag explicitly off.
    const { container } = renderWith(overview([], NONE, { ...FEATURES_ON, keyRevocationCheck: false }));
    const text = container.textContent ?? '';
    // Still says the deployment fact, which does not depend on any run…
    expect(text).toContain('Revocation checking is switched off on this deployment');
    // …but must not assert the arrival of counters it does not hold.
    expect(text).not.toContain('the counters still arrive');
    // It says the second fact positively rather than merely dropping the first.
    expect(text).toContain('no audited run reached this view');
    expect(text).toContain('no counters here at all, zero or otherwise');
    // And it still does not blame the control plane for the absence — a failed
    // detail fetch lands a run outside `runs` too, so the cause is not ours.
    expect(text).not.toMatch(/sent no|withheld|stops sending|no figures are sent/i);
  });

  it('the check-ON arm needs no such split: its claim is true over the empty set', () => {
    // The asymmetry that produced the defect, pinned so a future edit does not
    // "fix" this arm by making it positive too. "No run in this view carried a
    // revocation classification" is a NEGATIVE existential and holds over zero
    // runs; the sentence it replaced was positive and did not.
    const { container } = renderWith(overview([], NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).toContain('Not reported by this deployment — no run in this view carried a revocation classification');
    expect(text).not.toMatch(/counters .{0,20}arrive/i);
  });

  it('keeps the old not-reported wording when the check IS on', () => {
    // `true` + zero reporting runs is exactly the ambiguous case. The honest
    // sentence is the one that was already here.
    const { container } = renderWith(overview(RUN, NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).toContain('Not reported by this deployment — no run in this view carried a revocation classification');
    expect(text).not.toContain('switched off');
  });

  it('renders NO clean claim for check-on plus zero reporting runs', () => {
    // The assertion that keeps someone from "improving" this page by copying
    // the dashboard's `checked-clean` arm across. There is no wording of that
    // claim this page's data supports.
    const { container } = renderWith(overview(RUN, NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/classified nothing/i);
    expect(text).not.toMatch(/checking ran/i);
    expect(text).not.toMatch(/no(thing)? .{0,30}revoked/i);
  });

  it('a pre-#178 backend with no features keeps the old wording too', () => {
    const { container } = renderWith(overview(RUN, NONE, undefined));
    const text = container.textContent ?? '';
    expect(text).toContain('Not reported by this deployment');
    expect(text).not.toContain('switched off');
  });

  it('reads the flag as === false, never as falsy', () => {
    // The mirror of the dashboard's discipline. A wire payload with the flag
    // missing must not read as "the operator turned it off" — that is a claim
    // about a decision, drawn from an absence.
    const partial = { ...FEATURES_ON, keyRevocationCheck: undefined } as unknown as TrustOverview['features'];
    const { container } = renderWith(overview(RUN, NONE, partial));
    expect(container.textContent).not.toContain('switched off');
  });

  it('the flag changes nothing once runs DO report', () => {
    // The `false` arm is about an absence of measurement. Reported figures are
    // measurement, so they win regardless of what the deployment claims.
    const { container } = renderWith(
      overview(
        [{ runId: 'run-loud', trust: trust({ revoked: [revocation('revoked_at_or_after')], keyRevocationRevokedAtOrAfter: 1 }) }],
        { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
        { ...FEATURES_ON, keyRevocationCheck: false },
      ),
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('switched off');
    expect(text).toContain('1 revoked across 1 run');
  });
});
