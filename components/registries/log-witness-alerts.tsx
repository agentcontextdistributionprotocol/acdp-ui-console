'use client';

import { ScrollText } from 'lucide-react';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useLogWitnessAlerts } from '@/lib/hooks/use-security';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { shortAuthority } from '@/lib/utils/acdp';
import { timeAgo, clockTime } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { LogWitnessAlertRow } from '@/lib/types';

/**
 * Human wording for the six reasons `checkpoint-witness.service.ts` raises.
 *
 * A lookup, NOT an exhaustive `Record<WitnessAlertReason, string>`: the union
 * carries a `(string & {})` tail because the column is `varchar(64)` with no
 * CHECK constraint, so a newer control plane can send a seventh reason. An
 * unrecognised value falls through to its RAW STRING rather than to a blank
 * cell or a dropped row — a witness alert we cannot name is still a witness
 * alert, and the one thing this table must never do is hide one.
 */
const REASON_LABEL: Record<string, string> = {
  checkpoint_invalid: 'Checkpoint invalid',
  checkpoint_signature_invalid: 'Checkpoint signature invalid',
  tree_size_regression: 'Tree size went backwards',
  root_mismatch: 'Root mismatch (split view)',
  consistency_failed: 'Consistency proof failed',
  log_id_changed: 'Log ID changed',
};

/**
 * The reason as TEXT, always. Never a chip colour alone.
 *
 * `CLAUDE.md` and `log-witness-card.tsx`'s `freshQuorumVerdict` both record the
 * rule: a distinction carried only by colour is invisible to a screen reader,
 * to greyscale and to a printout. So the label is the payload and any tone is
 * decoration on top of it.
 */
function reasonLabel(reason: string | null): string {
  if (reason === null) return 'Reason not recorded';
  return REASON_LABEL[reason] ?? reason;
}

/**
 * Every upstream `raiseAlert` call site puts the human-readable message in
 * `detail.error`; nothing else in the jsonb blob is a stable contract. Same
 * guard as `log-witness-card.tsx`'s `alertMessage` — `detail` is an OBJECT, so
 * `String(detail)` renders `[object Object]`, and a non-string `error` (a
 * nested object from some future call site) must render nothing rather than
 * that.
 */
function alertMessage(detail: Record<string, unknown> | null): string | undefined {
  const error = detail?.error;
  return typeof error === 'string' ? error : undefined;
}

/**
 * `acknowledgedBy` is `req.actorId ?? 'admin'`, and `actorId` is
 * `token.slice(0, 8) + '...'` — a TRUNCATED API-KEY FINGERPRINT, not a person.
 * The label says "key" for that reason: "Acknowledged by alice@corp" would be
 * an identity claim the control plane never made.
 */
function AcknowledgedCell({ row }: { row: LogWitnessAlertRow }) {
  if (row.acknowledgedAt === null) {
    // Distinct words, not an empty cell: unacknowledged is an operational
    // state, and a blank reads as missing data.
    return <span className="chip warn">Open</span>;
  }
  return (
    <span style={{ color: C.muted }}>
      <span className="chip ok" style={{ marginRight: 6 }}>
        Acknowledged
      </span>
      {timeAgo(row.acknowledgedAt)}
      {row.acknowledgedBy && <> · key {row.acknowledgedBy}</>}
    </span>
  );
}

/**
 * The durable transparency-log alert worklist (#84), across every authority
 * the control plane witnesses — not only the two this console proxies.
 *
 * One row per ALERTED AUTHORITY: the table's primary key is
 * `(tenantId, registryAuthority)`, so an authority holds at most one alert at a
 * time and a new detection overwrites the previous one. This is a worklist, not
 * a history.
 *
 * Rows arrive newest-first by `at`, and a NULL `at` sorts FIRST — so the head
 * of the list is not necessarily the most recent alert. Nothing here reads
 * position 0 as "latest".
 *
 * The error copy is deliberately the GENERIC panel. Unlike `/auth/revocations`,
 * this endpoint carries no admin guard upstream (`registries.controller.ts` has
 * no `actorIsAdmin` check on it) — it is only tenant-scoped behind the global
 * guard whose bearer the proxy injects. Reusing the revocation feed's "grant
 * the key admin scope" copy would send an operator to fix something that was
 * never the cause, which is the exact mistake `log-witness-card.tsx` and
 * `getLogWitness`'s docblock were written to prevent.
 */
export function LogWitnessAlerts() {
  const alerts = useLogWitnessAlerts();
  const rows = alerts.data?.data ?? [];

  return (
    <div className="card">
      <div className="feed-header">
        <h2>
          <ScrollText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Witness alert worklist
        </h2>
        <span className="card-sub">
          Durable transparency-log detections · one row per alerting authority
        </span>
      </div>
      <div className="card-body">
        {alerts.isLoading && <LoadingSkeleton rows={3} height={36} />}
        {alerts.error && (
          <ErrorPanel
            message={operatorErrorMessage(alerts.error, 'Could not load the witness alert worklist')}
            details={errorDiagnostic(alerts.error)}
          />
        )}
        {!alerts.isLoading && !alerts.error && rows.length === 0 && (
          <EmptyState
            title="No alert is currently recorded"
            // NOT "the transparency logs are healthy". This worklist lists only
            // authorities that ARE alerting; it says nothing about a log that
            // was never witnessed, and a registry the control plane has never
            // talked to produces no row either way. Claiming health from an
            // empty list would be a verdict drawn from an absence.
            description="The control plane is reporting no outstanding transparency-log detection. Authorities it has never witnessed do not appear here at all."
          />
        )}
        {rows.length > 0 && (
          // TODO(#93/PR G): wrap in `<TableScroll label="Witness alerts">` once
          // Phase 11's component is on main. It is not on this branch, and
          // duplicating the component plus its CSS here would collide with that
          // PR on two files. PR G merges first, and its table-discovery gate
          // scans every `.data-table` in `app/` and `components/`, so the
          // rebase FAILS LOUDLY if this is forgotten rather than shipping
          // unwrapped.
          <table className="data-table">
            <thead>
              <tr>
                <th>Authority</th>
                <th>Reason</th>
                <th>Detail</th>
                <th>Consecutive failures</th>
                <th>Detected</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const message = alertMessage(row.detail);
                return (
                  <tr key={row.authority}>
                    <td className="did">{shortAuthority(row.authority)}</td>
                    <td>{reasonLabel(row.reason)}</td>
                    <td style={{ color: C.muted }}>{message ?? '—'}</td>
                    <td>{row.consecutiveFailures}</td>
                    <td style={{ color: C.muted }}>
                      {/*
                        `at` is nullable and a null one sorts to the TOP, so
                        this cell is on the first row an operator reads.
                        `timeAgo(null)` would render `Invalid Date`, and an
                        empty cell reads as a rendering bug rather than as a
                        fact about the data.
                      */}
                      {row.at === null ? 'Time not recorded' : `${timeAgo(row.at)} · ${clockTime(row.at)}`}
                    </td>
                    <td>
                      <AcknowledgedCell row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
