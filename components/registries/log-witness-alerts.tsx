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
 * alerting for the ack to land. On this screen the overwhelmingly likely
 * reading is therefore that the alert went away between the render and the
 * click, and calling that a failure would have an operator chasing a registry
 * that just got better.
 *
 * ROUND 7's N11, and the correction is in two places at once. Verified
 * read-only against `acdp-control-plane`:
 *
 *   - The WHERE has THREE conjuncts, not one:
 *     `and(eq(tenantId), eq(registryAuthority), eq(alerted, true))`
 *     (`src/storage/log-witness.repository.ts`, `acknowledgeAlert`). So "not
 *     that the authority is unknown" was false — an authority this tenant has
 *     no cursor row for returns exactly the same 404, and so would a
 *     cross-tenant request. This console only ever sends an authority it just
 *     listed FROM that feed, which is what makes the resolved reading the
 *     likely one; it is not what makes the other readings impossible. The copy
 *     below already hedges ("most likely"); this docblock did not, and a
 *     docblock that is more certain than the copy is how the next reader stops
 *     checking.
 *   - `advanceCursor` does not "clear the row". It UPSERTS the cursor with
 *     `alerted: false` (and clears `acknowledgedAt`/`acknowledgedBy`, so a
 *     later alert on the same authority is unacknowledged again). The row stays
 *     in `log_witness_cursors` and keeps its retained head — deliberately, per
 *     that repository's own docblock, so the pre-failure root stays available
 *     as §9.2 `first_root` evidence. (Read from upstream's source, not
 *     verified against a running control plane from here — this console never
 *     sees `log_witness_cursors`. What this component DEPENDS on is only the
 *     next sentence.) What removes it from THIS screen is
 *     `listAlerted`'s `alerted = true` filter, which is a different fact and
 *     the one this component actually depends on.
 */
const ACK_ALREADY_RESOLVED =
  'There is no longer an alert to acknowledge for this authority. The control plane clears the ' +
  'alert on its own once the condition resolves, so this one most likely cleared between loading ' +
  'the table and confirming. This console has asked for the worklist again; the table behind this ' +
  'dialog updates when that answer arrives.';

/**
 * The dialog's THREE states, as a closed union — and the reason it is a union
 * rather than two booleans read at three different places.
 *
 * Round 3 of this PR's gate found the dialog asserting, in the same render,
 * that an authority was "currently alerting" a reason the operator had never
 * seen. Both halves came from the same shape: one `row` value that preferred
 * the live row and fell back to the snapshot, and one `resolved` boolean that
 * meant "our ack 404'd" but was read as "the row is gone". Three different
 * facts — what was clicked, what the listing holds now, what upstream answered
 * — were being recovered from two values that could not carry them.
 *
 *   - `alerting`     — the listing still holds this authority. The present
 *                      tense is earned; the reason comes from the LIVE row.
 *   - `left-listing` — it does not, and upstream has not answered. This console
 *                      does not know why the row left, so nothing here may say.
 *                      The reason comes from the SNAPSHOT, in the past tense.
 *   - `resolved`     — the ack returned 404. `acknowledgeAlert` filters on
 *                      `and(eq(tenantId), eq(registryAuthority),
 *                      eq(alerted, true))`, so a 404 means "no row matched all
 *                      three" — the alert cleared, OR this tenant has no
 *                      cursor row for that authority at all. The stage is
 *                      named for the first reading because this console only
 *                      ever sends an authority it just listed from that same
 *                      tenant's feed; the copy hedges with "most likely"
 *                      rather than asserting it, and so does this bullet. See
 *                      the correction above `ACK_ALREADY_RESOLVED`.
 *
 * `resolved` dominates `left-listing`: a direct answer about our own write
 * outranks an inference from a listing that may simply be filtered.
 *
 * Exported so the prose table in `test/support/witness-ack-prose.ts` can key
 * off it. Adding a fourth state fails `tsc` there until its copy is written —
 * which is the point. Every previous round of this dialog shipped a new state
 * with old copy painted over it.
 */
export type AckStage = 'alerting' | 'left-listing' | 'resolved';

export function ackStage(live: LogWitnessAlertRow | null, error: unknown): AckStage {
  if (error instanceof ApiError && error.status === 404) return 'resolved';
  return live === null ? 'left-listing' : 'alerting';
}

/**
 * What the operator will SEE in the table after confirming.
 *
 * Not a property of the ack — a property of the ack crossed with the listing
 * they are looking at, which is why it is derived rather than inlined. A single
 * unconditional sentence shipped here once and was false on the default screen
 * in all three of its claims.
 *
 * `null` means the bullets are withdrawn entirely: on the `resolved` path
 * confirming cannot happen, so every sentence describing what confirming does
 * is a claim about an action that will not occur.
 */
export type AckListingConsequence = 'stays-listed' | 'leaves-view' | 'already-gone';

/**
 * What confirming does to the acknowledgement record that is already there.
 *
 * ── ROUND 7's N12 ────────────────────────────────────────────────────
 *
 * The first bullet said "It records which key saw this alert, and when", full
 * stop, on every arm — including the one reached from a row whose button reads
 * **Re-acknowledge**. Verified read-only against `acdp-control-plane`:
 * `acknowledgeAlert` does `.set({ acknowledgedAt: now, acknowledgedBy, … })`
 * on the cursor row, and `log_witness_cursors` holds ONE acknowledgement per
 * `(tenant, authority)`. There is no history table. So a re-acknowledgement
 * OVERWRITES who saw it first and when, and nothing on this screen said so.
 *
 * That is a disclosure defect of exactly the kind this dialog exists to fix.
 * The surface is an audit surface — the whole bullet is about attributing a
 * sighting to a key — and the one sentence about attribution was silent on the
 * case where confirming destroys the previous attribution. An operator
 * re-acknowledging to "refresh" the marker loses the record of the first
 * sighting, which is the record that matters in an incident.
 *
 * A separate axis rather than a clause bolted onto `AckListingConsequence`:
 * they are independent facts (one is about the stored record, the other about
 * the listing), and this file's own history is that a sentence which is a
 * function of two things and is keyed on one of them is false in the states the
 * other one names.
 */
export type AckRecordEffect = 'first' | 'replaces';

export function ackRecordEffect(
  live: LogWitnessAlertRow | null,
  openedOn: LogWitnessAlertRow,
): AckRecordEffect {
  // The LIVE row when there is one, for the same reason the `alerting` lead
  // reads it: what confirming will overwrite is whatever the control plane
  // holds NOW, not what it held when the dialog opened. Falling back to the
  // snapshot keeps the sentence available on `left-listing`, where the live row
  // is gone and the snapshot is the only record of what the operator clicked.
  return (live ?? openedOn).acknowledgedAt === null ? 'first' : 'replaces';
}

export function ackListingConsequence(
  stage: AckStage,
  showAcknowledged: boolean,
): AckListingConsequence | null {
  if (stage === 'resolved') return null;
  if (stage === 'left-listing') return 'already-gone';
  return showAcknowledged ? 'stays-listed' : 'leaves-view';
}

/**
 * Which outcome panel the dialog is showing, if any.
 *
 * THE THIRD AXIS, and round 4's gate is why it exists as a named function
 * instead of three inline conditions.
 *
 * `AckStage` and `AckListingConsequence` both model the LISTING. The dialog
 * also renders an `ErrorPanel` on three mutually exclusive outcomes, and the
 * copy pin's scenario table had no axis for them at all — so the pin covered
 * four of seven reachable bodies while its docblock said "every reachable arm".
 * A fabricated sentence rendered only under `forbidden` passed `tsc`, `eslint`
 * and all 1103 tests. The state it fabricated into is the worst one available:
 * on a 403 the control plane has just REFUSED the write, and the sentence said
 * the acknowledgement was recorded and the alert cleared.
 *
 * Deriving it here rather than testing three booleans at the call site is what
 * makes the axis enumerable: `Object.keys` of a `Record<AckOutcome, …>` cannot
 * omit a member, so the scenario table can be checked against the union instead
 * of against a hand-written list that drifts with it.
 *
 * The ORDER is written to express intent, not because it decides anything: a
 * 404 is a statement about the ALERT and outranks a statement about our
 * permission to write. But the two conditions are mutually exclusive by
 * construction — `ackStage` returns `resolved` only for `status === 404`, and
 * `isUpstreamForbidden` requires `status === 403` — so swapping the two lines
 * is a PROVABLY EQUIVALENT mutation and the tests correctly do not kill it.
 * Recorded rather than left as an implied claim, because an ordering comment
 * that sounds load-bearing is how a reader concludes the ordering is tested.
 *
 * `isUpstreamForbidden` is deliberately not just `status === 403` — see its own
 * docblock; a 403 this console minted is not an admin-scope problem, and
 * telling an operator to go get a key re-scoped for a request that never left
 * the browser sends them to fix the wrong thing.
 */
export type AckOutcome = 'none' | 'already-resolved' | 'forbidden' | 'failed';

export function ackOutcome(stage: AckStage, error: unknown): AckOutcome {
  if (stage === 'resolved') return 'already-resolved';
  if (isUpstreamForbidden(error)) return 'forbidden';
  return error ? 'failed' : 'none';
}

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
  openedOn,
  live,
  showAcknowledged,
  onClose,
}: {
  // THREE FACTS, CARRIED SEPARATELY, and the separation is the fix for round
  // 3's first and third blocking findings.
  //
  // A single `row` prop that preferred the live row and fell back to the
  // snapshot collapsed three different things into one value, and each
  // collapse produced a sentence that was false in a state the same path
  // admits:
  //
  //   - "It was alerting X when this dialog opened" read X off the LIVE row.
  //     Upstream overwrites a row in place when the same authority is
  //     re-detected with a different reason (the PK is `(tenantId,
  //     registryAuthority)`), so after such a refetch the dialog named a
  //     detection the operator had never seen — as the only surviving record
  //     of what they had been looking at, since the 404 path means the row is
  //     already gone from the table.
  //   - "currently alerting: X" was gated on `resolved`, which means only "our
  //     ack 404'd". A row can leave the list for other reasons — any refetch
  //     after upstream ran `advanceCursor` — and then the dialog asserted a
  //     live alert in the present tense while the card behind it rendered "No
  //     alert is recorded at all".
  //
  // So: `openedOn` is what the operator clicked and never changes;
  // `live` is the current row or `null` if it has left the listing.
  openedOn: LogWitnessAlertRow;
  live: LogWitnessAlertRow | null;
  // Which listing the table behind this dialog is showing. The third fact
  // below is about what the operator will SEE after confirming, and that
  // depends on the view — it is not a property of the ack.
  showAcknowledged: boolean;
  onClose: () => void;
}) {
  // The ack is keyed on the authority alone — upstream takes no body — and the
  // authority is the one field that cannot differ between the two, so the
  // snapshot is always a safe source for it.
  const authority = openedOn.authority;
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const queryClient = useQueryClient();
  const mut = useMutation({
    mutationFn: () => acknowledgeLogWitnessAlert(authority, demoMode),
    // The invalidation belongs to the MUTATION; closing belongs to the
    // COMPONENT, and round 3 found the difference is not cosmetic.
    //
    // `useMutation`'s own `onSuccess` is invoked by the Mutation in
    // `execute()` with no observer check, so it runs after this dialog
    // unmounts — deliberately, for the refetch (see `onError` below). But
    // `onClose()` sat here too, and `onClose` is the PARENT's
    // `setConfirming(null)`: an operator who dismissed an in-flight ack and
    // opened a different row's dialog had that second dialog torn down when
    // the first ack landed. `screen.queryByRole('dialog')` measured null.
    //
    // The close therefore moves to the per-call callback passed to `mutate()`,
    // which `MutationObserver#notify` gates on `hasListeners()` — exactly the
    // "only if this component is still mounted" semantics it needs.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['log-witness-alerts'] });
    },
    // The 404 refetch fires ON ARRIVAL, and this is the third arrangement of it.
    //
    // Round 1 had it here and the dialog UNMOUNTED: the parent derived the
    // dialog's row from the live list, the refetch emptied that list, and the
    // explanation this path exists to paint was destroyed before it painted.
    // The operator watched a row vanish from a dishonesty worklist with no
    // account of why.
    //
    // Round 2 moved it into a close handler, which kept the dialog standing and
    // broke two other things. `ACK_ALREADY_RESOLVED` said the worklist had been
    // refreshed while no refetch had been requested — a past-perfect claim
    // painted over a table that still listed the authority as Open. And an
    // operator who dismissed the dialog BEFORE the response landed got no
    // refetch at all, because the gate read `resolved` at dismiss time and
    // `onError` was gone: a resolved alert kept its row on the worklist until
    // something unrelated invalidated the query.
    //
    // Neither was the real defect. The real defect was that the dialog's
    // IDENTITY depended on the list it was invalidating. The parent now holds
    // the row it opened on (see `confirming`), so the refetch can no longer
    // unmount this dialog, and the invalidation belongs back here: where the
    // fact is true at the moment the copy claims it, and where it does not
    // depend on the operator still being in the dialog. `useMutation`'s own
    // `onError` is invoked by the Mutation in `execute()`, not by this
    // component's observer — unlike the per-call callbacks passed to `mutate()`,
    // which `MutationObserver#notify` gates on `hasListeners()` — so it runs
    // even when this dialog has already unmounted.
    onError: (e) => {
      if (e instanceof ApiError && e.status === 404) {
        queryClient.invalidateQueries({ queryKey: ['log-witness-alerts'] });
      }
    },
  });

  const stage = ackStage(live, mut.error);
  const resolved = stage === 'resolved';
  const consequence = ackListingConsequence(stage, showAcknowledged);
  const outcome = ackOutcome(stage, mut.error);
  const recordEffect = ackRecordEffect(live, openedOn);

  return (
    <Modal
      open
      onClose={onClose}
      // The FULL authority, matching the table beneath it. `shortAuthority`
      // truncates at the first dot, so a confirm dialog for
      // `registry-a.corp.example` would be captioned identically to one for
      // `registry-a.playground.local` — on the one control that writes.
      title={`Acknowledge ${authority}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {/* "Close" rather than "Cancel" once the alert turned out to be
                gone: there is nothing left to cancel, and offering to cancel an
                action that already cannot happen is a false choice. */}
            {resolved ? 'Close' : 'Cancel'}
          </Button>
          {!resolved && (
            // `onSuccess` here rather than in the mutation's own options: see
            // the note there. This callback is gated on the observer still
            // having listeners, so an ack whose dialog was dismissed cannot
            // close whichever dialog is open when it lands.
            <Button
              onClick={() => mut.mutate(undefined, { onSuccess: () => onClose() })}
              disabled={mut.isPending}
            >
              {mut.isPending ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {/* One sentence per STAGE, and the reason's source differs per stage —
            which is the whole point of the split.

            `alerting` is the only arm allowed the present tense, and the only
            one that reads the LIVE row: the authority is in the listing right
            now, so "currently alerting" is a claim this console can make.

            The other two read the SNAPSHOT. `resolved` must, because upstream
            has just said the alert is gone and the live row is gone with it —
            the snapshot is the only surviving record of what the operator
            clicked. `left-listing` must for the same reason, and must also stop
            short of saying WHY the row left: from here the console cannot tell
            a cleared condition from someone else's acknowledgement filtering it
            out of this view, and an earlier revision asserted the former. */}
        <p style={{ margin: 0 }}>
          {stage === 'resolved' && (
            <>
              No acknowledgement was recorded for <strong>{authority}</strong>. It was alerting{' '}
              <strong>{reasonLabel(openedOn.reason)}</strong> when this dialog opened.
            </>
          )}
          {/* `openedOn.reason` here is not a choice the tests can falsify, and
              that is worth saying rather than leaving as an apparent gap: this
              arm is reachable only when `live === null` (see `ackStage`), so
              `live?.reason ?? openedOn.reason` is the same expression. The
              sweep records it as a surviving mutant; it is an equivalent one.
              The arm ABOVE is the one where the distinction is real, and it has
              its own test. */}
          {stage === 'left-listing' && (
            <>
              <strong>{authority}</strong> is no longer in the listing this console is showing. It
              was alerting <strong>{reasonLabel(openedOn.reason)}</strong> when this dialog opened.
            </>
          )}
          {stage === 'alerting' && live && (
            <>
              Recording an acknowledgement for <strong>{authority}</strong>, currently alerting:{' '}
              <strong>{reasonLabel(live.reason)}</strong>.
            </>
          )}
        </p>
        {/* The three facts, as facts. Not a confirmation prompt.
            WITHDRAWN once the alert turns out to be gone, for the same reason
            the confirm button is withdrawn and Cancel becomes Close: all three
            describe what confirming DOES, and by then confirming cannot happen.
            Leaving "It records which key saw this alert, and when" on screen
            beside "there is no longer an alert to acknowledge" tells an operator
            something was recorded when nothing was. */}
        {consequence && (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {/* A function of whether this authority is ALREADY acknowledged —
                round 7's N12. Upstream stores one acknowledgement per row and
                overwrites it, with no history, so on a re-acknowledgement this
                bullet's subject is not "records" but "replaces". See
                `ackRecordEffect`. */}
            {recordEffect === 'first' && (
              <li>
                It records <strong>which key</strong> saw this alert, and when. The control plane
                derives that from the credential this console sends — it is not a person&rsquo;s
                name, and you cannot acknowledge on someone else&rsquo;s behalf.
              </li>
            )}
            {recordEffect === 'replaces' && (
              <li>
                It <strong>replaces</strong> the key and time already recorded for this authority.
                The control plane keeps one acknowledgement per row and no history, so the earlier
                sighting is not retained. The key comes from the credential this console sends — it
                is not a person&rsquo;s name, and you cannot acknowledge on someone else&rsquo;s
                behalf.
              </li>
            )}
            <li>
              It does <strong>not clear the alert</strong> and does not touch the retained head. The
              authority stays alerted until the control plane witnesses a consistent checkpoint again.
            </li>
            {/* A function of the VIEW *and* of whether the row is still in it,
                because the sentence is about what the operator will see next
                and that is not a property of the ack.

                A single sentence shipped here saying the row "leaves this
                worklist by default … stays hidden until you use Show
                acknowledged above" — written when the default listing WAS
                unacknowledged-only. After the default flipped, all three of its
                claims were false on the screen it was rendered over: the row
                does not leave, nothing is hidden, and the control it named did
                not exist under that name. The one control on this page that
                writes was telling the operator a still-alerting authority would
                disappear, and sending them to press a button that is not
                there.

                Which is why the sentence below names the control by its
                rendered STATE LABEL and nothing else. Round 4 relabelled that
                toggle (an action label inverts under `aria-pressed` — see its
                own comment), and a hand-written control name in a body
                sentence is exactly the kind of reference that rots silently.
                `witness-ack-prose.ts` holds the one copy the test compares
                against, so a relabel that forgets this line fails the pin.

                The third arm is the one round 3 added. Both view arms describe
                a row that is on screen; when the listing no longer holds it,
                both are false, and the one that was rendering said the row
                "stays". */}
            {consequence === 'stays-listed' && (
              <li>
                The row <strong>stays</strong> in this worklist — this view lists acknowledged alerts
                too, and the <em>State</em> column will read <em>Acknowledged</em>. A later detection
                with a <strong>different</strong> reason resets that marker; a repeat of the{' '}
                <strong>same</strong> reason does <strong>not</strong>, so an unchanged, ongoing
                detection will not announce itself again.
              </li>
            )}
            {consequence === 'leaves-view' && (
              <li>
                The row leaves <strong>this view</strong>, which is filtered to unacknowledged
                alerts — it does not leave the worklist. A later detection with a{' '}
                <strong>different</strong> reason brings it back here; a repeat of the{' '}
                <strong>same</strong> reason does <strong>not</strong> — so an unchanged, ongoing
                detection stays hidden from this view until you switch the control above to{' '}
                <em>Acknowledged shown</em>.
              </li>
            )}
            {consequence === 'already-gone' && (
              <li>
                The row <strong>left this listing</strong> after the dialog opened, so there is
                nothing here for the acknowledgement to change. This console cannot tell whether the
                control plane still holds the alert — confirming is what settles it.
              </li>
            )}
          </ul>
        )}
        {outcome === 'already-resolved' && <ErrorPanel message={ACK_ALREADY_RESOLVED} />}
        {outcome === 'forbidden' && (
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
        {outcome === 'failed' && (
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
 * **The worklist asks for ACKNOWLEDGED ROWS BY DEFAULT, and that is
 * load-bearing.** Upstream, acknowledging an alert does not resolve it:
 * `acknowledgeAlert` writes `acknowledgedAt`/`acknowledgedBy` and leaves
 * `alerted = true`; the row only leaves when the underlying condition clears
 * via `advanceCursor`. Acknowledgement is a "someone has seen this" marker, not
 * a fix. Defaulting to the unacknowledged-only listing would therefore hide
 * still-outstanding split-view and root-rewrite detections from the one screen
 * built to surface them — and would do it precisely for the alerts a human
 * already touched — while the empty state below claimed there were none. That
 * is why the `State` column exists and why both of its values are reachable
 * here.
 *
 * The filtered listing is still one click away, because "what has nobody looked
 * at yet" is a real triage question. It is a VIEW, not the screen's claim: every
 * piece of copy that describes what is on screen — the card subtitle, the empty
 * state, and the confirm dialog's third fact — is a function of the flag, so
 * neither view can be read as making the other's claim. Adding a surface here
 * that says "no alerts" without saying which listing produced that is the
 * defect this arrangement exists to prevent.
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
  // The row the dialog OPENED on. Two requirements pull in opposite directions
  // here, and each was shipped alone before this shape existed.
  //
  // Holding only the authority and re-deriving the row from `rows` keeps the
  // dialog's reason current when the list refetches underneath it — a frozen
  // row would caption the dialog with a reason the table no longer shows. But
  // it also made the dialog's EXISTENCE depend on the list: a 404 means
  // upstream already cleared the alert, so the refetch that the 404 triggers
  // removes the row, `rows.find(...)` goes null, and the dialog unmounts before
  // it can say why.
  //
  // Holding only the row object fixes the unmount and gives back the stale
  // reason.
  //
  // So: the snapshot supplies IDENTITY — the dialog stays mounted for as long
  // as the operator keeps it open, whatever the list does — and the lookup
  // supplies CONTENT while the listing still holds the row. The ack itself is
  // keyed on the authority alone (upstream takes no body), so a snapshot can
  // never send a stale field.
  //
  // The two are handed over SEPARATELY rather than coalesced with a `??` here.
  // A coalesced value silently substitutes the snapshot for the live row, and
  // the dialog then cannot tell "still alerting this reason" from "gone from
  // the listing, and this is what it said when you clicked" — which is exactly
  // the sentence round 3 caught it getting wrong. `live` is `null` when the
  // listing does not hold the authority, and that `null` is information.
  const [confirming, setConfirming] = useState<LogWitnessAlertRow | null>(null);
  const liveRow = confirming
    ? (rows.find((r) => r.authority === confirming.authority) ?? null)
    : null;

  return (
    <div className="card">
      <div className="feed-header">
        <h2>
          <ScrollText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Witness alert worklist
        </h2>
        {/* The third clause is a function of the flag. It read "acknowledged
            alerts stay listed until the condition clears" in both views, and
            in the filtered one it rendered directly above an empty state
            saying acknowledged alerts "are hidden in this view" — the card
            contradicting itself in two adjacent elements. The upstream fact it
            states is true either way; what changes is whether THIS LISTING is
            showing them, which is the part an operator reads it for. */}
        <span className="card-sub">
          Durable transparency-log detections · one row per alerting authority ·{' '}
          {showAcknowledged
            ? 'acknowledged alerts stay listed until the condition clears'
            : 'acknowledged alerts are filtered out of this view, but stay open until the condition clears'}
        </span>
        <Button
          variant="secondary"
          // A STATE label, not an action label, and that is the whole point of
          // this line.
          //
          // It read `Hide acknowledged` / `Show acknowledged` with
          // `aria-pressed={showAcknowledged}`. `Button` adds no `aria-label`,
          // so the text IS the accessible name — and the default state
          // (`showAcknowledged === true`, acknowledged alerts ARE listed)
          // announced as "Hide acknowledged, toggle button, PRESSED". A screen
          // reader operator was told the hiding was on while the rows were on
          // screen; in the other state, "Show acknowledged, not pressed" reads
          // as hidden too, so they got "hidden" in BOTH states and no state
          // change at all. On the one screen whose first gate round was about
          // this worklist silently hiding alerts, that is the same defect in
          // the announcement layer.
          //
          // `aria-pressed` describes whether the thing the name denotes is ON.
          // A name that denotes an ACTION therefore inverts under it. Every
          // other `aria-pressed` in this repo is already a state label
          // (`enrollments.tsx` enabled/disabled, `connection-panel.tsx` "On —
          // using mock data", `events/page.tsx` Live SSE/Live off) or a static
          // filter label (`scenarios`, `runs`, `lineage`); this control was the
          // only action-labelled one.
          //
          // What clicking does is not lost: the subtitle immediately to the
          // left spells out both consequences and changes with the state.
          aria-pressed={showAcknowledged}
          onClick={() => setShowAcknowledged((v) => !v)}
        >
          {showAcknowledged ? 'Acknowledged shown' : 'Acknowledged hidden'}
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

                        ROUND 7's N11: this branch is DEFENSIVE, and the
                        paragraph above reads as though nulls arrive. Verified
                        read-only against `acdp-control-plane`: `last_alert_at`
                        is a nullable column, but the only write that sets
                        `alerted = true` is `markAlert`, which sets
                        `lastAlertAt` in the SAME statement, and `listAlerted`
                        returns only `alerted = true` rows. `markFailure` never
                        touches the alert fields at all. So a null `at` is
                        unreachable from a correct control plane today. It is
                        still rendered as words rather than trusted away,
                        because the column permits it and the type this console
                        parses permits it — the cost of the branch is one
                        ternary and the cost of being wrong is a trust row that
                        looks like a rendering bug.
                      */}
                      {row.at === null ? 'Time not recorded' : `${timeAgo(row.at)} · ${clockTime(row.at)}`}
                    </td>
                    <td>
                      <AcknowledgedCell row={row} />
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirming(row)}
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
        {confirming && (
          <AcknowledgeDialog
            key={confirming.authority}
            openedOn={confirming}
            live={liveRow}
            showAcknowledged={showAcknowledged}
            onClose={() => setConfirming(null)}
          />
        )}
      </div>
    </div>
  );
}
