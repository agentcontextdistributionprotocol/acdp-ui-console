'use client';

import Link from 'next/link';
import { BadgeCheck, ShieldAlert, FileCheck2, Fingerprint, Ban } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { EmptyState } from '@/components/ui/empty-state';
import { ReceiptCoverageBars, DidMethodBars } from '@/components/trust/coverage-bars';
import { TableScroll } from '@/components/ui/table-scroll';
import { useTrust } from '@/lib/hooks/use-trust';
import {
  failClosedEntries,
  hasTrustViolation,
  revocationChipClass,
  undetailedFailClosedCount,
} from '@/lib/utils/revocation';
import { formatCtxId } from '@/lib/utils/acdp';
import { timeAgo, formatPgTimestamp } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { TrustTotals } from '@/lib/hooks/use-trust';

export default function TrustPage() {
  // No window picker here, deliberately — unlike the dashboard, which gained
  // one. `useTrust` passes `window` ONLY to `getCpDashboard` (for receipt
  // coverage and DID methods); the runs behind every violation and KPI on this
  // page come from `listCpRuns({ limit })`, which takes no window at all. A
  // picker would therefore re-scope two bar charts while silently leaving the
  // trust figures beside them unchanged — a control that claims a scope it does
  // not apply. Window-scoping the run list is a real change with its own
  // paging questions, not a fold-in.
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
        {/* Same compound branch as `/dashboard` (`error || !data`): the
            no-error-no-data case is a live path and is not a failure, so the
            literal stays and only the error arm gains a cause clause. */}
        <ErrorPanel
          message={
            trust.error
              ? operatorErrorMessage(trust.error, 'Could not load trust signals')
              : 'Trust data unavailable.'
          }
          details={errorDiagnostic(trust.error)}
        />
      </div>
    );
  }

  const { runs, totals, receiptCoverage, didMethods, features, readFailures, runsRequested } = trust.data;
  const t: TrustTotals = totals;
  // `=== false`, never `!features?.keyRevocationCheck`. The falsy form would
  // fold "no `features` at all" — a control plane predating
  // acdp-control-plane#178 — into "the operator turned it off", which is a claim
  // about a deployment decision drawn from an absence of evidence. That is the
  // whole defect class #97 exists to remove, and it would be a poor way to
  // remove it.
  const revocationCheckOff = features?.keyRevocationCheck === false;
  // A run is a violation if it carries a flagged discrepancy OR a fail-closed
  // revocation verdict. Filtering on `flagged.length` alone dropped revoked-only
  // runs into the "No trust violations" empty state while a
  // `revoked_at_or_after` verdict was live — the page asserting the opposite of
  // what its own data said.
  const violationRuns = runs.filter((r) => hasTrustViolation(r.trust));

  return (
    <div className="page">
      <SectionTitle icon={BadgeCheck} title="Trust" sub="Receipt-audit verdicts, coverage, and DID adoption · RFC-ACDP-0010" />

      {/* A cause this page COUNTED ITSELF, so it may name it — unlike the
          revocation copy below, which is forbidden from guessing one (#97's
          `assertNamesNoCause`). #115: a per-run `GET /runs/:id` rejection
          (network blip, a run since deleted upstream) used to be silently
          swallowed by `.catch(() => null)`, so every figure on this page
          quietly excluded that run with no disclosure at all — an omission
          this page is otherwise built to refuse. */}
      {readFailures > 0 && (
        <div style={{ fontSize: 11, color: C.warning, marginBottom: 10 }}>
          ⚠ {readFailures} of {runsRequested} runs could not be read — every figure below is a lower
          bound.
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard label="Verified" value={t.verified} accent="var(--success)" icon={<BadgeCheck size={28} />} />
        <KpiCard label="Historical" value={t.verifiedHistorical} accent="var(--warning)" icon={<FileCheck2 size={28} />} hint="Valid, signed by a retired key (§9)" />
        <KpiCard label="Flagged events" value={t.flaggedEvents} accent="var(--danger)" icon={<ShieldAlert size={28} />} />
        {/* Counts FAIL-CLOSED verdicts only. The old hint described just one of
            the two statuses it summed, and the value itself also included
            `pre_compromise` — an event the control plane defines as
            historically AUTHORIZED, and which this same app labels
            "(authorized)" in green on the dashboard. */}
        {/* An em-dash rather than a 0 when no run in this view reported a
            revocation classification. The control plane emits these counters
            whether or not the check ran (it is off by default), so a zero here
            would be a confident "nothing is revoked" that nobody established.

            When it DOES render, the hint names its coverage. The gate is
            per-run but the number is summed across the view, so one reporting
            run un-suppresses a total that also spans runs which reported
            nothing — reachable on a deployment that enabled the check
            recently, since older audit rows carry `key_revocation_status =
            'none'` and read as not-reported. The number is a lower bound and
            can never hide a known violation, but it must not imply a
            completeness it does not have. */}
        <KpiCard
          label="Revoked events"
          value={t.revocationReportedRuns > 0 ? t.revokedEvents : '—'}
          accent="var(--danger)"
          icon={<Ban size={28} />}
          hint={
            t.revocationReportedRuns > 0
              ? `RFC-ACDP-0014 · signed at/after a compromise boundary, or signing time unverifiable · across the ${t.revocationReportedRuns} of ${runs.length} runs that reported a classification`
              : // TWO not-reported strings now, and only the `false` arm is new
                // (#97). `features.keyRevocationCheck === false` is a fact about
                // the deployment, so this page may state it — where before it
                // could only describe the absence.
                //
                // The `true` arm deliberately does NOT get a "clean" claim; see
                // the comment on `TrustOverview.features`. `features` is
                // deployment-scoped while every total here is run-scoped, so a
                // run audited before the flag was flipped still carries
                // `key_revocation_status: 'none'` and reads as not-reported.
                // `true` + zero reporting runs therefore still cannot tell
                // "clean" from "predates the flag", and the honest wording is
                // the one that was already here.
                //
                // "In this view", not "in this window": `useTrust` fetches runs
                // via `listCpRuns({ limit })` with NO window parameter — only
                // receiptCoverage/didMethods are window-scoped. Saying "window"
                // would describe a scope this page does not apply.
                revocationCheckOff
                // Split on `runs.length`, and the split is the whole point.
                //
                // NOT "no figures are sent while it is off". That is true of the
                // DASHBOARD overview payload, where `keyRevocation` really is
                // `null` — it is false here. These figures are run-scoped, from
                // `summarizeByRun`, which always emits the three counters and
                // `revoked: []`; with the check off they arrive as zeros. The
                // suppression is THIS CONSOLE's, not the control plane's, and
                // `run-trust-panel.tsx` already says so on the identical
                // predicate ("the control plane emits these counters whether or
                // not the check ran"). Two surfaces giving contradictory
                // explanations of one suppression is exactly what
                // `lib/utils/revocation.ts` exists to prevent.
                //
                // But "the counters still arrive" is a POSITIVE existential,
                // and it is false over the empty set. `useTrust` builds `runs`
                // as the runs that came back carrying a `trust` member, and
                // `summarizeByRun` returns `null` outright when a run has no
                // audit rows — so on a deployment with `RECEIPT_AUDIT_ENABLED`
                // off (the upstream default, and the only posture in which the
                // revocation flag is *forced* false) no run carries a summary,
                // nothing arrives, and the previous single sentence told the
                // operator counters were flowing while the console held none.
                // `revocationReportedRuns === 0` is satisfied vacuously by an
                // empty run set; the sentence beneath it was not.
                //
                // The sibling arm below needs no such split: "no run in this
                // view carried a revocation classification" is a NEGATIVE
                // existential, and it is true over the empty set. That
                // asymmetry is the bug in miniature — round 5 replaced a
                // negative claim with a positive one and inherited its gate.
                ? runs.length > 0
                  ? 'Revocation checking is switched off on this deployment — the counters still arrive with every audited run, but a zero from a check that never ran is not a finding'
                  // Says only what the console can see: nothing audited reached
                  // this view. Deliberately NOT "the control plane sent no
                  // audits" — a run also lands outside `runs` when its detail
                  // fetch failed, so the cause is not ours to name.
                  : 'Revocation checking is switched off on this deployment, and no audited run reached this view — so there are no counters here at all, zero or otherwise'
                // The sibling arm splits on the same predicate, for the same
                // reason one level down. "Not reported by THIS DEPLOYMENT"
                // names a cause, and over an empty run set the console has no
                // basis for naming one: nothing audited arrived, which a
                // disabled receipt audit, a run set with no audits yet, and a
                // detail fetch that failed all produce identically. The
                // trailing clause is a true negative existential either way;
                // it was the opening clause that was doing the over-claiming,
                // which is easy to miss because the em-dash reads as an
                // apposition rather than an attribution.
                : runs.length > 0
                  ? 'Not reported by this deployment — no run in this view carried a revocation classification'
                  : 'Not reported in this view — no audited run reached it, and this console cannot tell from here why not'
          }
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
            // Suppressing the KPI's number while this line restates it as
            // "0 revoked across 0 runs" two inches below would defeat the whole
            // point — the same unestablished claim in prose instead of a digit.
            // Gated on the SAME predicate, so the two can never disagree.
            (t.revocationReportedRuns > 0
              ? `${t.revokedEvents} revoked across ${t.revokedRuns} run${t.revokedRuns === 1 ? '' : 's'}`
              : revocationCheckOff
                ? 'revocation checking off'
                : 'revocation not reported') +
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
            // would affirm a fact this page has not established. Be exact about
            // why, because the obvious reason is wrong: with
            // `KEY_REVOCATION_CHECK_ENABLED=false` (the documented default)
            // `trust.revoked` is NOT absent — `receipt-audit.repository.ts`
            // always emits it, as `[]`, and `docs/API.md` says so verbatim. An
            // empty array is exactly what "checked, clean" also looks like, so
            // the claim would be made without having looked. That
            // indistinguishability is the whole reason this phase exists.
            // …and the SECOND reason, which cost this page a gate round: the
            // sentence is a universal over `violationRuns`, so over an empty
            // run set it is vacuously true and reads as an all-clear. `runs`
            // is empty on the upstream DEFAULT posture — `RECEIPT_AUDIT_
            // ENABLED=false`, where `summarizeByRun` returns `null` for every
            // run and `useTrust` keeps only runs carrying a `trust` member —
            // and it is also empty when every detail fetch failed. The page
            // was rendering "no audited run reached this view" in the KPI row
            // and "Every audited receipt bound cleanly to its served context"
            // four inches below it, in one paint.
            //
            // Nothing audited is not nothing wrong. That is the conflation of
            // UNMONITORED with CLEAN this whole change exists to remove, so it
            // may not survive on the page the change is about.
            runs.length === 0 ? (
              <EmptyState
                title="No audited run reached this view"
                description="Nothing here has been checked, so nothing here can be reported clean. A run carries trust figures only once the control plane has audited its receipts."
              />
            ) : (
              <EmptyState
                title="No trust violations"
                description={`Every audited receipt bound cleanly to its served context, across the ${runs.length} run${runs.length === 1 ? '' : 's'} in this view.`}
              />
            )
          ) : (
            <TableScroll label="Trust findings">
              <table className="data-table">
                <caption className="sr-only">Trust findings: run, ctx id, finding, detail and when</caption>
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
                      // Same rule as the run panel: a run that reached this list
                      // on a counter-only payload must not contribute zero rows.
                      ...(undetailedFailClosedCount(rt) > 0
                        ? [
                            <tr key={`u-${run.runId}`}>
                              {runCell}
                              <td className="did">—</td>
                              <td>
                                <span className="chip bad">reported without detail</span>
                              </td>
                              <td>
                                <span className="did" style={{ fontSize: 10.5, color: C.danger }}>
                                  {undetailedFailClosedCount(rt)} fail-closed verdict
                                  {undetailedFailClosedCount(rt) === 1 ? '' : 's'} counted with no per-event detail
                                </span>
                              </td>
                              <td style={{ color: C.muted }}>{when}</td>
                            </tr>,
                          ]
                        : []),
                      ...failClosedEntries(rt.revoked).map((r) => (
                        <tr key={`r-${r.eventId}`}>
                          {runCell}
                          <td className="did">{r.ctxId ? formatCtxId(r.ctxId) : '—'}</td>
                          <td>
                            <span className={revocationChipClass(r.status)}>{r.status}</span>
                          </td>
                          <td>
                            <span className="did" style={{ fontSize: 10.5, color: C.danger }}>
                              key revoked · boundary {formatPgTimestamp(r.boundary)} · {r.trustClass}
                            </span>
                          </td>
                          <td style={{ color: C.muted }}>{when}</td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </TableScroll>
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
