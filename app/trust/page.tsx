'use client';

import Link from 'next/link';
import { BadgeCheck, ShieldAlert, FileCheck2, Fingerprint, Ban } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ReceiptCoverageBars, DidMethodBars } from '@/components/trust/coverage-bars';
import { useTrust } from '@/lib/hooks/use-trust';
import { failClosedEntries, hasTrustViolation, revocationChipClass } from '@/lib/utils/revocation';
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
  // A run is a violation if it carries a flagged discrepancy OR a fail-closed
  // revocation verdict. Filtering on `flagged.length` alone dropped revoked-only
  // runs into the "No trust violations" empty state while a
  // `revoked_at_or_after` verdict was live — the page asserting the opposite of
  // what its own data said.
  const violationRuns = runs.filter((r) => hasTrustViolation(r.trust));

  return (
    <div className="page">
      <SectionTitle icon={BadgeCheck} title="Trust" sub="Receipt-audit verdicts, coverage, and DID adoption · RFC-ACDP-0010" />

      <div className="kpi-grid">
        <KpiCard label="Verified" value={t.verified} accent="var(--success)" icon={<BadgeCheck size={28} />} />
        <KpiCard label="Historical" value={t.verifiedHistorical} accent="var(--warning)" icon={<FileCheck2 size={28} />} hint="Valid, signed by a retired key (§9)" />
        <KpiCard label="Flagged events" value={t.flaggedEvents} accent="var(--danger)" icon={<ShieldAlert size={28} />} />
        {/* Counts FAIL-CLOSED verdicts only. The old hint described just one of
            the two statuses it summed, and the value itself also included
            `pre_compromise` — an event the control plane defines as
            historically AUTHORIZED, and which this same app labels
            "(authorized)" in green on the dashboard. */}
        <KpiCard
          label="Revoked events"
          value={t.revokedEvents}
          accent="var(--danger)"
          icon={<Ban size={28} />}
          hint="RFC-ACDP-0014 · signed at/after a compromise boundary, or signing time unverifiable"
        />
        <KpiCard label="No receipt" value={t.noReceipt} accent="var(--muted)" icon={<Fingerprint size={28} />} />
      </div>

      <Card style={{ marginBottom: 12 }}>
        {/* Both mechanisms are reported separately — summing them into one
            "violations" number would repeat, in miniature, the over-claim this
            phase removes. `preCompromiseEvents` is shown here (and only when
            non-zero) because it is genuinely informative — a key WAS revoked,
            these events just predate the boundary — but it is deliberately not
            a KPI card: it is not a violation, and `.kpi-grid` is a 4-column
            grid where a fifth card already orphans onto a second row. */}
        <CardHeader
          title="Trust violations"
          sub={
            `${t.flaggedEvents} flagged across ${t.flaggedRuns} run${t.flaggedRuns === 1 ? '' : 's'} · ` +
            `${t.revokedEvents} revoked across ${t.revokedRuns} run${t.revokedRuns === 1 ? '' : 's'}` +
            (t.preCompromiseEvents > 0
              ? ` · ${t.preCompromiseEvents} pre-compromise (historically authorized, not violations)`
              : '') +
            ' · environmental errors excluded'
          }
        />
        <CardBody>
          {violationRuns.length === 0 ? (
            // NB: the description deliberately says nothing about key
            // revocation. Adding "…under a key that was still authorized" here
            // would affirm a fact this page has not established: with
            // `KEY_REVOCATION_CHECK_ENABLED=false` (the control plane's
            // documented default) `trust.revoked` is absent on every run, so
            // the claim would be made without having looked — the exact defect
            // Phase 3 exists to remove, introduced on a surface Phase 3's file
            // list does not cover.
            <EmptyState title="No trust violations" description="Every audited receipt bound cleanly to its served context." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Ctx ID</th>
                  <th>Finding</th>
                  <th>Detail</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {/* Both violation mechanisms share this table. A revoked-only
                    run previously produced NO rows here (the list flat-mapped
                    `flagged` alone), so even once such a run passed the filter
                    it would have rendered an empty table — the same false
                    "nothing to see" in a different shape. */}
                {violationRuns.flatMap(({ run, trust: rt }) => {
                  const when = timeAgo(run.completedAt ?? run.startedAt);
                  const runCell = (
                    <td className="did">
                      <Link href={`/runs/${run.runId}`} style={{ color: C.info }}>
                        {run.runId}
                      </Link>
                    </td>
                  );
                  return [
                    ...rt.flagged.map((f) => (
                      <tr key={`f-${f.eventId}`}>
                        {runCell}
                        <td className="did">{f.ctxId ? formatCtxId(f.ctxId) : '—'}</td>
                        <td>
                          <span className="chip bad">{f.status}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {f.discrepancies.map((d, i) => (
                              <span key={i} className="did" style={{ fontSize: 10.5, color: C.danger }}>
                                {d}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ color: C.muted }}>{when}</td>
                      </tr>
                    )),
                    ...failClosedEntries(rt.revoked).map((r) => (
                      <tr key={`r-${r.eventId}`}>
                        {runCell}
                        <td className="did">{r.ctxId ? formatCtxId(r.ctxId) : '—'}</td>
                        <td>
                          <span className={revocationChipClass(r.status)}>{r.status}</span>
                        </td>
                        <td>
                          <span className="did" style={{ fontSize: 10.5, color: C.danger }}>
                            {/* `boundary` is a Postgres textual timestamp
                                ("2026-08-01 00:00:00+00"). `new Date(...)`
                                parses it directly; do NOT normalise it to
                                ISO-8601 first — the result is stricter about
                                the offset and rejects the short "+00" form,
                                yielding Invalid Date. Same trap documented at
                                length in components/runs/run-trust-panel.tsx. */}
                            key revoked · boundary {new Date(r.boundary).toLocaleString()} · {r.trustClass}
                          </span>
                        </td>
                        <td style={{ color: C.muted }}>{when}</td>
                      </tr>
                    )),
                  ];
                })}
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
