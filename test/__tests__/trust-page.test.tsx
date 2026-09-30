// ══════════════════════════════════════════════════════════════════════
// The aggregate /trust page.
//
// The defect this locks down: a run carrying a live `revoked_at_or_after`
// verdict fell into the "No trust violations / Every audited receipt bound
// cleanly to its served context" empty state, because the violations filter
// read `flagged.length` alone. The page asserted the opposite of its own data.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpRun, RunTrustSummary } from '@/lib/types';
import type { TrustOverview } from '@/lib/hooks/use-trust';
import { MAX_RUNS } from '@/lib/hooks/use-trust';
import {
  ID_REFERENCE_ATTRS,
  NON_ANNOUNCING_ATTRS,
  SUPPRESSING_ATTRS,
  cssCustomProperties,
  readsAs,
  specificity,
  inlineStyleDeclarations,
  lastRuleFor,
  resolvedColour,
  suppressorOn,
  unreadMemberPostures,
  TRUST_EMPTY,
  TRUST_KPI_CARDS,
  TRUST_KPI_HINT,
  TRUST_SECTION,
  TRUST_VIOLATIONS_SUB,
  TRUST_VIOLATIONS_COLUMNS,
  TRUST_VIOLATIONS_TITLE,
  TRUST_VIOLATIONS_CAPTION,
  TRUST_VIOLATIONS_TABLE_SCROLL_LABEL,
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

/**
 * `next/link`, mocked as the `<a>` it actually renders — props and all.
 *
 * ── ROUND 11's B2: THE MOCK WAS A HOLE IN THE PIN ────────────────────
 *
 * It used to be `({ children }) => <span>{children}</span>`, which keeps the
 * text and DISCARDS every other prop. The violations table's only interactive
 * element is this link, so anything hung on it was outside every pin on that
 * card. Measured, on `app/trust/page.tsx`'s run cell:
 *
 *   <Link href={…} aria-label="No key in this deployment has been revoked."
 *                  title="No key in this deployment has been revoked.">
 *
 * 42 files / 1045 tests green. In the app that renders an `<a>` carrying both
 * attributes, so EVERY run row in the table announces a deployment-wide
 * all-clear — to a screen reader and on hover — in the same paint as a listed
 * `revoked_at_or_after` finding. That is round 9's escape mechanism, in the
 * state round 9's blocking finding was about, reached through the one element
 * of the pinned table the test replaced with something simpler.
 *
 * `expectNothingAnnounced` was live and correct the whole time — it kills an
 * `<input readOnly value>` at 15 failures across both files. It simply never
 * saw these attributes, because the mock had already thrown them away. A mock
 * that renders LESS than the component is a pin that covers less than it says,
 * and nothing in the file disclosed the difference.
 *
 * `href` and `style` are on `NON_ANNOUNCING_ATTRS`, so forwarding them changes
 * no expectation; what changes is that an announcing attribute now arrives
 * where the pin can see it.
 */
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: React.ComponentProps<'a'>) => <a {...rest}>{children}</a>,
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
    // #115 defaults: no read failure in the ordinary fixture, and the
    // denominator matches the (pre-filter) run count this helper was given.
    readFailures: 0,
    runsRequested: runs.length,
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
    // `revocationReportedRuns` (the `overview()` default is 1) can never
    // exceed `runs.length` — it counts a subset of the runs in the view.
    // The original fixture paired it with `runs: []`, so the hint this test
    // exists to pin ("across the N of M runs…") rendered the nonsensical
    // "across the 1 of 0 runs that reported a classification" — a bug the
    // old partial-regex assertion below could not have caught, since it
    // never looked at the coverage clause at all.
    renderWith(overview([{ runId: 'r1', trust: trust() }], { revokedEvents: 3 }));
    // Asserted verbatim: the old copy said only "signed at/after a compromise
    // boundary", which describes one of the two fail-closed statuses summed
    // into the number beside it.
    expect(
      screen.getByText(
        'RFC-ACDP-0014 · signed at/after a compromise boundary, or signing time unverifiable · across the 1 of 1 runs that reported a classification',
      ),
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
    // The `sr-only` caption TableScroll requires precedes the header row in
    // document order — a block like any other: dropped or reworded, this
    // guard is the only thing that notices, since it is invisible on screen.
    const caption = table!.querySelector<HTMLElement>('caption');
    expect(caption, 'the violations table renders no caption — TableScroll requires one').toBeTruthy();
    // Every header and every cell, in document order. A cell is a block: a
    // finding rewritten, a column added, a row that should not be there and a
    // row missing all change this list.
    const cells = [...table!.querySelectorAll<HTMLElement>('th, td')];
    return [...head, caption!, ...cells].map((n) => normalize(n.textContent));
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
   * ROUND 11's B3: that sentence named the ancestor case as this half's reason
   * for existing, and nothing exercised it. The wiring test's fourth injection
   * wraps a block's CONTENTS in `<span aria-hidden="true">`, which is a
   * descendant, so deleting the upward loop was 42 files / 1045 tests green on
   * both surfaces while the identical defect it is meant to catch —
   * `aria-hidden` on the violations table — is 4 red with it intact.
   * Load-bearing and unguarded. There is a fifth injection now, an ancestor
   * suppression, so each branch has an owner.
   *
   * `expected.length` is the anti-vacuity: a walk over no blocks asserts
   * nothing, and the block list is what the pin claims is on screen.
   */
  // ROUND 13's B4. This was a local copy of a three-attribute predicate, and
  // the dashboard had its own. One definition now, in the prose module, for
  // the reason round 11's B4 gave: the two surfaces differing by one line is a
  // property of having two copies, not of either copy being wrong.
  const silences = (node: Element, from?: Element | null): boolean =>
    suppressorOn(node, from) !== null;

  function expectNothingSilenced(el: HTMLElement, blocks: HTMLElement[], expectedCount: number, label?: string) {
    for (const block of blocks) {
      // `el` is the surface this pin is ABOUT, and every block must be inside
      // it — a block list assembled from somewhere else would make the walk
      // below true of a subtree nobody is pinning. It is no longer where the
      // walk STOPS; see below.
      expect(el.contains(block), `${label ?? ''} — a pinned block is not inside the pinned surface`).toBe(
        true,
      );
      const said = normalize(block.textContent).slice(0, 40);
      // UP: any suppressing ancestor takes the whole block with it — to the
      // DOCUMENT, not to the pinned surface.
      //
      // ROUND 11's B4. This carried `if (node === el) break;` and the dashboard's
      // copy of the same walk did not, and that one line is the whole difference
      // between the two surfaces. Measured: `<div className="page"
      // aria-hidden="true">` on `app/trust/page.tsx` was 42 files / 1045 tests
      // green, while the identical mutation on `app/dashboard/page.tsx` was 6
      // red. Suppression is INHERITED — an ancestor above the card removes the
      // card from the accessibility tree exactly as an ancestor inside it does —
      // so stopping the walk at the pin's own scope reads as "this surface is
      // reachable" while the page around it is not. A pin's scope bounds what it
      // may ASSERT ABOUT, not how far a fact about it reaches.
      // ROUND 14's B9: `from` is the child the walk arrived from. A closed
      // `<details>` hides everything except its `<summary>`, so the walk has to
      // know which way it came in; an upward walk that does not track that
      // cannot tell a hidden block from a visible summary.
      for (
        let node: HTMLElement | null = block, from: HTMLElement | null = null;
        node !== null;
        from = node, node = node.parentElement
      ) {
        expect(
          silences(node, from),
          `${label ?? ''} — "${said}…" is inside a suppressed element`,
        ).toBe(false);
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
    // ── ROUND 13's B4: THE STYLING CHANNEL THESE PAGES ACTUALLY USE ────
    //
    // The three attributes above are the ARIA/HTML suppressors and they really
    // are closed. The STYLING suppressors are not — `display`, `visibility`,
    // `opacity`, `font-size: 0`, `clip-path`, `color: transparent`,
    // `content-visibility`, `transform: scale(0)` and whatever is next — and
    // `<div className="kpi-grid" style={{ display: 'none' }}>` was 42 files /
    // 1050 tests green while `aria-hidden="true"` on the SAME element is 3
    // red. `display: none` is the strictly stronger suppression.
    //
    // The excuse written beside this walk was "jsdom applies no stylesheet".
    // jsdom reflects an INLINE style exactly, and `CLAUDE.md` mandates inline
    // styles here, so the one styling channel these pages use is the one that
    // sentence excused itself from.
    //
    // A denylist of suppressing properties is an open set. So the ALLOW side
    // is bounded: every inline declaration on and above this surface is
    // pinned, and a new one is a reviewable diff whatever it sets.
    for (const decl of inlineStyleDeclarations(el, blocks)) {
      expect(
        INLINE_STYLES_ON_TRUST,
        `${label ?? ''} — the inline style \`${decl}\` is on or above the pinned surface and is not pinned`,
      ).toContain(decl);
    }
  }

  /**
   * Every inline style declaration the `/trust` page puts on or above a pinned
   * surface, as `<tag.class> prop: value`.
   *
   * Measured, not chosen. The page styles with the `C.*` tokens per
   * `CLAUDE.md`, so this is short and it is the closed side of the suppression
   * bound: `display: none`, `visibility: hidden`, `opacity: 0` and every other
   * spelling all land here as an unpinned entry.
   */
  const INLINE_STYLES_ON_TRUST: readonly string[] = [
    'a color: var(--info)',
    'div align-items: center',
    'div color: var(--muted)',
    'div display: flex',
    'div flex-direction: column',
    'div font-size: 11px',
    'div font-size: 13px',
    'div gap: 3px',
    'div gap: 8px',
    'div max-width: 360px',
    'div.card margin-bottom: 12px',
    'div.kpi-card --kpi-accent: var(--danger)',
    'div.kpi-card --kpi-accent: var(--muted)',
    'div.kpi-card --kpi-accent: var(--success)',
    'div.kpi-card --kpi-accent: var(--warning)',
    'div.kpi-delta color: var(--muted)',
    'div.kpi-delta font-size: 10.5px',
    'div.kpi-delta font-weight: 400',
    'span.did color: var(--danger)',
    'span.did font-size: 10.5px',
    'td color: var(--muted)',
  ] as const;

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

  /**
   * Half FOUR of the KPI pin: the row is still REACHABLE.
   *
   * ── ROUND 11's B4: THE ROW HAD THREE HALVES, NOT FOUR ────────────────
   *
   * `43f24e4`'s message says "the reachability half … Both surfaces now walk
   * descendants too", and `expectPinnedViolations`'s docblock says "there are
   * FOUR halves now — the fourth is reachability, and it was missing from both
   * revocation surfaces". Both sentences are about the violations card.
   * `expectNothingSilenced` appeared at exactly two places in this file — its
   * definition and its one call inside `expectPinnedViolations` — so the KPI
   * row, which `revocation-prose.ts` names as one of the three pinned surfaces,
   * had the three ADDING halves and no suppression half at all.
   *
   * Measured: `<div className="kpi-grid" aria-hidden="true">` on
   * `app/trust/page.tsx` was 42 files / 1045 tests green. The Revoked-events
   * tile's figure — the em-dash that says a count was never taken, and the
   * number that says it was — leaves the accessibility tree with every text
   * pin on this page unchanged.
   *
   * The blocks are the CARDS, which is the same granularity `kpiBlocks` pins,
   * so the count assertion inside the walk is `TRUST_KPI_CARDS.length` and a
   * row that lost a tile is red here as well as there.
   */
  function expectKpiRowReachable(container: HTMLElement, label?: string) {
    const grid = kpiGrid(container);
    expectNothingSilenced(
      grid,
      [...grid.querySelectorAll<HTMLElement>('.kpi-card')],
      TRUST_KPI_CARDS.length,
      `${label ?? ''} KPI row`,
    );
  }

  it('pins every KPI card: five labels, five figures, and captions only where there are captions', () => {
    // Three of the five carry NO caption, and that absence is pinned — a
    // caption appearing where there was none is how one of the seven escapes
    // was written, and an absence is invisible to every `toContain` on the
    // page.
    const { container } = renderWith(overview(RUN2, NONE2, FEATURES_ON));
    const expected = expectedKpiBlocks(['0', '0', '0', '—', '0'], TRUST_KPI_HINT['on-with-runs']);
    expectKpiBlocksPinned(container, expected);
    // ROUND 11's B4: and still reachable, which no text pin can see.
    expectKpiRowReachable(container);
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
    const valueHome = value.nextSibling;
    card.after(value);
    expect(() => expectNothingOutsideKpiRow(container, expected)).not.toThrow();
    expect(() => expectKpiBlocksPinned(container, expected)).toThrow();
    card.insertBefore(value, valueHome);
    expectKpiBlocksPinned(container, expected);

    // ROUND 11's B4, half four. A SUPPRESSION changes no text at all, so both
    // halves above are blind to it by construction: `aria-hidden` on the row
    // takes all five tiles out of the accessibility tree with every character
    // still in `textContent`. Measured on the real page at 1045/1045 green.
    const grid = kpiGrid(container);
    expectKpiRowReachable(container, 'before injection');
    grid.setAttribute('aria-hidden', 'true');
    expect(() => expectNothingOutsideKpiRow(container, expected)).not.toThrow();
    expect(() => expectKpiBlocksPinned(container, expected)).not.toThrow();
    expect(() => expectKpiRowReachable(container, 'row suppressed')).toThrow();
    grid.removeAttribute('aria-hidden');

    // …and an ANCESTOR of the row, which is the arm that carried `break` until
    // round 11 and is the reason the dashboard caught this mutation and this
    // page did not. Suppression is inherited; the pin's scope is not a wall.
    const page = container.querySelector<HTMLElement>('.page') ?? (container.firstElementChild as HTMLElement);
    expect(page, 'the page wrapper is gone — this case tests nothing').toBeTruthy();
    page.setAttribute('aria-hidden', 'true');
    expect(() => expectKpiRowReachable(container, 'page suppressed')).toThrow();
    page.removeAttribute('aria-hidden');
    expectKpiRowReachable(container, 'restored');
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

  it('pins the KPI row on a posture where EVERY figure is non-zero', () => {
    // ROUND 11's NB1. Every KPI pin in this file expected `['0','0','0','—','0']`
    // or `['0','0','0','1','0']`, because `totalsFor` never populates
    // `verified`, `verifiedHistorical` or `noReceipt` — three of the five
    // figures were held at zero by every fixture on the page. A coordinate on
    // one of them is then unreachable: `hint={t.verified > 0 ? 'Every receipt
    // in this deployment verified clean — no key has been revoked' : undefined}`
    // on the Verified tile was 42 files / 1045 tests green, and it is an
    // ANNOUNCED all-clear, since `KpiCard` mirrors every hint into a `title`.
    //
    // All five non-zero, and all five DISTINCT, so a row that stopped reading
    // one of the five and printed a neighbour's figure is red here too.
    const { container } = renderWith(
      overview(
        RUN2,
        {
          verified: 4,
          verifiedHistorical: 2,
          flaggedEvents: 7,
          revokedEvents: 3,
          revokedRuns: 1,
          noReceipt: 5,
          revocationReportedRuns: 1,
        },
        FEATURES_ON,
      ),
    );
    const hint = trustRevokedHint(1, 1);
    const expected = expectedKpiBlocks(['4', '2', '7', '3', '5'], hint);
    expectKpiBlocksPinned(container, expected, 'non-zero row');
    expectNothingOutsideKpiRow(container, expected, 'non-zero row');
    expectNothingAnnounced(kpiGrid(container), expectedKpiAnnounced(hint), 'non-zero KPI row');
    expectKpiRowReachable(container, 'non-zero row');
    // Anti-vacuity on the fixture, not on the pin: five figures that were all
    // the same number would satisfy every assertion above while proving that
    // each tile reads its own field only by coincidence.
    expect(new Set(['4', '2', '7', '3', '5']).size, 'the non-zero fixture stopped distinguishing tiles').toBe(5);
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
    const caption = table?.querySelector<HTMLElement>('caption');
    return [...head, ...(caption ? [caption] : []), ...(table ? [...table.querySelectorAll<HTMLElement>('th, td')] : [])];
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
   * card renders no hint, so a LOST announcement is a defect too.
   *
   * Its default is DERIVED from `expected` rather than hand-passed at each call
   * site: `TableScroll` puts a real `aria-label` on the table state's wrapper —
   * an attribute, so `announcedIn()` sees it and a block-only `expected` array
   * does not — and `expected` already says unambiguously which state this
   * render is in, since only `expectedTrustViolationsTableBlocks` includes
   * `TRUST_VIOLATIONS_CAPTION`. Deriving it here means the ~15 call sites below
   * cannot individually forget the label the way a hand-typed `allowed` at each
   * one could; a call that overrides it explicitly still can, for the one case
   * that needs a different announced set.
   *
   * ROUND 10: there are FOUR halves now — the fourth is reachability, and it
   * was missing from both revocation surfaces. Rather than write the number
   * again in a third place, the wiring test below deletes each call from this
   * function in turn and requires the suite to notice; a count in prose cannot
   * do that, and three of them in this file had already drifted.
   *
   * ROUND 11 CORRECTION, twice, and both are the same shape as everything else
   * in this file's history — a sentence with a wider scope than its code:
   *
   *   · "missing from both revocation SURFACES" was written about the two
   *     CARDS. `/trust` has three pinned surfaces, not two, and the KPI row —
   *     which `revocation-prose.ts` names as one of them — had the three adding
   *     halves and no reachability half at all. `aria-hidden` on `.kpi-grid`
   *     was 1045/1045 green. `expectKpiRowReachable` is that half.
   *   · The fourth half has TWO branches, up and down, and only the downward
   *     one had an injection — so deleting the ancestor walk outright was
   *     1045/1045 green on both surfaces while it was the branch the half's own
   *     docblock names as its reason for existing. There is a fifth injection
   *     now, one per branch.
   */
  function expectPinnedViolations(
    card: HTMLElement,
    expected: string[],
    label?: string,
    allowed: readonly string[] = expected.includes(TRUST_VIOLATIONS_CAPTION)
      ? [TRUST_VIOLATIONS_TABLE_SCROLL_LABEL]
      : [],
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

  // ══════════════════════════════════════════════════════════════════
  // MEASURED (round 12). Thirteen mutations, each applied ALONE from a clean
  // tree under `tsc --noEmit` plus this file and `dashboard-revocation.test.tsx`,
  // reverted and `git status` verified clean between each. Every one of round
  // 11's five blocking findings, reproduced verbatim from its report, is now
  // KILLED, and so are both non-blocking coordinates:
  //
  //   B1  `{runs.length > 2 && <p>No key…revoked.</p>}`        → 2 red
  //   B1b the same gate at `> 20`, above the cross product      → 1 red
  //       (the whole-axis sweep alone — which is what it is for)
  //   B2  `aria-label` + `title` on the run `<Link>`            → 6 red
  //   B3a the ancestor walk deleted (/trust)                    → 2 red
  //   B3b the ancestor walk deleted (dashboard)                 → 1 red
  //   B4a `aria-hidden` on the `/trust` page wrapper            → 13 red
  //   B4b `aria-hidden` on `.kpi-grid`                          → 3 red
  //   B5a `.chip.bad` repainted `var(--success)` in globals.css → 1 red
  //   B5b flagged row `chip bad` → `chip ok`                    → 1 red
  //   B5c counter-only row `chip bad` → `chip ok`               → 1 red
  //   B5d revoked detail `C.danger` → `C.success`               → 1 red
  //   NB1 `{t.verified > 0 && <p>No key…revoked.</p>}`          → 1 red
  //   NB2 `{r.sources.length > 0 && ' · …'}` on the detail cell → 1 red
  //
  // Two of those are worth more than their counts. B3a and B3b each fail in
  // exactly ONE test — the wiring test below — which is what "one owner per
  // branch" means and is the property this file's fifth injection was added
  // for. And NB1 was measured TWICE: pinning the KPI row on a non-zero posture
  // did NOT kill it, because the injection is in the violations card and that
  // card's own space still held `verified` at zero. What kills it is pinning
  // the card against the totals it does not read. A finding closed on the
  // surface that reports the symptom is not closed.
  // ══════════════════════════════════════════════════════════════════
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
      [
        // ROUND 11's B3, and on this surface also B4. The injection above is a
        // DESCENDANT suppression, so it attributes only the downward walk; the
        // upward one — the branch half four's docblock names as its whole
        // reason for existing — had no injection, and deleting it was 42 files
        // / 1045 tests green here and on the dashboard.
        //
        // This suppresses an ancestor ABOVE the pinned card, which is the arm
        // that `if (node === el) break;` used to make unreachable on this page
        // and not on the dashboard. `<div className="page" aria-hidden="true">`
        // on the real component was 1045/1045 green here and 6 red there, off
        // that one line.
        'an ANCESTOR of the pinned card suppressed',
        (card) => {
          card.parentElement!.setAttribute('aria-hidden', 'true');
        },
      ],
      [
        // ROUND 13's B4. The five above are all ATTRIBUTE suppressions, so the
        // styling branch — which is a different mechanism, not a sixth
        // attribute — had no owner, and the three measured escapes
        // (`display: none` on `.kpi-grid`, `visibility: hidden` on the same,
        // and a `display: none` wrapper around the dashboard's card body) were
        // all green. A branch with no injection is a branch that can be
        // deleted silently, which is the property the fifth injection was
        // added to give the upward walk.
        'the pinned card suppressed by an inline STYLE, not an attribute',
        (card) => {
          card.style.display = 'none';
        },
      ],
      [
        // …and above it, because inline suppression is inherited exactly as
        // the attribute kind is. This is the arm that reaches the `.kpi-grid`
        // and `.page` escapes.
        'an ANCESTOR of the pinned card suppressed by an inline STYLE',
        (card) => {
          card.parentElement!.style.visibility = 'hidden';
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
    // SEVEN injections for four halves. The reachability half has FOUR
    // independent branches — up and down, by attribute and by inline style —
    // and round 11's B3 and round 13's B4 are the same lesson twice: an
    // injection can only attribute the branch it actually travels, so a branch
    // with no injection of its own can be deleted with the suite green.
    expect(injections).toHaveLength(7);
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
    expectNothingAnnounced(card, [TRUST_VIOLATIONS_TABLE_SCROLL_LABEL], 'violations table');
    // Anti-vacuity on the column table itself: emptying it would make the
    // header half of every expectation above disappear silently.
    expect(TRUST_VIOLATIONS_COLUMNS.length, 'the column table emptied out').toBe(5);
    expect([...card.querySelectorAll('thead th')].map((t) => normalize(t.textContent))).toEqual([
      ...TRUST_VIOLATIONS_COLUMNS,
    ]);
  });

  it('pins the counter-only row at BOTH sides of its singular/plural boundary', () => {
    // ROUND 13's NB3. `COUNTER_ONLY` is fixed at 2 throughout the cross product
    // below, so the row's own `=== 1 ? '' : 's'` branch — the one arm of this
    // row that is a DECISION rather than data — was rendered by nothing in the
    // file. A count of 1 is the most ordinary counter-only payload there is.
    const cases: Array<[count: number, detail: string, clause: string]> = [
      [1, '1 fail-closed verdict counted with no per-event detail', '1 revoked across 1 run'],
      [2, '2 fail-closed verdicts counted with no per-event detail', '2 revoked across 1 run'],
    ];
    for (const [count, detail, revocationClause] of cases) {
      cleanup();
      const { container } = renderWith(
        overview(
          [{ runId: 'run-counters', trust: trust({ revoked: [], keyRevocationRevokedAtOrAfter: count }) }],
          { revokedEvents: count, revokedRuns: 1, revocationReportedRuns: 1 },
          FEATURES_ON,
        ),
      );
      const when = timeAgo('2026-09-25T00:01:00.000Z');
      const expected = expectedTrustViolationsTableBlocks({
        sub: trustViolationsSub({
          flaggedEvents: 0,
          flaggedRuns: 0,
          revocationClause,
          preCompromiseEvents: 0,
        }),
        rows: [['run-counters', '—', 'reported without detail', detail, when]],
      });
      expectPinnedViolations(violationsCard(container), expected, `counter-only table, count=${count}`);
    }
    // Anti-vacuity: the two cases have to differ in the detail cell, or this is
    // the same render twice under two labels.
    expect(new Set(cases.map((c) => c[1])).size).toBe(2);
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
  //
  // ROUND 11 CORRECTION: that list was itself incomplete, which is the same
  // defect one level up — a declaration of what is held constant that holds
  // more constant than it declares. Two more, now named and each given its own
  // pin below:
  //
  //   · `revoked[].sources`, `[]` in every fixture in this file. A clause
  //     gated on `r.sources.length > 0` in the detail cell was 1045/1045 green,
  //     and `amendKeyRevocation` upstream really does write that field. Pinned
  //     by "the finding row against the revocation fields the page does NOT
  //     render", which varies it and requires the row not to change.
  //   · `COUNTER_ONLY`, fixed at 2, which is the counter-only row's whole
  //     figure and its singular/plural boundary. A run listed as a violation
  //     that contributes ZERO rows — the case the page's own comment says it
  //     prevents — is not reached by this cross product. Verified read-only
  //     against `acdp-control-plane` that `summarizeByRun` derives the counters
  //     and `revoked[]` from one row set, so it is a defensive path rather than
  //     a live one; recorded here because "defensive" is a claim about upstream
  //     and this file cannot check it.
  //
  // ROUND 13 CORRECTION (its NB3 and NB6): that correction was incomplete in
  // its turn, twice over.
  //
  //   · The singular arm of the counter-only row was still unrendered — the
  //     paragraph above names `COUNTER_ONLY` as a held constant and calls it
  //     "its singular/plural boundary" without pinning either side. Now pinned
  //     at 1 and at 2 by "pins the counter-only row at BOTH sides of its
  //     singular/plural boundary".
  //   · The list is about the FINDING ROW's fields and says nothing about the
  //     four INPUTS the card receives whole — `TrustTotals`, `TrustOverview`,
  //     `CpDashboardFeatures` and the `CpRun` behind every row. Every one of
  //     them was pinned to a single posture by the fixtures above, and round 13
  //     measured seven one-line escapes through them. They are no longer held
  //     constant: `unreadMemberPostures` sweeps every member each of those four
  //     types declares that this card does not read, from the emptiest posture
  //     to the busiest, in the four tests below "ROUND 13's B5". A new member
  //     of any of them lands in neither the READ nor the UNREAD list and
  //     throws.
  //
  // Still held constant, and now genuinely the whole list: the ctx ids, the
  // discrepancy text, the timestamps, and `revoked[].boundary`/`trustClass`,
  // all of which the row renders verbatim.
  // ══════════════════════════════════════════════════════════════════
  type Finding = 'none' | 'flagged' | 'revoked' | 'counter' | 'both';
  type ViolationsInput = {
    runs: number;
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

  /**
   * The `runs` values the enumeration below visits.
   *
   * ── ROUND 11's B1: THREE OF TWENTY-SIX ───────────────────────────────
   *
   * This axis was `[0, 1, 2]` under a test called "pins the violations card in
   * EVERY reachable arm of its input space" — a name this branch has since
   * narrowed to what it does — and `runs` is not a three-valued
   * axis: `use-trust.ts` fetches `MAX_RUNS = 25`, and the DEFAULT demo posture
   * carries a `trust` summary on seven of eight runs. So the state an operator
   * sees on first load was outside the space this test claimed to have
   * enumerated, and `{runs.length > 2 && <p>No key in this deployment has been
   * revoked.</p>}` in the violations body was 42 files / 1045 tests green — a
   * deployment-wide all-clear painted in the same card as a listed finding.
   * That is round 10's B4 coordinate, reported and closed for the wrong
   * quantity: the SPACE was derived, and the axis the finding named was given
   * three of its values.
   *
   * `3` is added rather than swapped in, because `0`, `1` and `2` are all
   * load-bearing — the no-runs empty state, the singular/plural boundary in the
   * revocation clause, and the first plural. What actually closes the axis is
   * the whole-axis sweep below; this list is the cross product's sample of it.
   */
  const VIOLATIONS_RUNS_AXIS = [0, 1, 2, 3] as const;

  function reachableViolationsInputs(): ViolationsInput[] {
    const out: ViolationsInput[] = [];
    for (const runs of VIOLATIONS_RUNS_AXIS) {
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

  it('pins the violations card in every arm of its six-axis cross product', () => {
    const inputs = reachableViolationsInputs();
    // Anti-vacuity on the enumeration: a filter that swallowed the space would
    // make this loop assert nothing at all.
    expect(inputs.length, 'the violations input enumeration collapsed').toBe(122);
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
    // collisions are characterised, not merely counted. Measured: 74 distinct
    // cards over 122 inputs, and every one of the 48 collisions is the same
    // pair. (Round 11 added `runs: 3` to the axis; the previous measurement was
    // 50 over 82.)
    expect(groups.size, 'the arms collapsed onto one another').toBe(74);
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

  /**
   * The ceiling on `runs`: the VALUE the hook uses, imported from it.
   *
   * ── ROUND 13's B2: A PARSER THAT DRIFTS IS WORSE THAN A NUMBER ───────
   *
   * This read `/const\s+MAX_RUNS\s*=\s*(\d+)/` out of `use-trust.ts`, under a
   * docblock saying "a number copied into a test is a number that drifts …
   * parsed instead, and a hook that stops declaring a ceiling is a red test
   * rather than a silently unbounded sweep". The pattern is unanchored, so it
   * stops at the first integer in the initializer: rewriting the hook to
   * `const MAX_RUNS = 5 * 5` — the same value, the same fetch, an ordinary
   * refactor — left the sweep running 1..5 against a hook fetching 25, with 42
   * files / 1050 tests green. Measured: with `25` the gate
   * `{runs.length > 6 && <p>No key…revoked.</p>}` is 1 red; with `5 * 5` the
   * identical gate SURVIVES. A hand-written number is visible in a diff; a
   * mis-parse is not.
   *
   * So the value is imported. The guard is then about the number the hook
   * USES, which is what the claim was always about, and it survives any
   * expression form. The source read that remains is a different claim — that
   * the constant still bounds the FETCH — and it is anchored, so a non-literal
   * `limit:` is red rather than quietly accepted.
   */
  function maxAuditedRuns(): number {
    const src = readFileSync(join(process.cwd(), 'lib/hooks/use-trust.ts'), 'utf8');
    expect(src, 'MAX_RUNS is declared but no longer bounds the fetch').toMatch(/limit:\s*MAX_RUNS\b/);
    expect(src, 'MAX_RUNS is no longer exported, so this sweep would be reading a stale copy').toMatch(
      /export const MAX_RUNS\b/,
    );
    return MAX_RUNS;
  }

  it('bounds the runs axis WHOLE — every SHAPE, at every value the hook can deliver', () => {
    // ══════════════════════════════════════════════════════════════════
    // ROUND 13's B1: "WHOLE" MEANT THREE LINES THROUGH THE SPACE
    //
    // This swept `runs` 1..MAX_RUNS for THREE hand-written shapes, under a
    // test name saying "at every value the hook can deliver" and a docblock
    // saying "every coordinate gate on `runs.length` has a threshold, and a
    // threshold anywhere in 0..MAX_RUNS is crossed here". Crossing the
    // threshold is necessary and not sufficient — the gate's OTHER conjuncts
    // have to hold too, and three fixed shapes satisfy three of the forty the
    // enumeration produces. Measured:
    //
    //   {runs.length > 3 && t.flaggedEvents > 0 && t.revokedEvents === 0 &&
    //     <p>No key in this deployment has been revoked.</p>}       SURVIVED
    //   {runs.length > 3 && <p>…same sentence…</p>}                 1 red
    //
    // both at 42 files / 1050 tests. The surviving one is not a contrivance:
    // `KEY_REVOCATION_CHECK_ENABLED` defaults false upstream, so every
    // revocation counter is a legitimate zero, while one bad content hash
    // gives a flagged finding — the flagged-and-unmonitored posture is the
    // DEFAULT one, and the card would print a deployment-wide all-clear in the
    // same paint as the listed discrepancy. That is round 11's B1 moved one
    // axis over, which is what this sweep was built to stop.
    //
    // So the shapes are not written here at all: they are the cross product's
    // own enumeration with `runs` PROJECTED OUT. A shape added there is swept
    // here in the same commit, a shape dropped there is red here, and neither
    // needs anybody to remember this test exists.
    // ══════════════════════════════════════════════════════════════════
    const ceiling = maxAuditedRuns();
    expect(ceiling, 'the hook no longer fetches more runs than the cross product samples').toBeGreaterThan(
      VIOLATIONS_RUNS_AXIS[VIOLATIONS_RUNS_AXIS.length - 1],
    );
    // `runs` is NORMALISED out of the key rather than destructured away, so a
    // new axis added to `reachableViolationsInputs` joins the shape in the same
    // commit instead of needing this line edited.
    const byKey = new Map<string, ViolationsInput>();
    for (const input of reachableViolationsInputs()) {
      if (input.runs === 0) continue; // the no-runs arm has no `runs` to sweep
      const shape = { ...input, runs: 0 };
      byKey.set(JSON.stringify(shape), shape);
    }
    const shapes = [...byKey.values()];
    // Anti-vacuity, and the link to the cross product stated as an assertion
    // rather than as a comment: these ARE that enumeration's shapes.
    expect(shapes.length, 'the shape projection collapsed').toBe(40);
    expect(
      new Set(reachableViolationsInputs().filter((i) => i.runs > 0).map((i) => JSON.stringify({ ...i, runs: 0 }))).size,
      'the projection is not injective, so a shape is being swept under two names',
    ).toBe(shapes.length);
    let pinned = 0;
    for (const shape of shapes) {
      for (let runs = 1; runs <= ceiling; runs += 1) {
        const i: ViolationsInput = { ...shape, runs };
        cleanup();
        const { container } = renderWith(
          overview(
            Array.from({ length: runs }, (_, n) => ({ runId: `run-${n}`, trust: runTrustFor(i.finding, n) })),
            totalsFor(i),
            i.checkOff ? { ...FEATURES_ON, keyRevocationCheck: false } : FEATURES_ON,
          ),
        );
        expectPinnedViolations(
          violationsCard(container),
          expectedViolations(i),
          `runs=${runs} finding=${i.finding} reported=${i.reported} checkOff=${i.checkOff} ` +
            `pre=${i.preCompromise} zeroed=${i.countersZeroed}`,
        );
        pinned += 1;
      }
    }
    // The product, not two marginals: a loop that never entered, a shape list
    // that emptied, or a ceiling that collapsed all make this fail.
    expect(pinned, 'the runs sweep rendered less than the whole product').toBe(shapes.length * ceiling);
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════
  // ROUND 13's B5: ONE TYPE, ON ONE PAGE — AND THE INSTRUMENT THAT FIXES IT
  //
  // Round 12 built the sweep below ONCE, by hand, for `TrustTotals`, and the
  // commit said it made "a new member of that interface land in neither list
  // and be a red test rather than a new unvaried coordinate". True of
  // `TrustTotals`. The general property it reads as — *this surface renders
  // identically across every member of every input it is handed* — was never
  // built, and round 13 measured seven one-line escapes through the inputs the
  // instrument was not carried to, two of them live on the console's own
  // default demo posture.
  //
  // So `unreadMemberPostures` is the instrument, and the four tests below are
  // four instantiations of it, one per input this card receives:
  //
  //   TrustTotals            the aggregate figures       (round 12's original)
  //   CpDashboardFeatures    the deployment flag set
  //   TrustOverview          the hook's whole payload
  //   CpRun                  the run behind every table row
  //
  // Each declares a READ / UNREAD partition checked against the interface as
  // the module declares it, so a new member lands in neither list and throws;
  // and each sweeps from the EMPTIEST posture the input admits to the most
  // eventful one, so a gate reading a member in either direction is caught.
  // Round 13's escapes came in both (`recentRuns.length > 0` and
  // `logInclusionAudit === false`).
  // ══════════════════════════════════════════════════════════════════
  const USE_TRUST_SRC = readFileSync(join(process.cwd(), 'lib/hooks/use-trust.ts'), 'utf8');
  const TYPES_SRC = readFileSync(join(process.cwd(), 'lib/types.ts'), 'utf8');

  /** Render one posture and assert the violations card has not moved. */
  function expectViolationsUnmoved(data: TrustOverview, expected: string[], label: string): void {
    cleanup();
    const { container } = renderWith(data);
    expectPinnedViolations(violationsCard(container), expected, label);
  }

  const SWEEP_BASE: ViolationsInput = {
    runs: 2,
    finding: 'revoked',
    reported: true,
    checkOff: false,
    preCompromise: false,
    countersZeroed: false,
  };

  function sweepRuns(i: ViolationsInput) {
    return Array.from({ length: i.runs }, (_, n) => ({
      runId: `run-${n}`,
      trust: runTrustFor(i.finding, n),
    }));
  }

  /** Every `TrustTotals` member at rest, before `totalsFor` fills the read six. */
  const ZERO_TOTALS: TrustOverview['totals'] = {
    audited: 0, verified: 0, verifiedHistorical: 0, structural: 0, noReceipt: 0, errors: 0,
    flaggedRuns: 0, flaggedEvents: 0, revokedRuns: 0, revokedEvents: 0, preCompromiseEvents: 0,
    revocationReportedRuns: 0,
  };

  it('pins the violations card against the TOTALS fields it does not read', () => {
    // ROUND 11's NB1, and the sibling of the `sources` case below. The
    // violations card reads six members of `TrustTotals`; the other six —
    // `audited`, `verified`, `verifiedHistorical`, `structural`, `noReceipt`,
    // `errors` — arrive on every render and were ZERO in every fixture on this
    // page, because `totalsFor` never populated them. A coordinate on one of
    // them is therefore unreachable by the whole cross product above:
    // `{t.verified > 0 && <p>No key in this deployment has been revoked.</p>}`
    // inside the violations CardBody was 42 files / 1045 tests green, and it is
    // non-zero on the default demo posture.
    //
    // The pin is the same shape as the `sources` one: this card must render the
    // SAME thing whatever those six hold. That is a claim about the card's
    // inputs rather than about the code that happens to ignore them, which is
    // the version that survives the next edit.
    //
    // ROUND 13's B5 changed only HOW it is expressed: the partition check and
    // the postures are now the shared instrument, and each member is varied
    // ALONE as well as with the others, which round 12's three bulk postures
    // did not do.
    const READ = [
      'flaggedEvents',
      'flaggedRuns',
      'revokedEvents',
      'revokedRuns',
      'revocationReportedRuns',
      'preCompromiseEvents',
    ] as const;
    const UNREAD = ['audited', 'verified', 'verifiedHistorical', 'structural', 'noReceipt', 'errors'] as const;
    const expected = expectedViolations(SWEEP_BASE);
    const lean: TrustOverview['totals'] = { ...ZERO_TOTALS, ...totalsFor(SWEEP_BASE) };
    const postures = unreadMemberPostures({
      source: USE_TRUST_SRC,
      interfaceName: 'TrustTotals',
      read: READ,
      unread: UNREAD,
      lean,
      // Pairwise distinct, so a card that started reading one of the six is red
      // whichever one it read and whatever it compared it against.
      rich: { audited: 11, verified: 13, verifiedHistorical: 17, structural: 19, noReceipt: 23, errors: 29 },
    });
    // …plus round 12's UNIFORM posture, which the one-at-a-time sweep does not
    // subsume: a gate reading two members against each other (`verified ===
    // audited`) is false under distinct values and true under equal ones.
    const all: { label: string; input: TrustOverview['totals'] }[] = [
      ...postures,
      {
        label: 'TrustTotals: every unread member = 1',
        input: { ...lean, ...Object.fromEntries(UNREAD.map((k) => [k, 1])) },
      },
    ];
    expect(all, 'the TrustTotals sweep lost a posture').toHaveLength(UNREAD.length + 2);
    for (const p of all) {
      expectViolationsUnmoved(overview(sweepRuns(SWEEP_BASE), p.input, FEATURES_ON), expected, p.label);
    }
  });

  it('pins the violations card against the FEATURE FLAGS it does not read', () => {
    // ROUND 13's B5, escape 2 and 3. `/trust` reads exactly ONE member of
    // `CpDashboardFeatures` — `features?.keyRevocationCheck === false`, and
    // `use-trust.ts`'s own docblock explains why only that arm is safe here.
    // The other five arrive on every render and were pinned to `true` in every
    // fixture on this page (`FEATURES_ON`), so a coordinate on one of them was
    // unreachable by everything above. Measured, inside the violations
    // CardBody:
    //
    //   {features?.logInclusionAudit === false && <p>No key in this deployment
    //    has been revoked.</p>}
    //
    // 42 files / 1050 tests green — and `MOCK_DASHBOARD` sets that flag false,
    // so it renders on the console's own demo posture.
    const READ = ['keyRevocationCheck'] as const;
    const UNREAD = [
      'receiptAudit',
      'logInclusionAudit',
      'logWitness',
      'witnessCosigning',
      'witnessQuorum',
    ] as const;
    const subtitles = new Set<string>();
    for (const keyRevocationCheck of [false, true]) {
      // `reported: false`, so the ONE read flag actually decides the subtitle:
      // `check-off` against `not-reported`. A read member that stopped being
      // read would collapse the two, and the assertion after the loop is red.
      const base: ViolationsInput = {
        ...SWEEP_BASE,
        finding: 'flagged',
        reported: false,
        checkOff: keyRevocationCheck === false,
      };
      const expected = expectedViolations(base);
      subtitles.add(expected.join(''));
      const postures = unreadMemberPostures({
        source: TYPES_SRC,
        interfaceName: 'CpDashboardFeatures',
        read: READ,
        unread: UNREAD,
        // All five OFF, which no fixture on this page had ever rendered…
        lean: {
          keyRevocationCheck,
          receiptAudit: false,
          logWitness: false,
          logInclusionAudit: false,
          witnessCosigning: false,
          witnessQuorum: false,
        },
        // …and all five ON, so both `=== true` and `=== false` gates are swept.
        rich: {
          receiptAudit: true,
          logWitness: true,
          logInclusionAudit: true,
          witnessCosigning: true,
          witnessQuorum: true,
        },
      });
      expect(postures, 'the CpDashboardFeatures sweep lost a posture').toHaveLength(UNREAD.length + 1);
      for (const p of postures) {
        expectViolationsUnmoved(
          overview(sweepRuns(base), totalsFor(base), p.input),
          expected,
          `${p.label} · keyRevocationCheck=${keyRevocationCheck}`,
        );
      }
    }
    // The `keyRevocationCheck=true, receiptAudit=false` postures above depict a
    // deployment upstream REFUSES TO BOOT (`app-config.service.ts:573-574`
    // throws on exactly that pair). They are swept deliberately: nothing
    // validates this payload on arrival, and `lib/types.ts`'s own docblock says
    // the all-six requirement is "a claim about UPSTREAM, not a guarantee the
    // wire makes". The card must render the same whatever arrives.
    //
    // Anti-vacuity on the READ side: the one member this card does read has to
    // change what it renders, or the loop above is two identical sweeps.
    expect(subtitles.size, 'the check-off arm collapsed onto the not-reported one').toBe(2);
  });

  it('pins the violations card against the OVERVIEW members it does not read', () => {
    // ROUND 13's B5, at the level of the hook's whole return value. The card
    // reads `runs`, `totals` and `features`; `receiptCoverage` and `didMethods`
    // feed the two bar charts further down the page and were `[]` in every
    // fixture in this file. Measured, inside the violations CardBody:
    //
    //   {receiptCoverage.length === 0 && <p>No key in this deployment has been
    //    revoked.</p>}
    //
    // 42 files / 1050 tests green, and `[]` is what `useTrust` returns whenever
    // the dashboard overview omits the field — which is every control plane
    // predating ACDP 0.2.
    // #115: `readFailures`/`runsRequested` go in UNREAD, not READ, here. The
    // plan's Approach section says "add to read" speaking of the INTERFACE as
    // a whole, but this particular sweep's surface is `violationsCard(container)`
    // alone (via `expectViolationsUnmoved`, below) — the same narrow DOM
    // subtree `receiptCoverage`/`didMethods` are UNREAD against, for exactly
    // the same reason: the new banner they feed renders as a SIBLING of the
    // violations card, above `.kpi-grid`, never inside it. `runs`/`totals`/
    // `features` are READ because the violations card's own content is a
    // function of them; these two are not, which is what UNREAD asserts.
    const READ = ['runs', 'totals', 'features'] as const;
    const UNREAD = ['receiptCoverage', 'didMethods', 'readFailures', 'runsRequested'] as const;
    const expected = expectedViolations(SWEEP_BASE);
    const lean = overview(sweepRuns(SWEEP_BASE), totalsFor(SWEEP_BASE), FEATURES_ON);
    expect(
      [lean.receiptCoverage.length, lean.didMethods.length],
      'the lean posture is no longer the empty one',
    ).toEqual([0, 0]);
    const postures = unreadMemberPostures<TrustOverview>({
      source: USE_TRUST_SRC,
      interfaceName: 'TrustOverview',
      read: READ,
      unread: UNREAD,
      lean,
      rich: {
        receiptCoverage: [
          { registry_authority: 'registry-a.playground.local', publish_count: 12, receipt_count: 4 },
          { registry_authority: 'registry-b.playground.local', publish_count: 3, receipt_count: 3 },
        ],
        didMethods: [
          { method: 'did:web', publish_count: 7 },
          { method: 'other', publish_count: 1 },
        ],
        readFailures: 5,
        runsRequested: 40,
      },
    });
    expect(postures, 'the TrustOverview sweep lost a posture').toHaveLength(UNREAD.length + 1);
    for (const p of postures) expectViolationsUnmoved(p.input, expected, p.label);
  });

  it('pins the violations TABLE against the CpRun members it does not read', () => {
    // ROUND 13's B5, escapes 6 and 7. Every row of this table is rendered from
    // a `CpRun`, and this file has always built one with a three-field cast —
    // `{ runId, startedAt, completedAt } as unknown as CpRun` — so nine of the
    // twelve members arrived `undefined` on every render in the file.
    // Measured, on the run cell:
    //
    //   {runs.some((r) => r.run.status === 'completed') && …}
    //   {runs.some((r) => (r.run.registries ?? []).length > 0) && …}
    //
    // both 42 files / 1050 tests green, and both true of the demo dataset.
    //
    // The cast is gone: `lean` below is a COMPLETE `CpRun` at rest, so the
    // sweep varies real members rather than filling in absent ones.
    const READ = ['runId', 'startedAt', 'completedAt'] as const;
    const UNREAD = [
      'tenantId',
      'scenarioId',
      'status',
      'contextsCount',
      'registries',
      'inputs',
      'result',
      'updatedAt',
      'trust',
    ] as const;
    const base: ViolationsInput = { ...SWEEP_BASE, runs: 1 };
    const expected = expectedViolations(base);
    const lean: CpRun = {
      runId: 'run-0',
      tenantId: 'tenant-a',
      scenarioId: 'scenario-a',
      status: 'running',
      startedAt: '2026-09-25T00:00:00.000Z',
      completedAt: WHEN,
      contextsCount: 0,
      registries: [],
      inputs: null,
      result: null,
      updatedAt: undefined,
      trust: null,
    };
    const postures = unreadMemberPostures<CpRun>({
      source: TYPES_SRC,
      interfaceName: 'CpRun',
      read: READ,
      unread: UNREAD,
      lean,
      rich: {
        tenantId: 'tenant-b',
        scenarioId: 'scenario-b',
        status: 'completed',
        contextsCount: 5,
        registries: ['registry-a.playground.local', 'registry-b.playground.local'],
        inputs: { seed: 7 },
        result: { ok: true },
        updatedAt: '2026-09-25T00:02:00.000Z',
        // The run's OWN trust summary, which is a different value from the
        // `trust` member beside it in `TrustOverview['runs']` — the page reads
        // the latter, and a row that started reading this one would report a
        // finding nothing in the totals accounts for.
        trust: trust({ revoked: [revocation('revoked_time_unverifiable', 'inner')] }),
      },
    });
    expect(postures, 'the CpRun sweep lost a posture').toHaveLength(UNREAD.length + 1);
    for (const p of postures) {
      expectViolationsUnmoved(
        {
          runs: [{ run: p.input, trust: runTrustFor(base.finding, 0) }],
          totals: { ...ZERO_TOTALS, ...totalsFor(base) },
          receiptCoverage: [],
          didMethods: [],
          features: FEATURES_ON,
          readFailures: 0,
          runsRequested: 1,
        },
        expected,
        p.label,
      );
    }
  });

  it('GUARDS THE GUARD: the unread-member sweep refuses a gap, a rename and a vacuous posture', () => {
    // The instrument is now load-bearing at six call sites across two files, so
    // its refusals are measured rather than assumed. Each case below is a way
    // the sweep could go green while asserting nothing.
    const SRC = 'export interface Sample {\n  a: number;\n  b: number;\n  c: number;\n}\n';
    const sweep = (over: Partial<Parameters<typeof unreadMemberPostures>[0]>) =>
      unreadMemberPostures({
        source: SRC,
        interfaceName: 'Sample',
        read: ['a'],
        unread: ['b', 'c'],
        lean: { a: 1, b: 0, c: 0 },
        rich: { b: 1, c: 2 },
        ...over,
      });
    // The happy path: two members, one posture each, plus the all-at-once.
    expect(sweep({}).map((p) => p.label)).toEqual([
      'Sample.b = 1',
      'Sample.c = 2',
      'Sample: all 2 unread members at once',
    ]);
    expect(sweep({})[2].input).toEqual({ a: 1, b: 1, c: 2 });
    // A member in NEITHER list — the shape of every escape round 13 found.
    expect(() => sweep({ unread: ['b'], rich: { b: 1 } })).toThrow(/nothing here classifies: c/);
    // A member the interface no longer declares (a rename upstream).
    expect(() => sweep({ unread: ['b', 'c', 'd'], rich: { b: 1, c: 2, d: 3 } })).toThrow(
      /no longer declares: d/,
    );
    // A member on BOTH sides, which would let a read field pose as swept.
    expect(() => sweep({ read: ['a', 'b'] })).toThrow(/called both read and unread: b/);
    // A posture that varies a field to the value it already holds.
    expect(() => sweep({ rich: { b: 0, c: 2 } })).toThrow(/varies to the value it already holds/);
    // An unread member with no value to vary to.
    expect(() => sweep({ rich: { b: 1 } })).toThrow(/no varied value for Sample\.c/);
    // A subject that is not there at all — silence here would be a sweep with
    // no interface behind it, which is the failure mode of every source parse.
    expect(() => sweep({ interfaceName: 'Missing' })).toThrow(/no `interface Missing`/);
    // …and one with no members, which would make the partition trivially true.
    expect(() =>
      sweep({ source: 'export interface Sample {\n}\n', read: [], unread: [] }),
    ).toThrow(/parsed to no members/);
  });

  it('GUARDS THE GUARD: `suppressorOn` answers for exactly the three suppressing attributes', () => {
    // `SUPPRESSING_ATTRS` is the closed set both surfaces' reachability walks
    // are built on, and the claim that it IS closed is argued in its docblock
    // rather than measured. What can be measured is that the predicate reads
    // every member of it and nothing else — a fourth attribute added to the
    // list but not to `suppressorOn` would leave a documented channel unwalked.
    const el = document.createElement('div');
    expect(suppressorOn(el), 'a bare element is suppressed').toBeNull();
    for (const attr of SUPPRESSING_ATTRS) {
      el.setAttribute(attr, 'true');
      expect(suppressorOn(el), `\`${attr}\` is not read by suppressorOn`).not.toBeNull();
      el.removeAttribute(attr);
    }
    expect(SUPPRESSING_ATTRS).toHaveLength(3);
    // `aria-hidden` is the one of the three that is a VALUE, not a presence:
    // `aria-hidden="false"` is an explicit un-hiding and must not read as a
    // suppression, while a bare `hidden` must.
    el.setAttribute('aria-hidden', 'false');
    expect(suppressorOn(el)).toBeNull();
    el.removeAttribute('aria-hidden');
    el.setAttribute('hidden', '');
    expect(suppressorOn(el)).toBe('hidden');
    el.removeAttribute('hidden');
    // …and a plausible near-miss that is NOT suppression: `role="presentation"`
    // removes semantics, not the subtree, so the text is still announced.
    el.setAttribute('role', 'presentation');
    expect(suppressorOn(el)).toBeNull();
    el.removeAttribute('role');

    // ── ROUND 14's B9: THE FOURTH ────────────────────────────────────
    //
    // `<details><summary /><RevocationBody …/></details>` around the Key
    // Revocation body was 42 files / 1057 tests green: the whole body collapses
    // behind a closed disclosure, `textContent` is unchanged, no attribute on
    // the list is present and no inline style is added. `open` was on
    // `NON_ANNOUNCING_ATTRS` at the same time — the list that admitted the
    // escape and the list that claimed closure were the same file.
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const hidden = document.createElement('p');
    details.append(summary, hidden);
    expect(suppressorOn(details, hidden), 'a closed <details> is not read as suppression').toBe(
      'details (closed)',
    );
    // …and its SUMMARY is not suppressed, which is the whole reason the walk
    // has to know which child it came from.
    expect(suppressorOn(details, summary), 'a closed <details> silences its own summary').toBeNull();
    details.setAttribute('open', '');
    expect(suppressorOn(details, hidden), 'an OPEN <details> is read as suppression').toBeNull();
    // An upward walk with no `from` takes the conservative answer: a closed
    // disclosure suppresses, because that is true of everything but the
    // summary and the other way round is the silent one.
    details.removeAttribute('open');
    expect(suppressorOn(details)).toBe('details (closed)');
  });

  it('pins the finding row against the revocation fields the page does NOT render', () => {
    // ROUND 11's NB2. `revocation()` sets `sources: []` in every fixture in
    // this file, so `sources` is a field the row RECEIVES and no test varies —
    // and appending `{r.sources.length > 0 && ' · no other key in this
    // deployment has been revoked'}` to the detail cell was 42 files / 1045
    // tests green. Verified upstream that `amendKeyRevocation` writes
    // `keyRevocationSources`, so the gate is reachable in production; it is
    // simply outside this file's declared "WHAT IS HELD CONSTANT" list, which
    // is the half of that list that was wrong.
    //
    // The pin is that the row is the SAME whatever `sources` holds. A field the
    // page does not render must not become a field the page renders without a
    // visible diff, and that is a stronger claim than "the current code ignores
    // it" — it is the claim that survives the next edit.
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
          'run-src',
          formatCtxId(r.ctxId as string),
          r.status,
          `key revoked · boundary ${new Date(r.boundary).toLocaleString()} · ${r.trustClass}`,
          when,
        ],
      ],
    });
    type Source = NonNullable<Revoked[number]['sources']>[number];
    const src = (ctxId: string, publisher: string): Source => ({ ctxId, publisher });
    const SOURCES: Source[][] = [
      [],
      [src('acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'did:key:zA')],
      [src('one', 'did:key:z1'), src('two', 'did:key:z2'), src('three', 'did:key:z3')],
    ];
    for (const sources of SOURCES) {
      cleanup();
      const { container } = renderWith(
        overview(
          [{ runId: 'run-src', trust: trust({ revoked: [{ ...r, sources }] }) }],
          { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
          FEATURES_ON,
        ),
      );
      expectPinnedViolations(violationsCard(container), expected, `sources=${sources.length}`);
    }
    // Anti-vacuity: a loop over an emptied list asserts nothing, and the axis
    // has to include both the empty and the non-empty side to be an axis.
    expect(SOURCES).toHaveLength(3);
    expect(SOURCES.filter((s) => s.length > 0), 'the non-empty side of the axis is gone').not.toHaveLength(0);
  });

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

  it('pins the colour of EVERY finding on this table, and of the classes that carry it', () => {
    // ── ROUND 11's B5 ────────────────────────────────────────────────
    //
    // Round 10's B5 was closed for ONE of the table's three chips — the one
    // whose class comes from `revocationChipClass`. The other two are written
    // as literals at the call site and were read by nothing, and neither was
    // the stylesheet that decides what those class names MEAN. Measured, each
    // alone, each 42 files / 1045 tests green:
    //
    //   flagged row `className="chip bad"` → `"chip ok"`     SURVIVED
    //   counter-only row `className="chip bad"` → `"chip ok"` SURVIVED
    //   revoked detail cell `color: C.danger` → `C.success`   SURVIVED
    //   `.chip.bad` repainted to `var(--success)` in globals  SURVIVED
    //
    // The last one matters most, and not because it is the hardest: CLAUDE.md
    // says "all colours come from CSS variables; raw hex lives only in
    // `app/globals.css`", so editing that file is the NORMAL way colour changes
    // in this repository. A green chip over a live `revoked_at_or_after`
    // verdict is issue #97's harm stated in one word, and the page's own
    // account of why colour is load-bearing here — pre-compromise is
    // historically AUTHORIZED and is painted green for that reason — is what
    // makes an inversion a lie rather than a style preference.
    //
    // Hand-written, not derived: reading `C.danger` to assert `C.danger` is the
    // tautology this branch has now caught four times.
    const DANGER = 'var(--danger)';
    const cases: Array<
      [label: string, run: { runId: string; trust: RunTrustSummary }, chip: string, detail: string]
    > = [
      [
        'a flagged finding',
        {
          runId: 'run-flag',
          trust: trust({
            flagged: [
              {
                eventId: 'f',
                ctxId: FLAGGED_CTX,
                status: 'discrepancy',
                discrepancies: ['content_hash_mismatch:x'],
              },
            ],
          }),
        },
        'chip bad',
        'content_hash_mismatch:x',
      ],
      [
        'a counter-only run',
        {
          runId: 'run-count',
          trust: trust({ revoked: [], keyRevocationRevokedAtOrAfter: 2 }),
        },
        'chip bad',
        '2 fail-closed verdicts counted with no per-event detail',
      ],
      [
        'a live revocation',
        {
          runId: 'run-rev',
          trust: trust({ revoked: [revocation('revoked_at_or_after')] }),
        },
        'chip bad',
        'key revoked',
      ],
    ];
    for (const [label, run, chip, detailText] of cases) {
      cleanup();
      const { container } = renderWith(
        overview([run], { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1, flaggedEvents: 1 }, FEATURES_ON),
      );
      const card = violationsCard(container);
      const chips = [...card.querySelectorAll<HTMLElement>('tbody td span[class^="chip"]')];
      expect(chips.length, `${label}: no chip rendered`).toBeGreaterThan(0);
      for (const c of chips) {
        expect(c.getAttribute('class'), `${label}: the chip changed class`).toBe(chip);
      }
      // …and the DETAIL cell beside it, which carries the same claim in an
      // inline colour rather than a class.
      const detail = [...card.querySelectorAll<HTMLElement>('tbody td span.did')].find((s) =>
        normalize(s.textContent).startsWith(detailText.slice(0, 20)),
      );
      expect(detail, `${label}: no detail cell saying "${detailText.slice(0, 20)}"`).toBeTruthy();
      expect(detail!.style.color, `${label}: the detail cell is no longer painted as a danger`).toBe(DANGER);
    }

    // ── The stylesheet, which is where the class names acquire meaning ──
    //
    // The render assertions above say the flagged row wears `.chip.bad`. They
    // say nothing about what `.chip.bad` looks like, and the repository's own
    // rules point every colour change at this file. `health-labels.test.tsx`
    // reads `app/globals.css` for exactly this reason and says so; this is the
    // same instrument on the surface #97 is about.
    // ══════════════════════════════════════════════════════════════════
    // ROUND 13's B3: A TOKEN NAME IS NOT A COLOUR
    //
    // This asserted `colourOf('.chip.bad') === 'var(--danger)'` and that the
    // three token NAMES are distinct, under "which is the property an operator
    // actually relies on". An operator relies on distinct COLOURS, and three
    // channels each repainted a live fail-closed verdict success-green with 42
    // files / 1050 tests green:
    //
    //   :root { --danger: #f05d7a }  ->  #22d48f          (identical to
    //     --success; `new Set(names).size === 3` still passes, and it repaints
    //     every danger surface in the console in one line)
    //   .data-table .chip.bad { color: var(--success) }   (appended; `match`
    //     returns the FIRST rule and the cascade takes the last)
    //   <span … style={{ color: C.success }}>             (inline; invisible
    //     to every half, because `style` is licensed as non-announcing)
    //
    // So the pin is over the RESOLVED colour, taken from the LAST matching
    // rule through the `:root` table — plus the inline channel, asserted on
    // the elements themselves rather than on the stylesheet.
    // ══════════════════════════════════════════════════════════════════
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const vars = cssCustomProperties(css);
    // Anti-vacuity on the table itself: a resolver reading an empty map
    // resolves everything to `null` and every comparison below would be
    // `null === null`.
    expect(Object.keys(vars).length, 'the :root custom-property table read as empty').toBeGreaterThan(10);
    const tone = (selector: string): string => {
      const c = resolvedColour(css, selector);
      expect(c, `${selector} resolves to no colour in app/globals.css`).toBeTruthy();
      return c!;
    };
    // ══════════════════════════════════════════════════════════════════
    // ROUND 14's B1: WHAT IS PINNED IS HOW THE COLOUR READS
    //
    // This said `tone('.chip.bad') === vars['--danger']`. Both sides resolve
    // through the same `:root` table, so it is a tautology for any value of
    // `--danger`; the only real content was that the three are distinct.
    // Measured: `--danger: #f05d7a` -> `#1fbf85` — a green, one line in the
    // file `CLAUDE.md` names as the only home for colour — left 42 files /
    // 1057 tests green, repainting every danger surface in the console. Round
    // 13's own exhibit used `#22d48f`, byte-identical to `--success`, which is
    // the ONE green that trips distinctness.
    //
    // So the three arms are classified by how an operator READS them, from the
    // channels, independently of what any token is called or currently holds.
    // Distinctness stays as a second, weaker statement.
    // ══════════════════════════════════════════════════════════════════
    expect(readsAs(tone('.chip.bad')), 'a fail-closed finding is not painted as an alarm').toBe(
      'alarm',
    );
    expect(readsAs(tone('.chip.warn')), 'an unverifiable finding is not painted as a caution').toBe(
      'caution',
    );
    expect(readsAs(tone('.chip.ok')), 'the authorized arm is not painted as safe').toBe('safe');
    const tones = ['.chip.bad', '.chip.warn', '.chip.ok'].map(tone);
    expect(new Set(tones).size, 'two chip states resolve to the same colour').toBe(3);
    expect(tones.every((t) => /^#|^rgb/.test(t)), 'a tone did not resolve past its token').toBe(true);
    // GUARDS THE GUARD. One per channel the round-13 and round-14 gates walked
    // through, plus the vacuity direction.
    expect(resolvedColour(css, '.chip.not-a-real-state'), 'the reader invents a rule').toBeNull();
    // (1) round 13's exhibit: a :root repaint to the SUCCESS colour.
    const repainted = css.replace(/(--danger:\s*)#[0-9a-f]{6}/i, `$1${vars['--success']}`);
    expect(
      resolvedColour(repainted, '.chip.bad'),
      'a :root repaint is invisible to the resolved-colour pin',
    ).toBe(vars['--success']);
    // (2) round 14's B1: a repaint to a green that is NOT --success, which
    //     every distinctness pin admits.
    const otherGreen = css.replace(/(--danger:\s*)#[0-9a-f]{6}/i, '$1#1fbf85');
    expect(
      readsAs(resolvedColour(otherGreen, '.chip.bad')!),
      'a danger token repainted to a green that is not --success still reads as an alarm',
    ).toBe('safe');
    // (3) round 14's B2: a MORE SPECIFIC rule placed BEFORE the plain one. The
    //     round-13 guard tested only the appended direction, and the cascade
    //     does not care which way round they are written.
    expect(
      resolvedColour(
        css.replace('.chip.bad {', '.data-table .chip.bad { color: var(--success); }\n.chip.bad {'),
        '.chip.bad',
      ),
      'an EARLIER, more specific rule is invisible — the reader is modelling source order only',
    ).toBe(vars['--success']);
    expect(
      resolvedColour(css + '\n.data-table .chip.bad { color: var(--success); }', '.chip.bad'),
      'a later, more specific rule is invisible',
    ).toBe(vars['--success']);
    // (4) round 14's B3: `!important`, which beats a later normal declaration
    //     wherever it is written.
    expect(
      resolvedColour('.chip.bad { color: var(--success) !important; }\n' + css, '.chip.bad'),
      'an !important declaration is invisible — the reader is taking the last normal one',
    ).toBe(vars['--success']);
    // …and the specificity model is refused rather than guessed where it would
    // be wrong.
    expect(() =>
      resolvedColour(css + '\n.card:not(.x) .chip.bad { color: red; }', '.chip.bad'),
    ).toThrow(/functional pseudo-class/);
    expect(specificity('.data-table .chip.bad')).toBeGreaterThan(specificity('.chip.bad'));
    expect(specificity('#x .chip')).toBeGreaterThan(specificity('.a.b.c.d'));
    expect(lastRuleFor(css, '.chip.bad')).toContain('background');
    expect(lastRuleFor(css, '.chip.nope')).toBeNull();

    // ── The INLINE channel, on the elements rather than the stylesheet ──
    //
    // `style` is on `NON_ANNOUNCING_ATTRS`, so an inline `color` on the chip
    // is invisible to `expectNothingAnnounced`, and the stylesheet pin above
    // cannot see it either. A chip may therefore carry NO inline colour at all
    // — the class is what decides, which is this repository's own rule — and
    // that is the closed form: not "no inline colour that is wrong", but "no
    // inline colour", so there is nothing to keep complete.
    cleanup();
    const inlineProbe = renderWith(
      overview(
        [{ runId: 'run-inline', trust: trust({ revoked: [revocation('revoked_at_or_after')] }) }],
        { revokedEvents: 1, revokedRuns: 1, revocationReportedRuns: 1 },
        FEATURES_ON,
      ),
    );
    const inlineChips = [
      ...violationsCard(inlineProbe.container).querySelectorAll<HTMLElement>('tbody td span[class^="chip"]'),
    ];
    expect(inlineChips.length, 'no chip rendered for the inline-colour pin').toBeGreaterThan(0);
    for (const c of inlineChips) {
      expect(c.style.color, 'a chip paints itself inline, where the class pin cannot see it').toBe('');
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
    cell.textContent = 'revoked_at_or_after';
    expectPinnedViolations(card, expected, 'after restoring the cell');

    // ROUND 11's B2, as a case rather than as a sentence about the mock. The
    // run cell holds this table's ONE interactive element, and the previous
    // mock rendered it as a bare `<span>` carrying only its children — so an
    // `aria-label` on the link was outside every pin on this card, in the state
    // a finding is listed. The mock forwards props now; this is what says so.
    const link = card.querySelector('tbody a');
    expect(link, 'the run cell no longer renders a link — this case tests nothing').toBeTruthy();
    link!.setAttribute('aria-label', 'No key in this deployment has been revoked.');
    expect(
      () => expectPinnedViolations(card, expected, 'link aria-label'),
      'the composite ADMITS an all-clear announced from the run link',
    ).toThrow();
    link!.removeAttribute('aria-label');
    // …and `title`, the other half of the measured injection, which is both an
    // announcement and a hover disclosure.
    link!.setAttribute('title', 'No key in this deployment has been revoked.');
    expect(
      () => expectPinnedViolations(card, expected, 'link title'),
      'the composite ADMITS an all-clear on the run link’s tooltip',
    ).toThrow();
    link!.removeAttribute('title');
    // Direction two: the attributes the link legitimately carries are still
    // licensed, so this is not simply refusing every link.
    expectPinnedViolations(card, expected, 'link restored');
    expect(link!.getAttribute('href'), 'the mock stopped forwarding href').toBe('/runs/run-live');
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

  // ════════════════════════════════════════════════════════════════════
  // #115: a per-run read failure used to be swallowed by `.catch(() => null)`,
  // so every figure on this page silently excluded that run with no
  // disclosure. `readFailures`/`runsRequested` on `TrustOverview` are a cause
  // this page counted ITSELF, so unlike the revocation copy above it may name
  // one — `assertNamesNoCause` is not applied to this banner, and does not
  // need to be: it forbids a GUESSED cause, and this one is measured.
  // ════════════════════════════════════════════════════════════════════
  describe('the read-failure banner', () => {
    function withReadFailures(readFailures: number, runsRequested: number): TrustOverview {
      return { ...overview([{ runId: 'r1', trust: trust() }]), readFailures, runsRequested };
    }

    it('names the count and denominator when readFailures > 0; says nothing at 0', () => {
      const { container: withFailures } = renderWith(withReadFailures(3, 25));
      expect(screen.getByText(/3 of 25 runs could not be read/)).toBeInTheDocument();
      expect(withFailures.textContent).toContain('lower bound');
      cleanup();

      const { container: clean } = renderWith(withReadFailures(0, 1));
      expect(clean.textContent).not.toContain('lower bound');
      expect(clean.textContent).not.toContain('could not be read');
    });

    it('renders outside .kpi-grid and outside the violations card', () => {
      const { container } = renderWith(withReadFailures(3, 25));
      expect(container.textContent).toContain('could not be read');
      expect(kpiGrid(container).textContent).not.toContain('could not be read');
      expect(violationsCard(container).textContent).not.toContain('could not be read');
    });
  });
});
