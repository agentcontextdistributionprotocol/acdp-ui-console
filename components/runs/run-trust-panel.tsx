'use client';

import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { formatCtxId } from '@/lib/utils/acdp';
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
 * Receipt-audit verdict summary for a run (RFC-ACDP-0010). Renders only when the
 * control plane has produced a verdict (`run.trust` non-null). `error` counts are
 * environmental (unreachable/timeout) and shown muted, not as trust violations —
 * only `flagged` discrepancies are real violations.
 */
export function RunTrustPanel({ trust }: { trust: RunTrustSummary }) {
  const hasFlags = trust.flagged.length > 0;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="feed-header">
        <h2>
          {hasFlags ? (
            <ShieldAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: C.danger }} />
          ) : (
            <BadgeCheck size={14} style={{ verticalAlign: -2, marginRight: 6, color: C.success }} />
          )}
          Receipt audit
        </h2>
        <span className="card-sub">RFC-ACDP-0010 · {trust.audited} event{trust.audited === 1 ? '' : 's'} audited</span>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: hasFlags ? 14 : 0 }}>
          <Stat label="Verified" value={trust.verified} tone={C.success} />
          <Stat label="Historical" value={trust.verifiedHistorical} tone={C.warning} />
          <Stat label="Structural" value={trust.structural} tone={C.info} />
          <Stat label="No receipt" value={trust.noReceipt} tone={C.muted} />
          <Stat label="Flagged" value={trust.flagged.length} tone={hasFlags ? C.danger : C.muted} />
          <Stat label="Errors" value={trust.errors} tone={C.muted} />
        </div>

        {hasFlags && (
          <table className="data-table">
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
      </div>
    </div>
  );
}
