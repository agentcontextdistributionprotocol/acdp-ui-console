'use client';

import { useQuery } from '@tanstack/react-query';
import { getCpDashboard, getCpRun, listCpRuns } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import {
  failClosedCount,
  hasFailClosedRevocation,
  preCompromiseCount,
  runRevocationReported,
  violationCount,
} from '@/lib/utils/revocation';
import type { CpDashboardOverview, CpRun, RunTrustSummary } from '@/lib/types';

/**
 * How many recent runs the trust page audits.
 *
 * EXPORTED so a test can bound its sweep by the value this hook uses rather
 * than by a number parsed out of this file. Round 13's B2: the test read
 * `/const\s+MAX_RUNS\s*=\s*(\d+)/`, which is unanchored, so rewriting this
 * to `5 * 5` — same value, same fetch — silently narrowed the sweep's ceiling
 * from 25 to 5 with the whole suite green. A parser written to stop a number
 * drifting drifted, and less visibly than the hand-written number it replaced.
 */
export const MAX_RUNS = 25;

export interface RunTrust {
  run: CpRun;
  trust: RunTrustSummary;
}

export interface TrustTotals {
  audited: number;
  verified: number;
  verifiedHistorical: number;
  structural: number;
  noReceipt: number;
  errors: number;
  flaggedRuns: number;
  flaggedEvents: number;
  /**
   * Runs / events carrying a FAIL-CLOSED revocation verdict
   * (`revoked_at_or_after`, `revoked_time_unverifiable`, or an unrecognised
   * status). These deliberately EXCLUDE `pre_compromise`, which the control
   * plane defines as historically authorized — see `lib/utils/revocation.ts`.
   * They previously counted every `revoked[]` row, so an authorized event was
   * summed into a KPI labelled "signed at/after a compromise boundary".
   */
  revokedRuns: number;
  revokedEvents: number;
  /** Historically-authorized events, surfaced separately — never a violation. */
  preCompromiseEvents: number;
  /**
   * How many of the aggregated runs actually REPORTED a revocation
   * classification. Zero means every run in this view is ambiguous (or
   * definitively unchecked), so the revocation KPI must not render a number —
   * a "0" there would claim a clean estate nobody established. See
   * `runRevocationReported`.
   *
   * "In this view", not "in the window": `window` below is passed ONLY to
   * `getCpDashboard`, for receipt coverage and DID methods. The runs behind
   * every figure on `/trust` come from `listCpRuns({ limit })`, which takes no
   * window at all. `app/trust/page.tsx` words its copy accordingly.
   */
  revocationReportedRuns: number;
}

export interface TrustOverview {
  runs: RunTrust[];
  totals: TrustTotals;
  receiptCoverage: NonNullable<CpDashboardOverview['receiptCoverage']>;
  didMethods: NonNullable<CpDashboardOverview['didMethods']>;
  /**
   * Which checks the DEPLOYMENT runs (#97). Already on the wire — this hook has
   * always fetched the overview and discarded everything but the two fields
   * above — so surfacing it costs one line and no request.
   *
   * Deployment-scoped, and that limits what `/trust` may do with it. The
   * totals beside it are RUN-scoped: a run audited before the flag was flipped
   * carries `key_revocation_status: 'none'` forever, so
   * `keyRevocationCheck === true` with `revocationReportedRuns === 0` still
   * cannot tell "clean" from "predates the flag". Only the `=== false` arm is
   * safe here, which is why `/trust` gets that arm and not the dashboard's
   * `checked-clean`.
   *
   * `undefined` for a control plane predating acdp-control-plane#178.
   */
  features: CpDashboardOverview['features'];
  /**
   * How many of the `runsRequested` per-run fetches (`GET /runs/:id`, for the
   * `trust` member) rejected, rather than resolving — #115.
   *
   * A resolved `null` (a run with no audit rows) is NOT a read failure; only a
   * REJECTED settlement counts. `error` on this hook's own `UseQueryResult`
   * stays `null` for this case — only the two outer calls
   * (`getCpDashboard`/`listCpRuns`) can fail the query outright, and
   * `Promise.allSettled` cannot reject regardless of how many of its inputs
   * do. So a partial per-run failure is disclosed on the page as a lower-bound
   * qualifier, never as `trust.error`.
   */
  readFailures: number;
  /**
   * The denominator `readFailures` is a fraction of: `requested.length`, i.e.
   * `min(MAX_RUNS, listCpRuns's result)` — NOT the post-filter `runs.length`
   * above, which has already dropped both the read failures and any resolved
   * run with no `trust` member. Using `runs.length` as the denominator would
   * make every failure silently shrink the fraction's own base.
   */
  runsRequested: number;
}

/**
 * Aggregate trust view for the /trust page. There is no single trust endpoint,
 * so we compose it client-side: receipt coverage + DID-method adoption come from
 * the dashboard overview, and the per-run receipt-audit verdicts are fetched per
 * run (the `trust` member only rides `GET /runs/:id`, not the list endpoint).
 */
export function useTrust(window = '24h') {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery<TrustOverview>({
    queryKey: ['trust', window, demoMode],
    queryFn: async () => {
      const [dash, runsRes] = await Promise.all([
        getCpDashboard(window, demoMode),
        listCpRuns({ limit: MAX_RUNS }, demoMode),
      ]);
      const requested = runsRes.data.slice(0, MAX_RUNS);
      const settled = await Promise.allSettled(requested.map((r) => getCpRun(r.runId, demoMode)));
      const readFailures = settled.filter((s) => s.status === 'rejected').length;
      const detailed = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
      const runs: RunTrust[] = detailed
        .filter((r): r is CpRun & { trust: RunTrustSummary } => !!r && !!r.trust)
        .map((r) => ({ run: r, trust: r.trust }))
        // Surface runs with VIOLATIONS first — a flagged discrepancy and a
        // fail-closed revocation verdict are both violations, via different
        // mechanisms. Sorting on `flagged.length` alone sank a revoked-only
        // run to the bottom of the page whose whole job is surfacing it.
        .sort((a, b) => violationCount(b.trust) - violationCount(a.trust));

      const totals = runs.reduce<TrustTotals>(
        (acc, { trust }) => ({
          audited: acc.audited + trust.audited,
          verified: acc.verified + trust.verified,
          verifiedHistorical: acc.verifiedHistorical + trust.verifiedHistorical,
          structural: acc.structural + trust.structural,
          noReceipt: acc.noReceipt + trust.noReceipt,
          errors: acc.errors + trust.errors,
          flaggedRuns: acc.flaggedRuns + (trust.flagged.length > 0 ? 1 : 0),
          flaggedEvents: acc.flaggedEvents + trust.flagged.length,
          revokedRuns: acc.revokedRuns + (hasFailClosedRevocation(trust) ? 1 : 0),
          revokedEvents: acc.revokedEvents + failClosedCount(trust),
          preCompromiseEvents: acc.preCompromiseEvents + preCompromiseCount(trust),
          revocationReportedRuns: acc.revocationReportedRuns + (runRevocationReported(trust) ? 1 : 0),
        }),
        {
          audited: 0,
          verified: 0,
          verifiedHistorical: 0,
          structural: 0,
          noReceipt: 0,
          errors: 0,
          flaggedRuns: 0,
          flaggedEvents: 0,
          revokedRuns: 0,
          revokedEvents: 0,
          preCompromiseEvents: 0,
          revocationReportedRuns: 0,
        },
      );

      return {
        runs,
        totals,
        receiptCoverage: dash.receiptCoverage ?? [],
        didMethods: dash.didMethods ?? [],
        // NOT defaulted. `?? {}` would be a partial object, and every read of
        // these flags is `=== true` / `=== false` precisely so that "absent"
        // stays its own answer rather than collapsing into "off".
        features: dash.features,
        readFailures,
        runsRequested: requested.length,
      };
    },
    staleTime: 20_000,
    retry: 1,
  });
}
