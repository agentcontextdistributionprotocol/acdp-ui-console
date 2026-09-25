'use client';

import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { formatCtxId } from '@/lib/utils/acdp';
import {
  failClosedCount,
  hasTrustViolation,
  preCompromiseEntries,
  revocationChipClass,
  runRevocationReported,
  undetailedFailClosedCount,
} from '@/lib/utils/revocation';
import { C } from '@/lib/colors';
import type { RunTrustSummary } from '@/lib/types';

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 64 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: tone }}>{value}</span>
      <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

/**
 * Receipt-audit verdict summary for a run (RFC-ACDP-0010 + RFC-ACDP-0014).
 * Renders only when the control plane has produced a verdict (`run.trust`
 * non-null). `error` counts are environmental (unreachable/timeout) and shown
 * muted, not as trust violations.
 *
 * **A violation is a `flagged` discrepancy OR a fail-closed revocation
 * verdict.** The earlier version of this comment said only `flagged`
 * discrepancies were real violations, and the code matched it — which is why a
 * run carrying a live `revoked_at_or_after` verdict rendered a green
 * check-mark. `flagged` is a content/signature discrepancy; a fail-closed
 * revocation is a signing key whose authority was revoked (RFC-ACDP-0014 §7).
 * Different mechanisms, equally disqualifying. See `lib/utils/revocation.ts`
 * for why `pre_compromise` is deliberately NOT one of them.
 */
export function RunTrustPanel({ trust }: { trust: RunTrustSummary }) {
  const hasFlags = trust.flagged.length > 0;
  const revoked = trust.revoked ?? [];
  const hasRevoked = revoked.length > 0;
  const preCompromise = preCompromiseEntries(revoked);
  // The header verdict must reflect BOTH violation mechanisms — via the one
  // shared predicate, so this panel, `/trust`'s filter and `useTrust`'s sort
  // cannot drift apart again.
  const hasViolation = hasTrustViolation(trust);
  const revocationReported = runRevocationReported(trust);
  // Counted across BOTH the per-event array and the aggregate counters, so a
  // payload reporting fail-closed verdicts without per-event detail still
  // reddens this panel rather than rendering a reassuring zero.
  const failedClosedTotal = failClosedCount(trust);
  const undetailed = undetailedFailClosedCount(trust);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="feed-header">
        <h2>
          {hasViolation ? (
            <ShieldAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: C.danger }} />
          ) : (
            <BadgeCheck size={14} style={{ verticalAlign: -2, marginRight: 6, color: C.success }} />
          )}
          Receipt audit
        </h2>
        <span className="card-sub">RFC-ACDP-0010 · {trust.audited} event{trust.audited === 1 ? '' : 's'} audited</span>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: hasFlags || hasRevoked ? 14 : 0 }}>
          <Stat label="Verified" value={trust.verified} tone={C.success} />
          <Stat label="Historical" value={trust.verifiedHistorical} tone={C.warning} />
          {/* The two revocation stats render ONLY when this run's payload
              actually carried a revocation classification. A "Revoked 0" from a
              deployment whose revocation check never ran is a confident
              "nothing is revoked" that nobody established — see
              `runRevocationReported`. Pre-compromise sits beside "Historical"
              because it is conceptually the same thing: valid, but signed under
              a key that is no longer current. */}
          {revocationReported && (
            <Stat label="Pre-compromise" value={preCompromise.length} tone={C.muted} />
          )}
          <Stat label="Structural" value={trust.structural} tone={C.info} />
          <Stat label="No receipt" value={trust.noReceipt} tone={C.muted} />
          <Stat label="Flagged" value={trust.flagged.length} tone={hasFlags ? C.danger : C.muted} />
          {revocationReported && (
            <Stat label="Revoked" value={failedClosedTotal} tone={failedClosedTotal > 0 ? C.danger : C.muted} />
          )}
          <Stat label="Errors" value={trust.errors} tone={C.muted} />
        </div>

        {/* The `audited === 0` variant is a DEFENSIVE branch, not a second
            live path: `summarizeByRun` returns null rather than a zero-audit
            summary, and `run-workbench.tsx` renders this panel only when
            `run.trust` exists — so "receipt audit is off" reaches an operator
            as no panel at all. See `runRevocationReported`'s docblock. */}
        {!revocationReported && (
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: hasFlags || hasRevoked ? 10 : 0 }}>
            Key revocation not reported for this run
            {trust.audited === 0
              ? ' — no receipt-audit events, so no revocation classification could have run.'
              : ' — no revocation verdicts were classified, and the control plane emits these counters whether or not the check ran.'}
          </div>
        )}

        {/* A reddened panel must never render an empty findings table — that
            was the Phase 2 defect, and counting the aggregate counters would
            reintroduce it for the one payload where they outrun the array.
            Say what is known instead of showing nothing. */}
        {undetailed > 0 && (
          <div style={{ fontSize: 10.5, color: C.danger, marginBottom: 10 }}>
            {undetailed} fail-closed revocation verdict{undetailed === 1 ? '' : 's'} counted for this run
            with no per-event detail in the payload — the count is reported, the events are not listed below.
          </div>
        )}

        {hasFlags && (
          <table className="data-table" style={{ marginBottom: hasRevoked ? 14 : 0 }}>
            <thead>
              <tr>
                <th>Ctx ID</th>
                <th>Status</th>
                <th>Discrepancies</th>
              </tr>
            </thead>
            <tbody>
              {trust.flagged.map((f) => (
                <tr key={f.eventId}>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hasRevoked && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ctx ID</th>
                <th>Status</th>
                <th>Boundary</th>
                <th>Trust class</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {revoked.map((r) => (
                <tr key={r.eventId}>
                  <td className="did">{r.ctxId ? formatCtxId(r.ctxId) : '—'}</td>
                  <td>
                    <span className={revocationChipClass(r.status)}>{r.status}</span>
                  </td>
                  <td className="did" style={{ fontSize: 10.5 }}>
                    {/* control-plane's `boundary` is a Postgres textual timestamp
                        ("2026-08-01 00:00:00+00" — space-separated, short "+00"
                        offset, no ms). `new Date(...)` parses this directly; do
                        NOT `.replace(' ', 'T')` first — the resulting ISO-8601-
                        shaped string is stricter about the timezone offset and
                        rejects the short "+00" form (Invalid Date), silently
                        breaking this exact case. */}
                    {new Date(r.boundary).toLocaleString()}
                  </td>
                  <td>{r.trustClass}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {r.sources.map((s, i) => (
                        <span key={i} className="did" style={{ fontSize: 10.5, color: C.muted }}>
                          {formatCtxId(s.ctxId)} · {s.publisher}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
