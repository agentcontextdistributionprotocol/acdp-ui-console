'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLogWitnessAlerts } from '@/lib/hooks/use-security';
import { acknowledgeLogWitnessAlert } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { ApiError } from '@/lib/api/fetcher';
import {
  ADMIN_ROUTE_FORBIDDEN,
  errorDiagnostic,
  isUpstreamForbidden,
  operatorErrorMessage,
} from '@/lib/utils/api-error-messages';
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
 * What the 404 means HERE, which is not what a 404 usually means.
 *
 * `acknowledgeAlert` updates `WHERE alerted = true`, so the row has to be
 * alerting for the ack to land. A 404 therefore says the alert went away
 * between the render and the click — the condition RESOLVED and
 * `advanceCursor` cleared the row — not that the authority is unknown. Calling
 * that a failure would have an operator chasing a registry that just got
 * better.
 */
const ACK_ALREADY_RESOLVED =
  'There is no longer an alert to acknowledge for this authority. The control plane clears the ' +
  'alert on its own once the condition resolves, so this one most likely cleared between loading ' +
  'the table and confirming. The worklist has been refreshed.';

/**
 * The confirm step (#84).
 *
 * It exists because "acknowledge" is the single most over-read word on this
 * page: three separate upstream behaviours make it NOT a resolution, and an
 * operator who assumes otherwise stops watching a log that is still being
 * detected as dishonest. So the dialog states all three as facts rather than
 * asking "are you sure?", which conveys nothing.
 *
 * The control is rendered UNCONDITIONALLY and the 403 is handled after the
 * fact. No control-plane endpoint reports the caller's own scope — `features`
 * carries deployment flags, not permissions — so a pre-disabled button would be
 * guessing. Nor is it gated on the revocation feed's 403: that is a DIFFERENT
 * route's guard, and inferring this one from it would hide a control that works
 * (or offer one that does not) on the strength of an unrelated answer.
 */
function AcknowledgeDialog({
  row,
  onClose,
}: {
  row: LogWitnessAlertRow;
  onClose: () => void;
}) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const queryClient = useQueryClient();
  const mut = useMutation({
    mutationFn: () => acknowledgeLogWitnessAlert(row.authority, demoMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['log-witness-alerts'] });
      onClose();
    },
    onError: (error) => {
      // A 404 is the alert having resolved underneath us, so the table is now
      // stale in the operator's favour. Refetch on that path only — a 403
      // changed nothing upstream and a refetch would just repeat the read.
      if (error instanceof ApiError && error.status === 404) {
        queryClient.invalidateQueries({ queryKey: ['log-witness-alerts'] });
      }
    },
  });

  const resolved = mut.error instanceof ApiError && mut.error.status === 404;
  const forbidden = isUpstreamForbidden(mut.error);

  return (
    <Modal
      open
      onClose={onClose}
      // The FULL authority, matching the table beneath it. `shortAuthority`
      // truncates at the first dot, so a confirm dialog for
      // `registry-a.corp.example` would be captioned identically to one for
      // `registry-a.playground.local` — on the one control that writes.
      title={`Acknowledge ${row.authority}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {/* "Close" rather than "Cancel" once the alert turned out to be
                gone: there is nothing left to cancel, and offering to cancel an
                action that already cannot happen is a false choice. */}
            {resolved ? 'Close' : 'Cancel'}
          </Button>
          {!resolved && (
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0 }}>
          Recording an acknowledgement for <strong>{row.authority}</strong>, currently alerting:{' '}
          <strong>{reasonLabel(row.reason)}</strong>.
        </p>
        {/* The three facts, as facts. Not a confirmation prompt. */}
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>
            It records <strong>which key</strong> saw this alert, and when. The control plane
            derives that from the credential this console sends — it is not a person&rsquo;s name,
            and you cannot acknowledge on someone else&rsquo;s behalf.
          </li>
          <li>
            It does <strong>not clear the alert</strong> and does not touch the retained head. The
            authority stays alerted until the control plane witnesses a consistent checkpoint again.
          </li>
          <li>
            The row leaves this worklist by default. A later detection with a{' '}
            <strong>different</strong> reason brings it back; a repeat of the{' '}
            <strong>same</strong> reason does <strong>not</strong> — so an unchanged, ongoing
            detection stays hidden until you use <em>Show acknowledged</em> above.
          </li>
        </ul>
        {resolved && <ErrorPanel message={ACK_ALREADY_RESOLVED} />}
        {forbidden && (
          <ErrorPanel
            // Acknowledging IS admin-gated upstream (`actorIsAdmin`), unlike
            // reading the worklist. So this is the one place on this card where
            // the admin-scope copy is the correct advice rather than a wrong
            // guess — and the copy still refuses to pick a single cause,
            // because the control plane sends no code to pick one with.
            message={ADMIN_ROUTE_FORBIDDEN}
            details={errorDiagnostic(mut.error)}
          />
        )}
        {mut.error && !resolved && !forbidden && (
          <ErrorPanel
            message={operatorErrorMessage(mut.error, 'Could not record the acknowledgement')}
            details={errorDiagnostic(mut.error)}
          />
        )}
      </div>
    </Modal>
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
  // The toggle FILTERS DOWN; it does not open up. The default is the full
  // listing, because acknowledging an alert does not resolve it upstream —
  // `acknowledgeAlert` leaves `alerted = true` and only `advanceCursor` clears
  // the condition. Defaulting to the unacknowledged-only listing would make an
  // ongoing, unchanged detection vanish from this console the moment someone
  // acked it, which is the defect this worklist's first gate round was about.
  //
  // The filtered view still exists, because "what has nobody looked at yet" is
  // a real question when triaging — it is just not what this screen asserts by
  // default, and the empty-state copy below changes with it so neither view
  // claims the other's scope.
  const [showAcknowledged, setShowAcknowledged] = useState(true);
  const alerts = useLogWitnessAlerts(showAcknowledged);
  const rows = alerts.data?.data ?? [];
  // The authority under confirmation, NOT the row object: the list refetches
  // while the dialog is open, and holding a stale row would confirm against
  // a reason the table no longer shows.
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmRow = rows.find((r) => r.authority === confirming) ?? null;

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
        <Button
          variant="secondary"
          // `aria-pressed` rather than two different labels: this is one
          // control with a state, and a button whose accessible name changes
          // under the cursor is announced as a new control each time.
          aria-pressed={showAcknowledged}
          onClick={() => setShowAcknowledged((v) => !v)}
        >
          {showAcknowledged ? 'Hide acknowledged' : 'Show acknowledged'}
        </Button>
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
            title={
              showAcknowledged ? 'No alert is recorded at all' : 'No unacknowledged alert is recorded'
            }
            // NOT "the transparency logs are healthy". This worklist lists only
            // authorities that ARE alerting; it says nothing about a log that
            // was never witnessed, and a registry the control plane has never
            // talked to produces no row either way. Claiming health from an
            // empty list would be a verdict drawn from an absence.
            //
            // The sentence states WHICH listing produced the emptiness, and it
            // is a function of the flag for that reason: a filtered emptiness
            // that read like a full one would be the same over-claim in a new
            // place. The two move together — if a future edit changes the
            // request, this copy is false until it changes with it.
            //
            // Both arms are deliberately phrased WITHOUT the words "healthy" or
            // "all clear", even inside a denial: the sweep that guards this copy
            // matches substrings and cannot read negation, so "not a statement
            // that those logs are healthy" would trip it — and, more to the
            // point, a reader skimming the sentence takes the reassuring half.
            description={
              showAcknowledged
                ? 'The control plane is reporting no transparency-log detection, acknowledged or not. Authorities it has never witnessed produce no row here either way, so an empty worklist says nothing about them.'
                : 'The control plane is reporting no UNACKNOWLEDGED transparency-log detection. Acknowledged alerts are still alerts and are hidden in this view — show them to check. Authorities it has never witnessed produce no row either way, so this says nothing about them.'
            }
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
                <th>Acknowledge</th>
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
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirming(row.authority)}
                        // Named per row, because six buttons all reading
                        // "Acknowledge" are six identical stops in a screen
                        // reader's control list with no way to tell which
                        // authority each one acts on.
                        aria-label={`${row.acknowledgedAt === null ? 'Acknowledge' : 'Re-acknowledge'} ${row.authority}`}
                      >
                        {/* Already acknowledged and still alerting: upstream's
                            update is unconditional, so the action is available
                            rather than disabled — and the word changes so it
                            does not read as an action with no effect. */}
                        {row.acknowledgedAt === null ? 'Acknowledge' : 'Re-acknowledge'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {/* Keyed on the authority so switching rows remounts the dialog rather
            than carrying the previous row's mutation error into it. */}
        {confirmRow && (
          <AcknowledgeDialog
            key={confirmRow.authority}
            row={confirmRow}
            onClose={() => setConfirming(null)}
          />
        )}
      </div>
    </div>
  );
}
