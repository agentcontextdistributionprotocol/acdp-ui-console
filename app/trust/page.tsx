'use client';

import Link from 'next/link';
import { BadgeCheck, ShieldAlert, FileCheck2, Fingerprint } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ReceiptCoverageBars, DidMethodBars } from '@/components/trust/coverage-bars';
import { useTrust } from '@/lib/hooks/use-trust';
import { formatCtxId } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { TrustTotals } from '@/lib/hooks/use-trust';

export default function TrustPage() {
  const trust = useTrust('24h');

  if (trust.isLoading) {
    return (
      <div className="page">
        <SectionTitle icon={BadgeCheck} title="Trust" sub="Receipt-audit verdicts, coverage, and DID adoption" />
        <LoadingPanel label="Loading trust signals…" />
      </div>
    );
  }
  if (trust.error || !trust.data) {
    return (
      <div className="page">
        <SectionTitle icon={BadgeCheck} title="Trust" />
        <ErrorPanel message={String(trust.error ?? 'Trust data unavailable.')} />
      </div>
    );
  }

  const { runs, totals, receiptCoverage, didMethods } = trust.data;
  const t: TrustTotals = totals;
  const flaggedRuns = runs.filter((r) => r.trust.flagged.length > 0);

  return (
    <div className="page">
      <SectionTitle icon={BadgeCheck} title="Trust" sub="Receipt-audit verdicts, coverage, and DID adoption · RFC-ACDP-0010" />

      <div className="kpi-grid">
        <KpiCard label="Verified" value={t.verified} accent="var(--success)" icon={<BadgeCheck size={28} />} />
        <KpiCard label="Historical" value={t.verifiedHistorical} accent="var(--warning)" icon={<FileCheck2 size={28} />} hint="Valid, signed by a retired key (§9)" />
        <KpiCard label="Flagged events" value={t.flaggedEvents} accent="var(--danger)" icon={<ShieldAlert size={28} />} />
        <KpiCard label="No receipt" value={t.noReceipt} accent="var(--muted)" icon={<Fingerprint size={28} />} />
      </div>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader
          title="Flagged discrepancies"
          sub={`${t.flaggedEvents} across ${t.flaggedRuns} run${t.flaggedRuns === 1 ? '' : 's'} · environmental errors excluded`}
        />
        <CardBody>
          {flaggedRuns.length === 0 ? (
            <EmptyState title="No trust violations" description="Every audited receipt bound cleanly to its served context." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Ctx ID</th>
                  <th>Discrepancies</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {flaggedRuns.flatMap(({ run, trust: rt }) =>
                  rt.flagged.map((f) => (
                    <tr key={f.eventId}>
                      <td className="did">
                        <Link href={`/runs/${run.runId}`} style={{ color: C.info }}>
                          {run.runId}
                        </Link>
                      </td>
                      <td className="did">{f.ctxId ? formatCtxId(f.ctxId) : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {f.discrepancies.map((d, i) => (
                            <span key={i} className="did" style={{ fontSize: 10.5, color: C.danger }}>
                              {d}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ color: C.muted }}>{timeAgo(run.completedAt ?? run.startedAt)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHeader title="Receipt Coverage" sub="Receipts per publish, by registry" />
          <CardBody>
            <ReceiptCoverageBars coverage={receiptCoverage} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Producer DID Methods" sub="did:web vs did:key adoption" />
          <CardBody>
            <DidMethodBars methods={didMethods} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
