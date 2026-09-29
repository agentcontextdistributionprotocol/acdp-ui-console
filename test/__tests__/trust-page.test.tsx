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
import {
  ID_REFERENCE_ATTRS,
  NON_ANNOUNCING_ATTRS,
  TRUST_EMPTY,
  TRUST_KPI_CARDS,
  TRUST_KPI_HINT,
  TRUST_SECTION,
  TRUST_VIOLATIONS_SUB,
  TRUST_VIOLATIONS_COLUMNS,
  TRUST_VIOLATIONS_TITLE,
  expectedTrustViolationsBlocks,
  expectedTrustViolationsTableBlocks,
  normalize,
  squash,
  trustRevokedHint,
  trustViolationsSub,
} from '../support/revocation-prose';

const useTrust = vi.fn();
vi.mock('@/lib/hooks/use-trust', async (orig) => ({
  ...(await orig<typeof import('@/lib/hooks/use-trust')>()),
  useTrust: () => useTrust(),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { timeAgo } from '@/lib/utils/format';
import { formatCtxId } from '@/lib/utils/acdp';

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

/**
 * Refuse any attributed cause for an empty run set.
 *
 * `runs` is empty when the receipt audit is off upstream, when no run has been
 * audited yet, AND when every detail fetch failed (`use-trust.ts` catches those
 * to `null`). Those are indistinguishable from this side, so naming any one of
 * them is a guess presented as a finding — which is the defect class #97
 * exists to remove, arrived at from the other direction.
 *
 * IT IS NOT "shape, not sentence", which is what this docblock claimed for a
 * round. It is four conjunctions and a noun phrase, and round 7 went through it
 * four times without using any of them:
 *
 *   "; this deployment has the receipt-audit sweep switched off"
 *        `\breceipt audit\b` requires a SPACE, and the repo's own usual
 *        spelling is hyphenated. A semicolon is not `because`.
 *   "; the receipt-audit sweep is off on this deployment"   (check-ON arm)
 *   "; this deployment has the receipt-audit sweep off"     (empty-run state)
 *   "— the control plane had nothing to send"
 *        an attribution to the control plane that `page.tsx` explicitly
 *        forbids ("the cause is not ours to name"), reached with an em-dash.
 *
 * No colon, semicolon, em-dash or bare juxtaposition is refused — only four
 * conjunctions. KEEP IT as a fast, readable lint that names the offending
 * phrase; the guarantee is the closed-set pin below, which admits exactly one
 * string per arm and so has no paraphrase to miss.
 */
function assertNamesNoCause(text: string): void {
  for (const pattern of [
    /\bbecause\b/i,
    /\bdue to\b/i,
    /\bsince this deployment\b/i,
    /\breceipt audit\b/i,
    /\bsent no\b|\bwithheld\b|\bstops sending\b|\bno figures are sent\b/i,
  ]) {
    expect(text, `names a cause it cannot establish (\`${pattern}\`)`).not.toMatch(pattern);
  }
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

  // ══════════════════════════════════════════════════════════════════
  // THE CLOSED-WORLD PIN, the same instrument the dashboard card now uses
  // and for the same reason.
  //
  // This page had no shape guard at all: `assertNoUnscopedUniversal` is
  // dashboard-only and `assertNamesNoCause` refuses four conjunctions rather
  // than causes. Round 7 appended five different unlicensed claims here with
  // the whole suite green — a deployment-wide all-clear on the violations
  // card, and the same attributed cause on four separate arms, respelled with
  // a hyphen and a semicolon to slip both guards.
  //
  // Asking a pattern list "does this English sentence claim more than the
  // evidence licenses" is an open-world question. So the set of sentences is
  // closed instead: each arm renders exactly the string pinned in
  // `test/support/revocation-prose.ts`, and a paraphrase has nothing to evade.
  // ══════════════════════════════════════════════════════════════════
  const HINT_CASES = [
    ['off-with-runs', RUN, { ...FEATURES_ON, keyRevocationCheck: false }],
    ['off-no-runs', [], { ...FEATURES_ON, keyRevocationCheck: false }],
    ['on-with-runs', RUN, FEATURES_ON],
    ['on-no-runs', [], FEATURES_ON],
  ] as const;

  function revokedKpi(container: HTMLElement): string {
    const kpi = [...container.querySelectorAll('.kpi-card')].find((c) =>
      c.textContent?.includes('Revoked events'),
    );
    expect(kpi, 'no Revoked events KPI on the page').toBeTruthy();
    return (kpi as HTMLElement).querySelector('.kpi-delta')?.textContent ?? '';
  }

  it('every KPI hint arm renders EXACTLY its pinned text', () => {
    const seen = new Set<string>();
    for (const [key, runs, features] of HINT_CASES) {
      cleanup();
      const { container } = renderWith(overview([...runs], NONE, features));
      expect(revokedKpi(container), `hint arm \`${key}\` drifted from its pinned text`).toBe(
        TRUST_KPI_HINT[key],
      );
      seen.add(key);
    }
    // The payload list reaches every pinned arm — dropping one from
    // `HINT_CASES` fails here rather than silently un-checking it.
    expect([...seen].sort()).toEqual(Object.keys(TRUST_KPI_HINT).sort());
  });

  it('the four hint arms are distinct, so they cannot collapse onto one sentence', () => {
    const all = Object.values(TRUST_KPI_HINT);
    expect(new Set(all).size).toBe(all.length);
  });

  it('both violations empty states render EXACTLY their pinned text', () => {
    // The all-clear is the card that cost round 6 a blocking finding, and it
    // was guarded by `toContain` on one literal plus a `runs.length` split —
    // so "Nothing in this deployment binds badly." appended to it survived.
    cleanup();
    const { container: empty } = renderWith(overview([], NONE, FEATURES_ON));
    expect(empty.textContent).toContain(TRUST_EMPTY['no-runs'].title);
    expect(empty.textContent).toContain(TRUST_EMPTY['no-runs'].description);

    for (const n of [1, 3]) {
      cleanup();
      const runs = Array.from({ length: n }, (_, i) => ({ runId: `r${i}`, trust: trust() }));
      const { container } = renderWith(overview(runs, { revocationReportedRuns: 1 }, FEATURES_ON));
      expect(container.textContent).toContain(TRUST_EMPTY['no-violations'].title);
      // The count is IN the sentence, and singular/plural is part of the pin:
      // the claim is bounded by the run set it was drawn from.
      expect(container.textContent).toContain(TRUST_EMPTY['no-violations'].description(n));
    }
  });

  it('the violations empty states carry NOTHING beyond their pinned text', () => {
    // The pin above is `toContain`, because `EmptyState` renders an icon and
    // its own structure around the copy. That alone would admit an appended
    // sentence, which is exactly the escape being closed — so the empty
    // state's own text content is compared whole.
    cleanup();
    const { container } = renderWith(overview([], NONE, FEATURES_ON));
    const el = container.querySelector('.empty-state') as HTMLElement;
    expect(el, 'no .empty-state rendered — the scope of this guard is gone').toBeTruthy();
    expect(el.textContent).toBe(
      TRUST_EMPTY['no-runs'].title + TRUST_EMPTY['no-runs'].description,
    );

    cleanup();
    const { container: c2 } = renderWith(
      overview([{ runId: 'r0', trust: trust() }], { revocationReportedRuns: 1 }, FEATURES_ON),
    );
    const el2 = c2.querySelector('.empty-state') as HTMLElement;
    expect(el2.textContent).toBe(
      TRUST_EMPTY['no-violations'].title + TRUST_EMPTY['no-violations'].description(1),
    );
  });

  it('the violations subtitle renders EXACTLY its pinned revocation clause', () => {
    for (const [key, features] of [
      ['check-off', { ...FEATURES_ON, keyRevocationCheck: false }],
      ['not-reported', FEATURES_ON],
    ] as const) {
      cleanup();
      const { container } = renderWith(overview(RUN, NONE, features));
      const sub = container.textContent ?? '';
      expect(sub, `subtitle arm \`${key}\``).toContain(TRUST_VIOLATIONS_SUB[key]);
      // …and not the other arm's clause, which is what makes this a choice.
      const other = key === 'check-off' ? 'not-reported' : 'check-off';
      expect(sub).not.toContain(TRUST_VIOLATIONS_SUB[other]);
    }
  });

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
    // …and "every audited run" means the ones in THIS VIEW. Widening it to
    // "every audited run this deployment has ever recorded" left `toContain`
    // green while making the sentence false against a pre-Phase-14 backend,
    // where the three counters really are absent. `runs` is a bounded list
    // this page fetched; it is not the deployment's history.
    expect(text).not.toMatch(/\bever recorded\b|\bhas ever\b|\ball time\b/i);
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
    // The stated RESTRAINT, pinned as a shape. The negative above names four
    // specific wrong sentences, and round 6's gate walked past all four by
    // appending a different one — "…because this deployment has the receipt
    // audit switched off", which is a cause, and a cause this console cannot
    // establish. So: no causal connective may attach to the absence at all.
    assertNamesNoCause(text);
  });

  it('the check-ON arm stops attributing the absence to the deployment when nothing was audited', () => {
    // Round 6's gate, non-blocking: the trailing clause of this arm is a true
    // negative existential over the empty set, but its OPENING clause — "Not
    // reported by THIS DEPLOYMENT" — names a cause, on exactly the payload
    // where the sibling arm two lines up deliberately refuses to. The em-dash
    // reads as apposition, which is why it survived the split that fixed its
    // neighbour: it looks like a restatement and is an attribution.
    const { container } = renderWith(overview([], NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).toContain('Not reported in this view — no audited run reached it');
    expect(text).toContain('cannot tell from here why not');
    expect(text).not.toContain('Not reported by this deployment');
    expect(text).not.toMatch(/counters .{0,20}arrive/i);
    assertNamesNoCause(text);
  });

  it('DISCRIMINATES: with audited runs present, the deployment-scoped wording returns', () => {
    // The pair. Once a run HAS been audited and still reported no
    // classification, "not reported by this deployment" is a claim the payload
    // supports — and without this, the arm above could be satisfied by deleting
    // the deployment wording everywhere.
    const { container } = renderWith(overview(RUN, NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).toContain('Not reported by this deployment — no run in this view carried a revocation classification');
    expect(text).not.toContain('cannot tell from here why not');
  });

  it('never renders an all-clear over a view that audited nothing', () => {
    // Round 6's second blocking finding. The violations card's empty state is a
    // UNIVERSAL over `violationRuns`, so on an empty run set it is vacuously
    // true and reads as the page's flagship all-clear. `runs` is empty on the
    // upstream DEFAULT posture — receipt audit off — so the page rendered "no
    // audited run reached this view" in the KPI row and "Every audited receipt
    // bound cleanly to its served context" four inches below, in one paint.
    const { container } = renderWith(overview([], NONE, { ...FEATURES_ON, keyRevocationCheck: false }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('Every audited receipt bound cleanly');
    expect(text).toContain('No audited run reached this view');
    expect(text).toMatch(/nothing here has been checked, so nothing here can be reported clean/i);
  });

  it('DISCRIMINATES: an audited, violation-free view DOES get the all-clear, with its scope', () => {
    // The pair, and the reason the all-clear is not simply deleted: a clean
    // audited run set is a real, reportable state. It just has to say how many
    // runs it is speaking for — the sentence was a universal with no stated
    // domain, which is what let the empty set satisfy it.
    const { container } = renderWith(overview(RUN, NONE, FEATURES_ON));
    const text = container.textContent ?? '';
    expect(text).toContain('Every audited receipt bound cleanly to its served context, across the 1 run in this view');
    expect(text).not.toContain('No audited run reached this view');
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

// ══════════════════════════════════════════════════════════════════════
// THE WHOLE SURFACE, not just the empty states (round 9).
//
// `/trust`'s pins covered the Revoked-events caption, the violations
// subtitle's revocation clause and the two empty states. Everything else on the
// surface was open, and the gate walked through seven places at once — each
// mutation applied alone, each leaving the whole suite green:
//
//   · `· this estate is clean` appended to the page's section subtitle
//   · `· no key in this deployment has been revoked` appended to the
//     Historical KPI caption
//   · a caption added to the Flagged-events KPI, which has none:
//     "Everything else in this deployment bound cleanly"
//   · `· nothing else in this estate is revoked` appended to the Revoked-events
//     caption on its REPORTED arm, which the existing pin does not cover
//   · `· every receipt in this deployment is clean` appended to the violations
//     subtitle — past the clause pin, which is a `toContain` on one fragment
//   · the pre-compromise clause inverted to "(revoked keys, violations)",
//     and separately deleted outright
//   · a whole `<p>No key in this deployment has been revoked.</p>` inside the
//     violations CardBody, rendering in one paint with "No audited run reached
//     this view · Nothing here has been checked, so nothing here can be
//     reported clean"
//
// The last is round 6's blocking finding reconstructed verbatim. It was
// possible because every pin was a `toContain` on a fragment, and a fragment
// match cannot see what is beside it.
//
// So the KPI row and the violations card are pinned as CLOSED BLOCK LISTS:
// every label, figure and caption in order, and nothing outside them.
// ══════════════════════════════════════════════════════════════════════
describe('/trust — the KPI row and the violations card are a CLOSED set of blocks', () => {
  const RUN2 = [{ runId: 'run-quiet', trust: trust() }];
  const NONE2 = { revocationReportedRuns: 0 };

  /** Each KPI card's text, in DOM order: label, figure, caption (if any). */
  function kpiBlocks(container: HTMLElement): string[] {
    const grid = container.querySelector<HTMLElement>('.kpi-grid');
    expect(grid, 'no .kpi-grid — the scope of this guard is gone').toBeTruthy();
    return [...grid!.querySelectorAll<HTMLElement>('.kpi-card')].map((c) =>
      normalize(c.textContent),
    );
  }

  function violationsCard(container: HTMLElement): HTMLElement {
    const el = [...container.querySelectorAll<HTMLElement>('.card')].find(
      (c) => c.querySelector('h2')?.textContent === TRUST_VIOLATIONS_TITLE,
    );
    expect(el, 'no Trust violations card').toBeTruthy();
    return el!;
  }

  /**
   * The violations card's blocks, in document order — in EITHER state.
   *
   * ROUND 9's blocking finding, and the shape of it is worth recording. This
   * asserted `.empty-state` was present and read from it. When the card renders
   * a TABLE — the state in which it is actually reporting findings — the
   * assertion failed the test rather than pinning the card, so every caller
   * simply never rendered that state and the card went unpinned in the one
   * paint where an all-clear is most damaging. Measured: a `<p>` reading "No
   * key in this deployment has been revoked" inside the CardBody, above a
   * listed `revoked_at_or_after` row, passed 1028/1028.
   *
   * A guard that refuses to run on half its subject's states is not a narrower
   * guard. It is an absent one, with a passing test where the gap is.
   */
  function violationsBlocks(card: HTMLElement): string[] {
    const head = [...card.querySelectorAll<HTMLElement>('.card-header h2, .card-header .card-sub')];
    const empty = card.querySelector<HTMLElement>('.empty-state');
    if (empty) {
      // `EmptyState` renders an icon followed by a `<div>` per string, so its
      // element children below the icon ARE the title and the description. Read
      // separately rather than as one joined string, because an appended
      // sentence has to land in a block that then differs — a join would hide a
      // third `<div>` inside a longer string.
      const parts = [...empty.children].filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.tagName !== 'svg'.toUpperCase(),
      );
      return [...head, ...parts].map((n) => normalize(n.textContent));
    }
    const table = card.querySelector<HTMLElement>('table.data-table');
    expect(
      table,
      'the violations card renders neither an empty state nor a table — this guard lost its subject',
    ).toBeTruthy();
    // Every header and every cell, in document order. A cell is a block: a
    // finding rewritten, a column added, a row that should not be there and a
    // row missing all change this list.
    const cells = [...table!.querySelectorAll<HTMLElement>('th, td')];
    return [...head, ...cells].map((n) => normalize(n.textContent));
  }

  /**
   * HALF THREE, on both surfaces: nothing is ANNOUNCED that was not written
   * down.
   *
   * `textContent` cannot see an attribute. Round 9 got a deployment-wide
   * all-clear onto the pinned dashboard card through a text-free
   * `<div title="…" aria-label="…" />` with both existing halves green.
   *
   * Set EQUALITY, not an enumeration of bad values — a LOST announcement is a
   * defect too, and an enumeration of the bad set is the open-world mistake
   * this whole file exists to stop making. `KpiCard` mirrors its `hint` into a
   * `title`, so the legitimate set is exactly the hints the fixture produces.
   */
  function announcedIn(el: HTMLElement): string[] {
    const found: string[] = [];
    const structural = new Set<string>(NON_ANNOUNCING_ATTRS);
    for (const node of [el, ...el.querySelectorAll<HTMLElement>('*')]) {
      // ROUND 10: this walked a list of attributes that DO announce, which is
      // an open set — an `<input readOnly value="…">` put a whole unlicensed
      // sentence on this card with 1038/1038 green. It now walks EVERY
      // attribute and skips only the structural ones.
      for (const attr of node.attributes) {
        if (structural.has(attr.name.toLowerCase())) continue;
        if (attr.value.trim()) found.push(normalize(attr.value));
      }
    }
    return found;
  }

  function expectNothingAnnounced(el: HTMLElement, allowed: readonly string[], label?: string) {
    expect(new Set(announcedIn(el)), `${label ?? ''} — announced copy outside the pinned set`).toEqual(
      new Set(allowed.map(normalize)),
    );
    // An id reference can carry text in from outside the pinned surface, which
    // neither of the other halves reads. Required to resolve inside it.
    for (const node of [el, ...el.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of ID_REFERENCE_ATTRS) {
        for (const id of (node.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
          expect(
            el.querySelector(`#${CSS.escape(id)}`),
            `${attr}="${id}" points outside the pinned surface`,
          ).toBeTruthy();
        }
      }
    }
  }

  /**
   * The fourth half: everything written down is still REACHABLE.
   *
   * The other three bound what is ADDED; none can see a SUPPRESSION. An
   * `aria-hidden` on the violations table deletes every listed finding from the
   * accessibility tree while `textContent` is unchanged — which on a card whose
   * entire job is to report findings is the worst reading available. The
   * sibling #84 branch measured exactly that, green.
   *
   * `expected.length` is the anti-vacuity: a walk over no blocks asserts
   * nothing, and the block list is what the pin claims is on screen.
   */
  function silences(node: Element): boolean {
    return (
      node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden') || node.hasAttribute('inert')
    );
  }

  function expectNothingSilenced(el: HTMLElement, blocks: HTMLElement[], expectedCount: number, label?: string) {
    for (const block of blocks) {
      const said = normalize(block.textContent).slice(0, 40);
      // UP: any suppressing ancestor takes the whole block with it.
      for (let node: HTMLElement | null = block; node !== null; node = node.parentElement) {
        expect(silences(node), `${label ?? ''} — "${said}…" is inside a suppressed element`).toBe(false);
        if (node === el) break;
      }
      // DOWN, which the first version of this half did not do. The sibling #84
      // branch measured the ancestor-only walk: wrapping each fact's contents in
      // `<span aria-hidden="true">` left 1122/1122 green, because `textContent`
      // is unchanged and no ancestor carries the attribute. `inert` did the same
      // thing one element up.
      //
      // A suppressed descendant is only a defect if it SILENCES TEXT. A
      // decorative `<svg aria-hidden="true">` inside a block is correct markup
      // and this must not refuse it — so the rule is not "no suppressed
      // descendant" but "no suppressed descendant that says anything".
      for (const node of block.querySelectorAll('*')) {
        if (!silences(node)) continue;
        expect(
          normalize(node.textContent ?? ''),
          `${label ?? ''} — "${said}…" contains suppressed TEXT, which is announced to nobody`,
        ).toBe('');
      }
    }
    expect(blocks.length, `${label ?? ''} — the reachability walk visited no block`).toBe(
      expectedCount,
    );
  }

  function kpiGrid(container: HTMLElement): HTMLElement {
    const grid = container.querySelector<HTMLElement>('.kpi-grid');
    expect(grid, 'no .kpi-grid — the scope of this guard is gone').toBeTruthy();
    return grid!;
  }

  /**
   * The KPI row's expected blocks, DERIVED from `TRUST_KPI_CARDS`.
   *
   * Round 9: the previous version restated all five strings as literals beside
   * the table, so `TRUST_KPI_CARDS[*].hint` was read by nothing — replacing one
   * with `'ANYTHING AT ALL'` was green — and the table's whole purpose (one
   * place the copy lives) was decorative. `figures` and the varying
   * Revoked-events caption are the two things the table cannot hold.
   */
  function expectedKpiBlocks(figures: readonly string[], revokedHint: string): string[] {
    return TRUST_KPI_CARDS.map((c, i) =>
      normalize(c.label + figures[i] + (c.hint === null ? '' : c.hint === 'varies' ? revokedHint : c.hint)),
    );
  }

  /** Every hint the row renders — which `KpiCard` also mirrors into a `title`. */
  function expectedKpiAnnounced(revokedHint: string): string[] {
    return TRUST_KPI_CARDS.filter((c) => c.hint !== null).map((c) =>
      c.hint === 'varies' ? revokedHint : (c.hint as string),
    );
  }

  /** Half one of the KPI pin: the cards are exactly these, in order. */
  function expectKpiBlocksPinned(container: HTMLElement, expected: string[], label?: string) {
    expect(kpiBlocks(container), label).toEqual(expected);
  }

  /**
   * Half two: there is nothing in the ROW besides those cards.
   *
   * A NAMED function with its own guard-the-guard, which is the round-9
   * correction twice over. The half was missing entirely; written back as an
   * inline `expect` inside one test, deleting it was still silent. A pin half
   * that nothing exercises against a failing subject is indistinguishable from
   * no pin half at all, which is the lesson the violations card taught this
   * same file one describe below.
   */
  function expectNothingOutsideKpiRow(container: HTMLElement, expected: string[], label?: string) {
    expect(
      squash(kpiGrid(container).textContent),
      `${label ?? ''} — text in the KPI row outside its cards`,
    ).toBe(squash(expected.join('')));
  }

  it('pins every KPI card: five labels, five figures, and captions only where there are captions', () => {
    // Three of the five carry NO caption, and that absence is pinned — a
    // caption appearing where there was none is how one of the seven escapes
    // was written, and an absence is invisible to every `toContain` on the
    // page.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const expected = expectedKpiBlocks(['0', '0', '0', '—', '0'], TRUST_KPI_HINT['on-with-runs']);
    expectKpiBlocksPinned(container, expected);
    // The card labels and their order, stated against the shared table so the
    // literal list above cannot drift from it.
    expect(TRUST_KPI_CARDS.map((c) => c.label)).toEqual([
      'Verified',
      'Historical',
      'Flagged events',
      'Revoked events',
      'No receipt',
    ]);
  });

  it('pins that there is NOTHING ELSE in the KPI row', () => {
    // ROUND 9's second blocking finding. The row had a block list and no
    // "nothing outside" half, in a commit whose message said it had one:
    // `<p>Every receipt in this deployment is clean.</p>` inserted into
    // `.kpi-grid` BETWEEN two `.kpi-card`s survived 1028/1028. The same text
    // one element deeper — inside a card — was caught. A pin's scope is its
    // selector, not the sentence describing it.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const expected = expectedKpiBlocks(['0', '0', '0', '—', '0'], TRUST_KPI_HINT['on-with-runs']);
    expectNothingOutsideKpiRow(container, expected);
  });

  it('GUARDS THE GUARD: each KPI half REJECTS what only it can see', () => {
    // Each half alone, injected into the ACTUAL DOM. Deleting either from the
    // test above is otherwise silent — measured: removing the squash
    // comparison left the whole suite green, which is how the half came to be
    // missing in the first place.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const expected = expectedKpiBlocks(['0', '0', '0', '—', '0'], TRUST_KPI_HINT['on-with-runs']);
    expectKpiBlocksPinned(container, expected);
    expectNothingOutsideKpiRow(container, expected);

    // Between two cards: no block selector reads it, so only half two sees it.
    const stray = document.createElement('p');
    stray.textContent = 'Every receipt in this deployment is clean.';
    kpiGrid(container).appendChild(stray);
    expect(() => expectNothingOutsideKpiRow(container, expected)).toThrow();
    expect(() => expectKpiBlocksPinned(container, expected)).not.toThrow();
    stray.remove();

    // A STRUCTURE change that changes no text: move the first card's figure
    // out of the card and into the row beside it. The concatenation is
    // identical, so half two is blind; the block list is not, which is what
    // "the order and the count are part of the pin" means.
    const card = kpiGrid(container).querySelector('.kpi-card') as HTMLElement;
    const value = card.querySelector('.kpi-value') as HTMLElement;
    card.after(value);
    expect(() => expectNothingOutsideKpiRow(container, expected)).not.toThrow();
    expect(() => expectKpiBlocksPinned(container, expected)).toThrow();
  });

  it('pins each KPI tile’s ACCENT, including the fail-closed one', () => {
    // ROUND 9's third. `TRUST_KPI_CARDS` declared an `accent` per card and
    // NOTHING read it: repainting "Revoked events" — the tile that sums
    // `revoked_at_or_after` and `revoked_time_unverifiable` — from
    // `var(--danger)` to `var(--success)` was green, as was rewriting every
    // accent in the table.
    //
    // Colour is load-bearing on this surface by `lib/utils/revocation.ts`'s own
    // account: pre-compromise is historically AUTHORIZED and the dashboard
    // paints it green for that reason. A fail-closed count in the same green is
    // the inversion that module exists to prevent, and the dashboard half of
    // this very commit already pinned it.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const accents = [...kpiGrid(container).querySelectorAll<HTMLElement>('.kpi-card')].map((c) =>
      c.style.getPropertyValue('--kpi-accent'),
    );
    expect(accents).toEqual(TRUST_KPI_CARDS.map((c) => c.accent));
    // Anti-vacuity: a table of five identical accents would satisfy the line
    // above while distinguishing nothing.
    expect(new Set(accents).size, 'the accent table stopped distinguishing tiles').toBeGreaterThan(2);
  });

  it('pins what the KPI row ANNOUNCES, which no textContent pin can see', () => {
    // `KpiCard` mirrors its `hint` into `title={hint}`, so every caption is
    // also a tooltip. An added one is copy reaching a screen reader and a
    // hover with both text halves green.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    expectNothingAnnounced(
      kpiGrid(container),
      expectedKpiAnnounced(TRUST_KPI_HINT['on-with-runs']),
      'KPI row',
    );
  });

  it('pins the Revoked-events card on its REPORTED arm, which no pin reached', () => {
    // The arm that renders a FIGURE. Its caption states how much of the view
    // the number covers, and appending "nothing else in this estate is revoked"
    // to it was green.
    const { container } = renderWith(
      overview(
        [{ runId: 'r0', trust: trust({ revoked: [revocation('revoked_at_or_after')], keyRevocationRevokedAtOrAfter: 1 }) }],
        { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1, flaggedEvents: 0 },
        FEATURES_ON,
      ),
    );
    const revoked = kpiBlocks(container)[3];
    expect(revoked).toBe(normalize('Revoked events' + '1' + trustRevokedHint(1, 1)));
    // …and the whole row on that arm, so an added block beside the reported
    // tile is caught here too.
    const reported = expectedKpiBlocks(['0', '0', '0', '1', '0'], trustRevokedHint(1, 1));
    expectKpiBlocksPinned(container, reported, 'reported arm');
    expectNothingOutsideKpiRow(container, reported, 'reported arm');
  });

  it('pins the whole violations card in both empty states, and nothing else is in it', () => {
    for (const [label, runs, totals, empty, clause] of [
      // `revocationReportedRuns: 0` with the check ON is the not-reported
      // clause; one reporting run switches it to the figures.
      ['no runs', [], NONE2, 'no-runs', TRUST_VIOLATIONS_SUB['not-reported']],
      ['no violations', RUN2, { revocationReportedRuns: 1 }, 'no-violations', '0 revoked across 0 runs'],
    ] as const) {
      cleanup();
      const { container } = renderWith(overview([...runs], totals, FEATURES_ON));
      const card = violationsCard(container);
      const sub = trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: clause,
        preCompromiseEvents: 0,
      });
      const expected = expectedTrustViolationsBlocks({ sub, empty, runs: runs.length });
      expectPinnedViolations(card, expected, label);
    }
  });

  /**
   * HALF ONE of four: the blocks are exactly these, in order — wording,
   * structure, count.
   *
   * ROUND 10 CORRECTION. This docblock said "The pin, both halves" and then
   * listed two, the second of which describes `expectNothingOutside` — a
   * different function further down. A docblock that describes its neighbour's
   * work as its own is how a deleted call site goes unnoticed: a reader
   * checking that "the card contains nothing else" is covered finds the claim
   * here, above a function that does not make it. The composite
   * (`expectPinnedViolations`) is what calls all four, and the wiring test
   * below is what says it still does.
   */
  function expectBlocksPinned(card: HTMLElement, expected: string[], label?: string) {
    expect(violationsBlocks(card), label).toEqual(expected);
  }

  function expectNothingOutside(card: HTMLElement, expected: string[], label?: string) {
    expect(squash(card.textContent), `${label ?? ''} — text outside the pinned blocks`).toBe(
      squash(expected.join('')),
    );
  }

  /** The elements `violationsBlocks` read, for the reachability half. */
  function violationsBlockElements(card: HTMLElement): HTMLElement[] {
    const head = [...card.querySelectorAll<HTMLElement>('.card-header h2, .card-header .card-sub')];
    const empty = card.querySelector<HTMLElement>('.empty-state');
    if (empty) {
      const parts = [...empty.children].filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.tagName !== 'svg'.toUpperCase(),
      );
      return [...head, ...parts];
    }
    const table = card.querySelector<HTMLElement>('table.data-table');
    return [...head, ...(table ? [...table.querySelectorAll<HTMLElement>('th, td')] : [])];
  }

  /**
   * The halves are SEPARATE functions, and the split is not cosmetic: a
   * self-test asserting "this helper throws on a bad render" is satisfied by
   * either half throwing, so loosening one is invisible while the other still
   * fires. Measured — turning the block equality into a containment stayed
   * green through a guard-the-guard written the other way.
   *
   * ROUND 10 CORRECTION — IT WAS TWO HALVES, AND THE DOCBLOCK SAID THREE.
   * `d9d3f06`'s message claimed "a third half now pins the announced set on
   * both surfaces". On the dashboard that was true; here `expectNothingAnnounced`
   * was called by exactly two tests and NOT by this composite, so neither empty
   * state ever ran it. The gate put a text-free
   * `<div aria-label="No key in this deployment has been revoked." />` into the
   * card on `violationRuns.length === 0` and it was green at 1038/1038 — round
   * 9's escape, unchanged in mechanism, in the states the new half never ran
   * in.
   *
   * `allowed` is the announced set for this render. It is a parameter and not a
   * constant because `KpiCard` mirrors its `hint` into a `title`; the violations
   * card renders no hint, so every caller here passes `[]` and a LOST
   * announcement is a defect too.
   *
   * ROUND 11: there are FOUR halves now — the fourth is reachability, and it
   * was missing from both revocation surfaces. Rather than write the number
   * again in a third place, the wiring test below deletes each call from this
   * function in turn and requires the suite to notice; a count in prose cannot
   * do that, and three of them in this file had already drifted.
   */
  function expectPinnedViolations(
    card: HTMLElement,
    expected: string[],
    label?: string,
    allowed: readonly string[] = [],
  ) {
    expectBlocksPinned(card, expected, label);
    expectNothingOutside(card, expected, label);
    expectNothingAnnounced(card, allowed, label);
    expectNothingSilenced(card, violationsBlockElements(card), expected.length, label);
  }

  /**
   * Move the last word of one block into the start of the next, KEEPING the
   * character sequence identical — the injection only the BLOCK half can see.
   *
   * Half two compares the card's whole squashed `textContent` against the
   * blocks concatenated, so it is blind to where a boundary falls; half three
   * reads attributes; half four counts blocks and looks for suppression. Moving
   * a word across a boundary changes the block LIST and nothing else.
   *
   * NOT the `h2`, deliberately: `violationsCard()` finds the card BY its
   * heading, so moving a word out of it throws from the LOCATOR. Measured on
   * the sibling dashboard surface — the injection threw with the block half
   * deleted from the composite, and attributed nothing.
   */
  function moveWordAcrossBoundary(a: HTMLElement, b: HTMLElement): void {
    const text = a.textContent ?? '';
    const cut = text.lastIndexOf(' ');
    expect(cut, 'the donor block has no space to move a word across').toBeGreaterThan(0);
    b.textContent = text.slice(cut) + (b.textContent ?? '');
    a.textContent = text.slice(0, cut);
  }

  it('all four halves are WIRED IN to the violations composite, each by an injection only it sees', () => {
    // ROUND 10's NB2. Each half has its own guard-the-guard above, which says
    // the half WORKS. None of them says the composite CALLS it — and the
    // sibling #84 branch measured exactly that gap: `expectBlocksPinned` could
    // be deleted from its composite with 1122/1122 green, because the injection
    // chosen for it was also caught by another half.
    const emptyExpected = expectedTrustViolationsBlocks({
      sub: trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: '0 revoked across 0 runs',
        preCompromiseEvents: 0,
      }),
      empty: 'no-violations',
      runs: 1,
    });
    const injections: Array<[label: string, inject: (card: HTMLElement) => void]> = [
      [
        'a block boundary moved',
        (card) => {
          const sub = card.querySelector<HTMLElement>('.card-header .card-sub')!;
          const title = [...card.querySelectorAll<HTMLElement>('.empty-state > *')].filter(
            (n) => n.tagName !== 'SVG',
          )[0];
          moveWordAcrossBoundary(sub, title);
        },
      ],
      [
        'a stray element in the body',
        (card) => {
          const span = document.createElement('span');
          span.textContent = 'No key in this deployment has been revoked.';
          card.querySelector('.card-body')!.append(span);
        },
      ],
      [
        'an announced attribute',
        (card) => {
          card
            .querySelector('.empty-state')!
            .setAttribute('aria-label', 'Nothing in this deployment is revoked');
        },
      ],
      [
        'the pinned text SILENCED',
        (card) => {
          const parts = [...card.querySelectorAll<HTMLElement>('.empty-state > *')].filter(
            (n) => n.tagName !== 'SVG',
          );
          const target = parts[parts.length - 1];
          const span = document.createElement('span');
          span.setAttribute('aria-hidden', 'true');
          span.textContent = target.textContent;
          target.textContent = '';
          target.append(span);
        },
      ],
    ];
    for (const [label, inject] of injections) {
      cleanup();
      const { container } = renderWith(
        overview([{ runId: 'run-clean', trust: trust() }], { revocationReportedRuns: 1 }, FEATURES_ON),
      );
      const card = violationsCard(container);
      // The composite passes on the untouched render, so a throw below is the
      // injection and not the fixture.
      expectPinnedViolations(card, emptyExpected, `clean before ${label}`);
      inject(card);
      expect(
        () => expectPinnedViolations(violationsCard(container), emptyExpected, label),
        `the composite ADMITS ${label}`,
      ).toThrow();
    }
    expect(injections).toHaveLength(4);
  });

  it('GUARDS THE GUARD: the violations pin REJECTS an appended clause and a stray element', () => {
    // Loosening either half is silent otherwise — measured: turning the block
    // equality into a containment, and replacing the squash comparison with a
    // truthiness check, each left the whole suite green. The subject is the
    // HELPER, not two literals.
    cleanup();
    const { container } = renderWith(overview([], NONE2, FEATURES_ON));
    const card = violationsCard(container);
    const sub = trustViolationsSub({
      flaggedEvents: 0,
      flaggedRuns: 0,
      revocationClause: TRUST_VIOLATIONS_SUB['not-reported'],
      preCompromiseEvents: 0,
    });
    const expected = expectedTrustViolationsBlocks({ sub, empty: 'no-runs', runs: 0 });

    // It passes as rendered…
    expectPinnedViolations(card, expected);

    // …rejects extra text in what the CARD renders, in the direction the
    // escape actually runs. Appending to the EXPECTED list proves only that
    // `toEqual` distinguishes two arrays: it passes unchanged when the
    // assertion is loosened to admit appends, which is the loosening being
    // guarded against.
    //
    // Inside `.empty-state` first, where `violationsBlocks` reads — so this
    // lands in the block list and is caught by its equality.
    const extraBlock = document.createElement('div');
    extraBlock.textContent = 'No key in this deployment has been revoked.';
    card.querySelector('.empty-state')!.appendChild(extraBlock);
    expect(() => expectBlocksPinned(card, expected)).toThrow();
    extraBlock.remove();

    // …and an element added BESIDE the empty state, which the block selectors
    // do not read at all. This is round 6's blocking finding in miniature: a
    // deployment-wide all-clear rendered in the same paint as "nothing here
    // has been checked, so nothing here can be reported clean".
    //
    // Each half is exercised ALONE, for the reason given on
    // `expectPinnedViolations`.
    const stray = document.createElement('p');
    stray.textContent = 'Nothing in this deployment binds badly.';
    card.querySelector('.card-body')!.appendChild(stray);
    expect(() => expectNothingOutside(card, expected)).toThrow();
  });

  it('pins the whole violations card in its TABLE state, and nothing else is in it', () => {
    // ROUND 9's first blocking finding, and the state this card exists for.
    // `violationsBlocks` required `.empty-state`, so no pin applied here at
    // all — and a `<p>` reading "No key in this deployment has been revoked"
    // inside the CardBody, in one paint with the row below it, passed
    // 1028/1028. That is round 6's finding reconstructed inside the card this
    // module's docblock called closed.
    //
    // `timeAgo` and `formatCtxId` are imported rather than restated. They are
    // shared utilities with their own tests, not this page's formatting, and a
    // hand-written expectation of a relative timestamp would be a second clock.
    cleanup();
    const flagged = {
      eventId: 'f1',
      ctxId: 'acdp://registry-a.playground.local/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'discrepancy',
      discrepancies: ['content_hash_mismatch:x'],
    };
    const revoked = revocation('revoked_at_or_after');
    const { container } = renderWith(
      overview(
        [{ runId: 'run-live', trust: trust({ flagged: [flagged], revoked: [revoked] }) }],
        { flaggedEvents: 1, flaggedRuns: 1, revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
        FEATURES_ON,
      ),
    );
    const card = violationsCard(container);
    const when = timeAgo('2026-09-25T00:01:00.000Z');
    const sub = trustViolationsSub({
      flaggedEvents: 1,
      flaggedRuns: 1,
      revocationClause: '1 revoked across 1 run',
      preCompromiseEvents: 0,
    });
    const expected = expectedTrustViolationsTableBlocks({
      sub,
      rows: [
        ['run-live', formatCtxId(flagged.ctxId), flagged.status, 'content_hash_mismatch:x', when],
        [
          'run-live',
          formatCtxId(revoked.ctxId as string),
          revoked.status,
          `key revoked · boundary ${new Date(revoked.boundary).toLocaleString()} · ${revoked.trustClass}`,
          when,
        ],
      ],
    });
    expectPinnedViolations(card, expected, 'table state');
    expectNothingAnnounced(card, [], 'violations table');
    // Anti-vacuity on the column table itself: emptying it would make the
    // header half of every expectation above disappear silently.
    expect(TRUST_VIOLATIONS_COLUMNS.length, 'the column table emptied out').toBe(5);
    expect([...card.querySelectorAll('thead th')].map((t) => normalize(t.textContent))).toEqual([
      ...TRUST_VIOLATIONS_COLUMNS,
    ]);
  });

  it('pins the counter-only row, which reports a count and no events', () => {
    cleanup();
    const { container } = renderWith(
      overview(
        [{ runId: 'run-counters', trust: trust({ revoked: [], keyRevocationRevokedAtOrAfter: 2 }) }],
        { revokedEvents: 2, revokedRuns: 1, revocationReportedRuns: 1 },
        FEATURES_ON,
      ),
    );
    const card = violationsCard(container);
    const when = timeAgo('2026-09-25T00:01:00.000Z');
    const expected = expectedTrustViolationsTableBlocks({
      sub: trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: '2 revoked across 1 run',
        preCompromiseEvents: 0,
      }),
      rows: [
        [
          'run-counters',
          '—',
          'reported without detail',
          '2 fail-closed verdicts counted with no per-event detail',
          when,
        ],
      ],
    });
    expectPinnedViolations(card, expected, 'counter-only table');
  });

  // ══════════════════════════════════════════════════════════════════
  // THE VIOLATIONS CARD'S INPUT SPACE, ENUMERATED AND MAPPED.
  //
  // ROUND 10's B1. Every pin above picks a scenario by hand, and a hand-picked
  // scenario set bounds the cells somebody thought of. Two of the states this
  // card can actually be in had never been rendered anywhere in this file:
  //
  //   - MORE THAN ONE violation run. Every table test rendered exactly one, so
  //     the row loop's per-run behaviour — the run cell repeating, the row
  //     ORDER across runs, the counter row appearing once per run — was
  //     unbounded. `flatMap` over one element is the same program as `map`.
  //   - `revokedEvents === 0` WITH FINDINGS LISTED. The subtitle's revocation
  //     clause is composed from the TOTALS and the table from the per-run
  //     findings; they come from different places upstream and can disagree. A
  //     card that says "0 revoked across 0 runs" above a listed
  //     `revoked_at_or_after` row is the #97 defect exactly — a clean claim
  //     over a surface that is reporting a violation — and no pin could reach
  //     it, because every fixture made the two agree by construction.
  //
  // So the scenarios are DERIVED. The axes below are the inputs the card's copy
  // is a function of, read off `app/trust/page.tsx`:
  //
  //   runs           the audited run count in this view (0 / 1 / 2)
  //   finding        what each audited run carries
  //   reported       `totals.revocationReportedRuns > 0`, which gates the clause
  //   checkOff       `features.keyRevocationCheck === false`
  //   preCompromise  `totals.preCompromiseEvents > 0`, which adds a clause
  //   countersZeroed the totals disagree with the findings, as above
  //
  // and the EXPECTED COPY is composed by `trustViolationsSub` and the two
  // `expected*Blocks` helpers in `test/support/revocation-prose.ts`, which hold
  // hand copies. Nothing here reads a string off the page.
  //
  // WHAT IS HELD CONSTANT, stated rather than implied: the finding's STATUS
  // (`revoked_at_or_after`), the discrepancy text, the timestamps and the ctx
  // ids. Those are data the row renders verbatim, not arms of a decision — with
  // the one exception of the status, which selects a chip class, and that is
  // pinned separately below over every status the classifier knows.
  // ══════════════════════════════════════════════════════════════════
  type Finding = 'none' | 'flagged' | 'revoked' | 'counter' | 'both';
  type ViolationsInput = {
    runs: 0 | 1 | 2;
    finding: Finding;
    reported: boolean;
    checkOff: boolean;
    preCompromise: boolean;
    countersZeroed: boolean;
  };

  const FLAGGED_CTX = 'acdp://registry-a.playground.local/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const REVOKED_CTX = 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const BOUNDARY = '2026-08-01 00:00:00+00';
  const DISCREPANCY = 'content_hash_mismatch:x';
  const COUNTER_ONLY = 2;
  const WHEN = '2026-09-25T00:01:00.000Z';

  function runTrustFor(finding: Finding, n: number): RunTrustSummary {
    const flagged = [
      { eventId: `f${n}`, ctxId: FLAGGED_CTX, status: 'discrepancy', discrepancies: [DISCREPANCY] },
    ];
    const revoked = [{ ...revocation('revoked_at_or_after', `r${n}`), ctxId: REVOKED_CTX }];
    switch (finding) {
      case 'none':
        return trust();
      case 'flagged':
        return trust({ flagged });
      case 'revoked':
        return trust({ revoked });
      case 'counter':
        return trust({ revoked: [], keyRevocationRevokedAtOrAfter: COUNTER_ONLY });
      case 'both':
        return trust({ flagged, revoked });
    }
  }

  function totalsFor(i: ViolationsInput) {
    const carriesFlag = i.finding === 'flagged' || i.finding === 'both';
    const carriesRevoked = i.finding === 'revoked' || i.finding === 'both';
    const carriesCounter = i.finding === 'counter';
    const revokedEvents = (carriesRevoked ? i.runs : 0) + (carriesCounter ? i.runs * COUNTER_ONLY : 0);
    const revokedRuns = carriesRevoked || carriesCounter ? i.runs : 0;
    return {
      flaggedEvents: carriesFlag ? i.runs : 0,
      flaggedRuns: carriesFlag ? i.runs : 0,
      revokedEvents: i.countersZeroed ? 0 : revokedEvents,
      revokedRuns: i.countersZeroed ? 0 : revokedRuns,
      revocationReportedRuns: i.reported ? i.runs : 0,
      preCompromiseEvents: i.preCompromise ? 3 : 0,
    };
  }

  function expectedViolations(i: ViolationsInput): string[] {
    const tot = totalsFor(i);
    const clause = i.reported
      ? `${tot.revokedEvents} revoked across ${tot.revokedRuns} run${tot.revokedRuns === 1 ? '' : 's'}`
      : i.checkOff
        ? TRUST_VIOLATIONS_SUB['check-off']
        : TRUST_VIOLATIONS_SUB['not-reported'];
    const sub = trustViolationsSub({
      flaggedEvents: tot.flaggedEvents,
      flaggedRuns: tot.flaggedRuns,
      revocationClause: clause,
      preCompromiseEvents: tot.preCompromiseEvents,
    });
    if (i.finding === 'none') {
      return expectedTrustViolationsBlocks({
        sub,
        empty: i.runs === 0 ? 'no-runs' : 'no-violations',
        runs: i.runs,
      });
    }
    const when = timeAgo(WHEN);
    const rows: string[][] = [];
    for (let n = 0; n < i.runs; n += 1) {
      const runId = `run-${n}`;
      // The order is the component's: flagged rows, then the counter-only row,
      // then the fail-closed entries — per run, not per kind.
      if (i.finding === 'flagged' || i.finding === 'both') {
        rows.push([runId, formatCtxId(FLAGGED_CTX), 'discrepancy', DISCREPANCY, when]);
      }
      if (i.finding === 'counter') {
        rows.push([
          runId,
          '—',
          'reported without detail',
          `${COUNTER_ONLY} fail-closed verdicts counted with no per-event detail`,
          when,
        ]);
      }
      if (i.finding === 'revoked' || i.finding === 'both') {
        rows.push([
          runId,
          formatCtxId(REVOKED_CTX),
          'revoked_at_or_after',
          `key revoked · boundary ${new Date(BOUNDARY).toLocaleString()} · producer_signed`,
          when,
        ]);
      }
    }
    return expectedTrustViolationsTableBlocks({ sub, rows });
  }

  function reachableViolationsInputs(): ViolationsInput[] {
    const out: ViolationsInput[] = [];
    for (const runs of [0, 1, 2] as const) {
      for (const finding of ['none', 'flagged', 'revoked', 'counter', 'both'] as const) {
        for (const reported of [false, true]) {
          for (const checkOff of [false, true]) {
            for (const preCompromise of [false, true]) {
              for (const countersZeroed of [false, true]) {
                // With no audited run there is nothing to carry a finding, to
                // report a classification, or to count a pre-compromise event.
                if (runs === 0 && (finding !== 'none' || reported || preCompromise || countersZeroed)) {
                  continue;
                }
                const carriesRevocation =
                  finding === 'revoked' || finding === 'counter' || finding === 'both';
                // A run that carries a revocation verdict IS a reporting run —
                // that is what `revocationReportedRuns` counts upstream. The
                // inconsistency this file DOES model is the counter one below,
                // which is reachable because the totals and the per-run findings
                // are computed from different rows.
                if (carriesRevocation && !reported) continue;
                if (countersZeroed && !(reported && carriesRevocation)) continue;
                out.push({ runs, finding, reported, checkOff, preCompromise, countersZeroed });
              }
            }
          }
        }
      }
    }
    return out;
  }

  it('pins the violations card in EVERY reachable arm of its input space', () => {
    const inputs = reachableViolationsInputs();
    // Anti-vacuity on the enumeration: a filter that swallowed the space would
    // make this loop assert nothing at all.
    expect(inputs.length, 'the violations input enumeration collapsed').toBe(82);
    const label = (i: ViolationsInput) =>
      `runs=${i.runs} finding=${i.finding} reported=${i.reported} checkOff=${i.checkOff} ` +
      `pre=${i.preCompromise} zeroed=${i.countersZeroed}`;
    const groups = new Map<string, ViolationsInput[]>();
    for (const i of inputs) {
      cleanup();
      const { container } = renderWith(
        overview(
          Array.from({ length: i.runs }, (_, n) => ({
            runId: `run-${n}`,
            trust: runTrustFor(i.finding, n),
          })),
          totalsFor(i),
          i.checkOff ? { ...FEATURES_ON, keyRevocationCheck: false } : FEATURES_ON,
        ),
      );
      const expected = expectedViolations(i);
      expectPinnedViolations(violationsCard(container), expected, label(i));
      const key = JSON.stringify(expected);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    // ...and on the DERIVATION, which is the half a count alone does not give.
    // Two inputs producing an identical card means the card does not
    // distinguish two states -- the defect class this page is about -- so the
    // collisions are characterised, not merely counted. Measured: 50 distinct
    // cards over 82 inputs, and every one of the 32 collisions is the same
    // pair.
    expect(groups.size, 'the arms collapsed onto one another').toBe(50);
    for (const group of groups.values()) {
      if (group.length === 1) continue;
      // The ONLY axis whose two values may produce one card is `checkOff`, and
      // only once a run has reported -- at which point the clause is composed
      // from the counters and the deployment flag is correctly not consulted.
      // Any other collision is a state this card is failing to tell apart.
      expect(group.length, 'three inputs produced one card').toBe(2);
      const [a, b] = group;
      expect(
        a.reported && b.reported && a.checkOff !== b.checkOff,
        'two inputs produced one card for a reason other than the reported/checkOff pair: ' +
          `${label(a)} / ${label(b)}`,
      ).toBe(true);
      expect({ ...a, checkOff: false }, 'the colliding pair differs on more than checkOff').toEqual({
        ...b,
        checkOff: false,
      });
    }
  }, 120_000);

  it('pins the chip class of every revocation status the classifier knows', () => {
    // ROUND 10's B5. The finding cell's chip is read from
    // `revocationChipClass(r.status)`, and no pin read it AT THE CALL SITE:
    // `revocation.test.ts` covers the function, which says nothing about
    // whether this page still calls it. Measured in round 10: replacing the
    // call with a literal `'chip bad'` was green, and it makes a
    // HISTORICALLY AUTHORIZED entry render in danger red on the violations
    // list — the page stating the opposite of the fact.
    //
    // The expectations are HAND-WRITTEN, not derived by calling
    // `revocationChipClass` here: deriving them from the same function the
    // component calls would pass whatever that function returns, which is the
    // tautology this branch has found three times.
    const arms: Array<[status: string, chip: string]> = [
      ['revoked_at_or_after', 'chip bad'],
      ['revoked_time_unverifiable', 'chip warn'],
      ['pre_compromise', 'chip ok'],
    ];
    for (const [status, chip] of arms) {
      cleanup();
      const { container } = renderWith(
        overview(
          [{ runId: 'run-chip', trust: trust({ revoked: [revocation(status)], flagged: [] }) }],
          { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
          FEATURES_ON,
        ),
      );
      const card = violationsCard(container);
      const cells = [...card.querySelectorAll<HTMLElement>('tbody td span.chip, tbody td span[class^="chip"]')];
      const found = cells.find((c) => normalize(c.textContent) === status);
      // `pre_compromise` is historically authorized, so it is NOT a violation
      // and the run does not reach the table at all — which is itself the
      // claim, and is asserted rather than skipped.
      if (status === 'pre_compromise') {
        expect(found, 'a historically authorized entry is listed as a violation').toBeUndefined();
        expect(card.querySelector('.empty-state'), 'the card should be in an empty state').toBeTruthy();
        continue;
      }
      expect(found, `no chip for ${status}`).toBeTruthy();
      expect(found!.getAttribute('class'), `${status} renders the wrong chip`).toBe(chip);
    }
  });

  it('GUARDS THE GUARD: the TABLE state rejects an all-clear beside the findings', () => {
    // The exact escape, in the exact state. Each half alone, and injected into
    // the ACTUAL DOM — appending to the expected list would prove only that
    // `toEqual` distinguishes two arrays.
    cleanup();
    const { container } = renderWith(
      overview(
        [{ runId: 'run-live', trust: trust({ revoked: [revocation('revoked_at_or_after')] }) }],
        { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
        FEATURES_ON,
      ),
    );
    const card = violationsCard(container);
    const r = revocation('revoked_at_or_after');
    const when = timeAgo('2026-09-25T00:01:00.000Z');
    const expected = expectedTrustViolationsTableBlocks({
      sub: trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: '1 revoked across 1 run',
        preCompromiseEvents: 0,
      }),
      rows: [
        [
          'run-live',
          formatCtxId(r.ctxId as string),
          r.status,
          `key revoked · boundary ${new Date(r.boundary).toLocaleString()} · ${r.trustClass}`,
          when,
        ],
      ],
    });
    expectPinnedViolations(card, expected, 'before injection');

    // A `<p>` beside the table: no block selector reads it.
    const stray = document.createElement('p');
    stray.textContent = 'No key in this deployment has been revoked.';
    card.querySelector('.card-body')!.appendChild(stray);
    expect(() => expectNothingOutside(card, expected)).toThrow();
    stray.remove();

    // A rewritten CELL: caught by the block half, and the "nothing outside"
    // half is blind to a same-length swap only in the same total text — so a
    // changed finding is caught by half one specifically.
    const cell = card.querySelectorAll('tbody td')[2] as HTMLElement;
    cell.textContent = 'clean';
    expect(() => expectBlocksPinned(card, expected)).toThrow();
  });

  it('GUARDS THE GUARD: the table reader fails loudly when it loses its subject', () => {
    // The round-9 failure was a guard that REFUSED half its subject's states
    // and read as a narrower guard. This pins that it now refuses neither, and
    // that a card in neither state is a red test rather than a silent pass.
    cleanup();
    const { container } = renderWith(overview([], NONE2, FEATURES_ON));
    const card = violationsCard(container);
    expect(card.querySelector('.empty-state'), 'expected the empty state here').toBeTruthy();
    card.querySelector('.empty-state')!.remove();
    expect(() => violationsBlocks(card)).toThrow();
  });

  it('pins the pre-compromise clause of the subtitle, in both directions', () => {
    // Inverting it to "(revoked keys, violations)" states the precise falsehood
    // `lib/utils/revocation.ts` exists to prevent — pre-compromise events are
    // historically AUTHORIZED — and both inverting it and deleting it outright
    // were green before this test.
    cleanup();
    const { container } = renderWith(
      overview(RUN2, { revocationReportedRuns: 1, preCompromiseEvents: 4 }, FEATURES_ON),
    );
    const sub = normalize(
      violationsCard(container).querySelector<HTMLElement>('.card-sub')?.textContent,
    );
    expect(sub).toBe(
      trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: '0 revoked across 0 runs',
        preCompromiseEvents: 4,
      }),
    );
    // DISCRIMINATES: with none, the clause is absent entirely rather than
    // rendered as a zero.
    cleanup();
    const { container: c2 } = renderWith(
      overview(RUN2, { revocationReportedRuns: 1, preCompromiseEvents: 0 }, FEATURES_ON),
    );
    const sub2 = normalize(
      violationsCard(c2).querySelector<HTMLElement>('.card-sub')?.textContent,
    );
    expect(sub2).not.toContain('pre-compromise');
    expect(sub2).toBe(
      trustViolationsSub({
        flaggedEvents: 0,
        flaggedRuns: 0,
        revocationClause: '0 revoked across 0 runs',
        preCompromiseEvents: 0,
      }),
    );
  });

  it('pins the page’s section subtitle', () => {
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const el = container.querySelector<HTMLElement>('.section-title .sub');
    expect(el, 'no section subtitle').toBeTruthy();
    expect(normalize(el!.textContent)).toBe(TRUST_SECTION.sub);
    expect(normalize(container.querySelector('.section-title h1')?.textContent)).toBe(
      TRUST_SECTION.title,
    );
  });

  it('GUARDS THE GUARD: the demoted lint still rejects something', () => {
    // `assertNamesNoCause` is a lint in front of the pin, by its own docblock
    // — four conjunctions and a noun phrase, which round 7 walked past four
    // times. Turning its body into a no-op left the whole suite green, because
    // every call site passes text that already satisfies it. A lint that has
    // been quietly emptied reads as cover, so "someone emptied it" is a red
    // test here rather than a silent change.
    //
    // This is not a proof that the lint is adequate. It is not adequate; the
    // block pins above are the guarantee.
    expect(() =>
      assertNamesNoCause('No audited run reached this view because the sweep is off'),
    ).toThrow();
    expect(() =>
      assertNamesNoCause('No audited run reached this view, due to the receipt audit'),
    ).toThrow();
    expect(() =>
      assertNamesNoCause(TRUST_EMPTY['no-runs'].title + TRUST_EMPTY['no-runs'].description),
    ).not.toThrow();
  });

  it('GUARDS THE GUARD: the pinned KPI table is five distinct, ordered entries', () => {
    expect(TRUST_KPI_CARDS).toHaveLength(5);
    expect(new Set(TRUST_KPI_CARDS.map((c) => c.label)).size).toBe(5);
    // Exactly one card carries a fixed caption and one carries a varying one;
    // the other three carry none. An emptied table, or one that gave every
    // card a caption, would pin a row this page does not render.
    expect(TRUST_KPI_CARDS.filter((c) => c.hint === null)).toHaveLength(3);
    expect(TRUST_SECTION.sub.length).toBeGreaterThan(40);
    expect(squash('a b\n c')).toBe('abc');
    expect(normalize('a  b\n c')).toBe('a b c');
  });
});
