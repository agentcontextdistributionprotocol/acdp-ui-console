// ══════════════════════════════════════════════════════════════════════
// `useTrust`'s aggregation and ordering.
//
// This file was previously excluded from coverage under the blanket "React
// Query wrappers — covered by integration, not unit" rationale. That stopped
// being true once it grew the totals reduce, the revocation aggregation and
// the violation sort — and the unmeasured sort is precisely what sank a
// revoked-only run to the bottom of the page that exists to surface it. The
// exclusion is removed in this phase; these are the tests that earn that.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CpRun, RunTrustSummary } from '@/lib/types';

const getCpDashboard = vi.fn();
const listCpRuns = vi.fn();
const getCpRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  getCpDashboard: (...a: unknown[]) => getCpDashboard(...a),
  listCpRuns: (...a: unknown[]) => listCpRuns(...a),
  getCpRun: (...a: unknown[]) => getCpRun(...a),
}));

let capturedQueryFn: (() => Promise<unknown>) | null = null;
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown> }) => {
    capturedQueryFn = opts.queryFn;
    return { data: undefined };
  },
}));

vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: true }),
}));

import { useTrust, type TrustOverview } from '@/lib/hooks/use-trust';
import { hasTrustViolation } from '@/lib/utils/revocation';

type Revoked = NonNullable<RunTrustSummary['revoked']>;

function revocation(status: string, eventId = `${status}-${Math.random()}`): Revoked[number] {
  return {
    eventId,
    ctxId: null,
    status,
    boundary: '2026-08-01 00:00:00+00',
    trustClass: 'producer_signed',
    sources: [],
  };
}

function trust(over: Partial<RunTrustSummary> = {}): RunTrustSummary {
  return {
    audited: 1,
    verified: 1,
    verifiedHistorical: 0,
    structural: 0,
    noReceipt: 0,
    errors: 0,
    flagged: [],
    ...over,
  };
}

function run(runId: string, t: RunTrustSummary): CpRun {
  return {
    runId,
    tenantId: 'default',
    scenarioId: 's1',
    status: 'completed',
    startedAt: '2026-09-25T00:00:00.000Z',
    completedAt: '2026-09-25T00:01:00.000Z',
    contextsCount: 1,
    registries: [],
    trust: t,
  } as unknown as CpRun;
}

/**
 * Capture the hook's `queryFn` — that closure is where all the logic under
 * test lives (the fetch fan-out, the totals reduce, the violation sort).
 *
 * `react-hooks/rules-of-hooks` is disabled on exactly one line, deliberately:
 * the rule guards React's runtime invariants (consistent hook order across
 * renders), and there is no React runtime here at all. `useQuery` is mocked
 * above to record its options and return immediately rather than subscribe, so
 * this call allocates no state and schedules no effect — it is a plain
 * function call that happens to be spelled `use…`. Rendering a component just
 * to reach this closure would add a React tree that tests nothing.
 */
function captureQueryFn(
  runs: CpRun[],
  dash: Record<string, unknown> = {},
): () => Promise<unknown> {
  getCpDashboard.mockResolvedValue({ receiptCoverage: [], didMethods: [], ...dash });
  listCpRuns.mockResolvedValue({ data: runs.map((r) => ({ runId: r.runId })) });
  getCpRun.mockImplementation(async (id: string) => runs.find((r) => r.runId === id) ?? null);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- see docblock: no React runtime, useQuery is mocked to capture
  useTrust('24h');
  if (!capturedQueryFn) throw new Error('queryFn was not captured');
  return capturedQueryFn;
}

async function overviewFor(
  runs: CpRun[],
  dash: Record<string, unknown> = {},
): Promise<TrustOverview> {
  return (await captureQueryFn(runs, dash)()) as TrustOverview;
}

beforeEach(() => {
  capturedQueryFn = null;
  vi.clearAllMocks();
});

// `violationCount`'s own tests moved to `revocation.test.ts` (#101) — this
// file's own concern is `useTrust ordering` below, which exercises the hook
// sorting BY the count `useTrust` computes internally, not the count function
// itself.
describe('useTrust totals', () => {
  it('revokedEvents counts fail-closed verdicts only; pre_compromise gets its own total', async () => {
    const o = await overviewFor([
      run(
        'r1',
        trust({
          revoked: [
            revocation('pre_compromise', 'a'),
            revocation('revoked_at_or_after', 'b'),
            revocation('revoked_time_unverifiable', 'c'),
          ],
        }),
      ),
    ]);
    // Numerically falsifiable against a fixture carrying all three statuses:
    // the KPI is revokedAtOrAfter + revokedTimeUnverifiable = 2, not 3.
    expect(o.totals.revokedEvents).toBe(2);
    expect(o.totals.preCompromiseEvents).toBe(1);
    expect(o.totals.revokedRuns).toBe(1);
  });

  it('a run with only pre_compromise is not counted as a revoked run at all', async () => {
    const o = await overviewFor([run('r1', trust({ revoked: [revocation('pre_compromise')] }))]);
    expect(o.totals.revokedEvents).toBe(0);
    expect(o.totals.revokedRuns).toBe(0);
    expect(o.totals.preCompromiseEvents).toBe(1);
  });

  it('an unknown status counts toward revokedEvents (fails closed in the aggregate too)', async () => {
    const o = await overviewFor([run('r1', trust({ revoked: [revocation('mystery')] }))]);
    expect(o.totals.revokedEvents).toBe(1);
    expect(o.totals.revokedRuns).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// #115: a per-run `GET /runs/:id` used to be swallowed by `.catch(() => null)`,
// so a network blip on one run silently excluded it from every figure on
// `/trust` with no disclosure at all. `Promise.allSettled` replaces that catch;
// these tests pin the discrimination it exists to make — a REJECTED settlement
// is a read failure, a RESOLVED `null` (a run with no audit rows) is not.
// ══════════════════════════════════════════════════════════════════════
describe('useTrust — per-run read failures (#115)', () => {
  it('counts a rejected per-run fetch as a read failure; runsRequested is the pre-filter count', async () => {
    const runs = [run('r1', trust()), run('r2', trust()), run('r3', trust())];
    const queryFn = captureQueryFn(runs);
    getCpRun.mockImplementation(async (id: string) => {
      if (id === 'r2') throw new Error('network blip');
      return runs.find((r) => r.runId === id) ?? null;
    });

    // Resolving here at all — rather than the queryFn's promise rejecting — is
    // itself the proof that `error` stays `null` on the real `UseQueryResult`:
    // `useQuery` is mocked to merely capture this closure, so the only way
    // React Query's own error branch could ever fire is if invoking it threw.
    const overview = (await queryFn()) as TrustOverview;

    expect(overview.readFailures).toBe(1);
    expect(overview.runsRequested).toBe(3);
    expect(overview.runs.length).toBe(2);
  });

  it('a resolved null is NOT counted as a read failure', async () => {
    const runs = [run('r1', trust())];
    const queryFn = captureQueryFn(runs);
    // `listCpRuns` names a second run this fixture never provides a `trust`
    // for; `getCpRun`'s default mock (`?? null`, set inside `captureQueryFn`)
    // RESOLVES `null` for it rather than rejecting.
    listCpRuns.mockResolvedValue({ data: [{ runId: 'r1' }, { runId: 'ghost' }] });

    const overview = (await queryFn()) as TrustOverview;

    expect(overview.readFailures).toBe(0);
    expect(overview.runsRequested).toBe(2);
    expect(overview.runs.length).toBe(1);
  });
});

describe('useTrust ordering', () => {
  it('a revoked-only run sorts ABOVE a clean run', async () => {
    // The defect: sorting on `flagged.length` alone put a run carrying a live
    // revocation verdict below every clean run on the page.
    const o = await overviewFor([
      run('clean', trust()),
      run('revoked', trust({ revoked: [revocation('revoked_at_or_after')] })),
    ]);
    expect(o.runs.map((r) => r.run.runId)).toEqual(['revoked', 'clean']);
  });

  it('a pre_compromise-only run does NOT jump above a clean run', async () => {
    const o = await overviewFor([
      run('clean', trust()),
      run('authorized', trust({ revoked: [revocation('pre_compromise')] })),
    ]);
    // Both have zero violations, so the input order is preserved — an
    // authorized historical event must not be promoted as if it were a finding.
    expect(o.runs.map((r) => r.run.runId)).toEqual(['clean', 'authorized']);
  });

  it('orders by total violations across both mechanisms', async () => {
    const o = await overviewFor([
      run('one-revoked', trust({ revoked: [revocation('revoked_at_or_after')] })),
      run(
        'two-flagged',
        trust({
          flagged: [
            { eventId: 'f1', ctxId: null, status: 'discrepancy', discrepancies: ['a'] },
            { eventId: 'f2', ctxId: null, status: 'discrepancy', discrepancies: ['b'] },
          ],
        }),
      ),
    ]);
    expect(o.runs.map((r) => r.run.runId)).toEqual(['two-flagged', 'one-revoked']);
  });
});

describe('the real demo dataset, end to end', () => {
  it('aggregates run-revoked-1 exactly as the /trust KPI will render it', async () => {
    // Every other assertion here uses a synthetic fixture. This one drives the
    // ACTUAL dataset an operator sees in the default mode through the real
    // aggregation, so a future edit to `run-revoked-1` that breaks the KPI
    // cannot pass on the strength of a hand-built fixture that still agrees
    // with the code.
    const { MOCK_RUNS } = await import('@/lib/data/mock-data');
    const fixture = MOCK_RUNS.find((r) => r.runId === 'run-revoked-1');
    if (!fixture?.trust) throw new Error('run-revoked-1 fixture is missing its trust summary');

    const o = await overviewFor([run('run-revoked-1', fixture.trust)]);
    // 1 pre_compromise (authorized) + 1 revoked_at_or_after + 1
    // revoked_time_unverifiable ⇒ the red KPI reads 2, not 3.
    expect(o.totals.revokedEvents).toBe(2);
    expect(o.totals.preCompromiseEvents).toBe(1);
    expect(o.totals.revokedRuns).toBe(1);
    // …and the run is a violation, so it reaches the list rather than the
    // "No trust violations" empty state.
    expect(hasTrustViolation(fixture.trust)).toBe(true);
  });
});

// ── Phase 3: `revocationReportedRuns` ──────────────────────────────────
//
// The accumulator that decides whether `/trust` shows a number or an em-dash.
// Left untested it survived a mutation that made EVERY run count as reported —
// restoring the misleading "Revoked events: 0" in production with all 447 other
// tests still green, because `trust-page.test.tsx` injects `totals` directly
// and `lib/hooks/**` is outside the coverage globs. Neither gate could see it.
describe('revocationReportedRuns', () => {
  it('does not count a run whose revocation payload is entirely zero', async () => {
    const o = await overviewFor([
      run(
        'r-quiet',
        trust({
          revoked: [],
          keyRevocationPreCompromise: 0,
          keyRevocationRevokedAtOrAfter: 0,
          keyRevocationRevokedTimeUnverifiable: 0,
        }),
      ),
    ]);
    expect(o.totals.revocationReportedRuns).toBe(0);
  });

  it('counts a run with one non-zero counter', async () => {
    const o = await overviewFor([
      run('r-loud', trust({ revoked: [], keyRevocationPreCompromise: 1 })),
    ]);
    expect(o.totals.revocationReportedRuns).toBe(1);
  });

  it('counts only the reporting runs in a mixed set', async () => {
    // The discriminating case: an accumulator that always increments, or never
    // does, gives 3 or 0 here rather than 2.
    const o = await overviewFor([
      run('r-1', trust({ revoked: [revocation('revoked_at_or_after')] })),
      run('r-2', trust({ revoked: [], keyRevocationRevokedTimeUnverifiable: 4 })),
      run('r-3', trust({ revoked: [], keyRevocationPreCompromise: 0 })),
    ]);
    expect(o.totals.revocationReportedRuns).toBe(2);
    expect(o.runs).toHaveLength(3);
  });

  it('the real demo dataset reports on run-revoked-1 and not on run-historical-1', async () => {
    const { MOCK_RUNS } = await import('@/lib/data/mock-data');
    const revoked = MOCK_RUNS.find((r) => r.runId === 'run-revoked-1');
    const historical = MOCK_RUNS.find((r) => r.runId === 'run-historical-1');
    if (!revoked?.trust || !historical?.trust) throw new Error('demo trust fixtures missing');

    const o = await overviewFor([
      run('run-revoked-1', revoked.trust),
      run('run-historical-1', historical.trust),
    ]);
    // Both arms reachable in the default mode: one run reports, one does not.
    expect(o.totals.revocationReportedRuns).toBe(1);
  });
});

// ── Phase 16: `features` passes through to /trust ──────────────────────
//
// The hook has always fetched the overview and kept two fields of it. #97 adds
// a third, and `app/trust/page.tsx` renders "revocation checking off" off the
// back of it — so a hook that silently dropped `features` would restore the
// exact ambiguity the issue is about, with the page's own tests still green
// (they inject `TrustOverview` directly and never exercise this closure).
describe('features', () => {
  const FEATURES = {
    receiptAudit: true,
    keyRevocationCheck: false,
    logWitness: true,
    logInclusionAudit: true,
    witnessCosigning: true,
    witnessQuorum: true,
  };

  it('surfaces the overview flags verbatim', async () => {
    const o = await overviewFor([run('r1', trust())], { features: FEATURES });
    expect(o.features).toEqual(FEATURES);
    // Verbatim, not rebuilt: a hand-copied subset would drop whichever flag a
    // future control-plane release adds.
    expect(o.features).toBe(FEATURES);
  });

  it('leaves an absent `features` as undefined rather than defaulting it', async () => {
    // `?? {}` here would be the defect in miniature. Every consumer reads these
    // flags with `=== true` / `=== false` so that "the control plane did not
    // say" stays a third answer; an empty object answers neither, but it also
    // makes `features === undefined` false — which is the test
    // `dashboardRevocationState` uses to reach `unknown`. Defaulting would
    // route a pre-#178 backend into the flag arms.
    const o = await overviewFor([run('r1', trust())]);
    expect(o.features).toBeUndefined();
    expect(o.features).not.toEqual({});
  });

  it('does not let the flags disturb the totals beside them', async () => {
    // Deployment-scoped next to run-scoped: the reason `/trust` may use only
    // the `=== false` arm. Asserting they are independent keeps a future
    // "helpful" default from being wired into the aggregation.
    const off = await overviewFor([run('r1', trust({ revoked: [revocation('pre_compromise')] }))], {
      features: FEATURES,
    });
    const absent = await overviewFor([
      run('r1', trust({ revoked: [revocation('pre_compromise')] })),
    ]);
    expect(off.totals).toEqual(absent.totals);
    expect(off.totals.revocationReportedRuns).toBe(1);
  });
});
