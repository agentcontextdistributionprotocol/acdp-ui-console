'use client';

import { ScrollText } from 'lucide-react';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useLogWitnessAlerts } from '@/lib/hooks/use-security';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
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
 *
 * The return distinguishes THREE cases, because two of them are not the same
 * fact and an operator acts differently on each:
 *
 *   - `null`        — the row carries no detail blob at all
 *   - `unreadable`  — there IS a blob, but its `error` is not a string, so we
 *                     hold a detail we cannot render
 *   - a string      — the message upstream wrote
 *
 * Collapsing the middle case into "no detail" would report an absence we did
 * not observe: the control plane did say something about this alert and the
 * console simply could not read it.
 */
type AlertDetail = { kind: 'none' } | { kind: 'unreadable' } | { kind: 'message'; text: string };

function alertMessage(detail: Record<string, unknown> | null): AlertDetail {
  if (detail === null || typeof detail !== 'object') return { kind: 'none' };
  const error = detail.error;
  if (typeof error === 'string') return { kind: 'message', text: error };
  if (error === undefined) return { kind: 'none' };
  return { kind: 'unreadable' };
}

/**
 * `acknowledgedBy` is `req.actorId ?? 'admin'`. On the API-key path `actorId`
 * is `token.slice(0, 8) + '...'` — a TRUNCATED KEY FINGERPRINT, not a person —
 * and this route is admin-gated, which on `auth.guard.ts`'s JWT path is
 * unreachable (`actorIsAdmin` is hardcoded `false` there), so in practice every
 * value this column can hold is a key fingerprint or the literal `'admin'`.
 *
 * The label says "key" for that reason: "Acknowledged by alice@corp" would be
 * an identity claim the control plane never made. Note the general `actorId`
 * contract is wider than this route's — on the JWT path it is `claims.sub` —
 * so the "key" wording is justified by THIS endpoint's guard, not by a
 * property of `actorId` everywhere.
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
 * Rows arrive newest-first by `at`, and a NULL `at` sorts FIRST — upstream
 * orders by `desc(lastAlertAt)` and Postgres puts NULLs FIRST on DESC. So the
 * head of the list is not necessarily the most recent alert, and nothing here
 * reads position 0 as "latest".
 *
 * **The worklist asks for ACKNOWLEDGED ROWS TOO, and that is load-bearing.**
 * Upstream, acknowledging an alert does not resolve it: `acknowledgeAlert`
 * writes `acknowledgedAt`/`acknowledgedBy` and leaves `alerted = true`; the row
 * only leaves when the underlying condition clears via `advanceCursor`.
 * Acknowledgement is a "someone has seen this" marker, not a fix. Asking for
 * the default unacknowledged-only listing would therefore hide still-outstanding
 * split-view and root-rewrite detections from the one screen built to surface
 * them — and would do it precisely for the alerts a human already touched —
 * while the empty state below claimed there were none. That is why the `State`
 * column exists and why both of its values are reachable here.
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
  // `true` — see the docblock: acknowledged does not mean resolved, so the
  // worklist would otherwise go silent on outstanding detections.
  const alerts = useLogWitnessAlerts(true);
  const rows = alerts.data?.data ?? [];

  return (
    <div className="card">
      <div className="feed-header">
        <h2>
          <ScrollText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Witness alert worklist
        </h2>
        <span className="card-sub">
          Durable transparency-log detections · one row per alerting authority ·
          acknowledged alerts stay listed until the condition clears
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
            //
            // The sentence may say "acknowledged or not" only because the
            // listing above asks for `includeAcknowledged: true`. If a future
            // edit ever narrows that request, this copy becomes false and must
            // change with it — the two are one decision, not two.
            // Deliberately phrased WITHOUT the words "healthy" or "all clear",
            // even inside a denial: the sweep that guards this copy matches
            // substrings and cannot read negation, so "not a statement that
            // those logs are healthy" would trip it — and, more to the point, a
            // reader skimming the sentence would take the reassuring half.
            description="The control plane is reporting no transparency-log detection, acknowledged or not. Authorities it has never witnessed produce no row here either way, so an empty worklist says nothing about them."
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
                {/*
                  "Environmental" is not padding. `0016_log_witness.sql`:
                  "Environmental (transport/resolution) failures since the last
                  success. Dishonesty signals do NOT count here — they set the
                  alert fields." Only `recordFailureSafe` increments it;
                  `markAlert` never does. Unqualified, beside "Root mismatch
                  (split view)", the number reads as how many times THIS alert
                  recurred, which it is not.
                */}
                <th>Consecutive environmental failures</th>
                <th>Detected</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const message = alertMessage(row.detail);
                return (
                  <tr key={row.authority}>
                    {/*
                      The FULL authority, not `shortAuthority`. This worklist's
                      whole point is covering authorities the console does not
                      proxy, and truncating at the first dot renders
                      `registry-a.playground.local` and `registry-a.corp.example`
                      identically — two different registries, one label, on the
                      screen where telling them apart is the task. It would also
                      disagree with `log-witness-card.tsx` directly below, which
                      prints the authority in full.
                    */}
                    <td className="did">{row.authority}</td>
                    <td>{reasonLabel(row.reason)}</td>
                    <td style={{ color: C.muted }}>
                      {message.kind === 'message'
                        ? message.text
                        : message.kind === 'unreadable'
                          ? 'Detail not readable'
                          : '—'}
                    </td>
                    <td>{row.consecutiveFailures}</td>
                    <td style={{ color: C.muted }}>
                      {/*
                        `at` is nullable and a null one sorts to the TOP, so
                        this cell is on the first row an operator reads.
                        `timeAgo(null)` returns the em dash `—`, which is
                        indistinguishable from the dash this table uses for "no
                        detail" — so the null case gets WORDS instead. An empty
                        or dashed cell reads as a rendering bug; "Time not
                        recorded" is the fact.
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
