'use client';

import { useQuery } from '@tanstack/react-query';
import { getCpDashboard, getCpRun, listCpRuns } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpDashboardOverview, CpRun, RunTrustSummary } from '@/lib/types';

const MAX_RUNS = 25;

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
}

export interface TrustOverview {
  runs: RunTrust[];
  totals: TrustTotals;
  receiptCoverage: NonNullable<CpDashboardOverview['receiptCoverage']>;
  didMethods: NonNullable<CpDashboardOverview['didMethods']>;
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
      const detailed = await Promise.all(
        runsRes.data.slice(0, MAX_RUNS).map((r) => getCpRun(r.runId, demoMode).catch(() => null)),
      );
      const runs: RunTrust[] = detailed
        .filter((r): r is CpRun & { trust: RunTrustSummary } => !!r && !!r.trust)
        .map((r) => ({ run: r, trust: r.trust }))
        // Surface runs with flagged discrepancies first.
        .sort((a, b) => b.trust.flagged.length - a.trust.flagged.length);

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
        }),
        { audited: 0, verified: 0, verifiedHistorical: 0, structural: 0, noReceipt: 0, errors: 0, flaggedRuns: 0, flaggedEvents: 0 },
      );

      return {
        runs,
        totals,
        receiptCoverage: dash.receiptCoverage ?? [],
        didMethods: dash.didMethods ?? [],
      };
    },
    staleTime: 20_000,
    retry: 1,
  });
}
