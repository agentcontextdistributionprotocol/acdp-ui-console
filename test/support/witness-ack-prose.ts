// ══════════════════════════════════════════════════════════════════════
// The acknowledge dialog's copy, pinned character for character.
//
// WHY THIS FILE EXISTS, rather than more `toMatch` assertions.
//
// Round 3 of #84's gate ran a mutation sweep over the dialog and found four
// independent falsifications that the whole 1094-test suite accepted:
//
//   - `"No acknowledgement was recorded"`  ->  `"An acknowledgement was
//     recorded"` — the inversion of the one sentence on the 404 path that tells
//     an operator whether the write landed
//   - the refetch clause put into the past perfect, negated, and inverted
//     (`"has NOT asked for the worklist again"`) — each survived a guard
//     written as `toMatch(/asked for the worklist again/i)`
//   - the resurfacing rule with `same` and `different` swapped
//
// Every positive copy assertion on these paths was a substring `toMatch`. A
// substring match cannot see a prefix, so prefix-negation walks through all of
// them at once; and a set of forbidden phrasings cannot be completed, because
// the set of English paraphrases is infinite. The revocation branch of this
// same worklist learned the identical lesson from the other end — twelve
// paraphrases cleared its forbidden-phrase list in a single round, one of them
// by swapping a space for a hyphen.
//
// So this file stops enumerating the bad set and closes the good one. The
// dialog's body text is a FINITE, ENUMERATED set of sentences; the tests assert
// that the rendered body is exactly one composition of them, with nothing else
// in it. Deletion, negation, inversion, tense change, paraphrase and
// fabrication all fail identically, because none of them produce this string.
//
// THE TWO THINGS THAT KEEP IT FROM GOING VACUOUS:
//
//   1. Nothing here is imported from the component. These are hand-written
//      copies. Importing the component's own constants would make every
//      assertion `x === x`, which is what a copy guard degrades into if you let
//      it share a source with its subject.
//   2. The keys are DERIVED from the component's exported state unions
//      (`AckStage`, `AckListingConsequence`, `AckOutcome`), so adding a state
//      to the dialog fails `tsc` here until its copy is written. `AckOutcome`
//      is round 4's addition: the first two model the LISTING only, and the
//      three error panels were a whole axis the exhaustiveness check could not
//      see — which is how four arms out of seven passed as "every reachable
//      arm". Every previous round of this
//      dialog shipped a new state with old copy painted over it; this is the
//      mechanism that makes that a compile error instead of a screenshot
//      somebody has to notice.
//
// THE LIMIT, stated plainly so nobody trusts this further than it goes: a pin
// cannot tell true copy from false copy. If a sentence here is WRONG about
// upstream, the tests will hold it wrong forever. What it guarantees is that
// the copy an operator sees is the copy someone deliberately wrote down, and
// that changing it is a visible, reviewed edit rather than a silent one. The
// claims themselves are argued at their call sites in
// `log-witness-alerts.tsx`, against the upstream source that justifies each.
// ══════════════════════════════════════════════════════════════════════
import type {
  AckStage,
  AckListingConsequence,
  AckOutcome,
} from '@/components/registries/log-witness-alerts';
import { ADMIN_ROUTE_FORBIDDEN } from '@/lib/utils/api-error-messages';

/**
 * Collapse every run of whitespace to one space and trim.
 *
 * JSX joins adjacent text lines with a single space and strips
 * newline-plus-indent at element boundaries, so a multi-line sentence already
 * arrives close to this form. Normalising anyway means the component's source
 * can be re-wrapped without touching this file — re-wrapping is not a copy
 * change and must not read as one.
 */
export function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The lead paragraph, one per stage.
 *
 * Each takes the authority and the reason label because BOTH are interpolated,
 * and because which row they come from differs per stage — `alerting` reads the
 * live row, the other two read the snapshot the dialog opened on. The functions
 * cannot express that difference (they are handed strings), which is
 * deliberate: the tests supply DIFFERENT values for the live and snapshot
 * reasons and assert which one appears, so the source is pinned by the
 * assertion rather than by this table.
 */
export const ACK_LEAD: Record<AckStage, (authority: string, reason: string) => string> = {
  alerting: (authority, reason) =>
    `Recording an acknowledgement for ${authority}, currently alerting: ${reason}.`,
  'left-listing': (authority, reason) =>
    `${authority} is no longer in the listing this console is showing. It was alerting ${reason} ` +
    `when this dialog opened.`,
  resolved: (authority, reason) =>
    `No acknowledgement was recorded for ${authority}. It was alerting ${reason} when this dialog ` +
    `opened.`,
};

/**
 * The two bullets that are true of the acknowledgement itself, whatever the
 * listing is doing. Constant across every arm that renders bullets at all.
 */
export const ACK_FACT_KEY =
  'It records which key saw this alert, and when. The control plane derives that from the ' +
  'credential this console sends — it is not a person’s name, and you cannot acknowledge on ' +
  'someone else’s behalf.';

export const ACK_FACT_NOT_CLEARED =
  'It does not clear the alert and does not touch the retained head. The authority stays alerted ' +
  'until the control plane witnesses a consistent checkpoint again.';

/**
 * The third bullet: what the operator will SEE in the table afterwards.
 *
 * Keyed on `AckListingConsequence` rather than on the view flag, because it is
 * a function of the view AND of whether the listing still holds the row. A
 * two-arm version of this bullet shipped and was false in the third state.
 */
export const ACK_LISTING: Record<AckListingConsequence, string> = {
  'stays-listed':
    'The row stays in this worklist — this view lists acknowledged alerts too, and the State ' +
    'column will read Acknowledged. A later detection with a different reason resets that marker; ' +
    'a repeat of the same reason does not, so an unchanged, ongoing detection will not announce ' +
    'itself again.',
  'leaves-view':
    'The row leaves this view, which is filtered to unacknowledged alerts — it does not leave the ' +
    'worklist. A later detection with a different reason brings it back here; a repeat of the same ' +
    'reason does not — so an unchanged, ongoing detection stays hidden from this view until you ' +
    'switch the control above to Acknowledged shown.',
  'already-gone':
    'The row left this listing after the dialog opened, so there is nothing here for the ' +
    'acknowledgement to change. This console cannot tell whether the control plane still holds ' +
    'the alert — confirming is what settles it.',
};

/**
 * The 404 panel. A hand copy of `ACK_ALREADY_RESOLVED`, for the reason at the
 * top of this file: the component does not export it and must not, or this
 * assertion becomes a tautology.
 */
export const ACK_RESOLVED_PANEL =
  'There is no longer an alert to acknowledge for this authority. The control plane clears the ' +
  'alert on its own once the condition resolves, so this one most likely cleared between loading ' +
  'the table and confirming. This console has asked for the worklist again; the table behind this ' +
  'dialog updates when that answer arrives.';

/**
 * The HEADING, which is chrome and is pinned anyway.
 *
 * It was "pinned by its own test above" — a real test, which asserts the full
 * authority appears. That is a `toContain`, so it says nothing about what else
 * the heading says. Round 4's sweep put a fabricated sentence in the FOOTER and
 * the whole suite stayed green for the same reason: the scope of this pin was
 * the body, and the dialog is not only its body.
 */
export const ACK_HEADING = (authority: string) => `Acknowledge ${authority}`;

/**
 * The outcome panel's message, per arm — and two of the three are IMPORTED,
 * against this file's own rule. The exception is deliberate and bounded.
 *
 * The rule (see the top of this file) is that nothing here may be imported from
 * the SUBJECT, or the assertion becomes `x === x`. `ADMIN_ROUTE_FORBIDDEN` is
 * not the subject: it belongs to `lib/utils/api-error-messages.ts`, is shared
 * by three surfaces, and has its own dedicated pin in `admin-key-parity.test.tsx`
 * (`:214-219`) plus a parity test asserting every site that renders it also
 * renders the diagnostic disclosure. Hand-copying 500 characters of it here
 * would duplicate a string this PR does not own and drift from it silently.
 *
 * What the dialog decides — and therefore what IS pinned here — is WHICH
 * message appears in WHICH state, that it appears with the upstream bytes
 * disclosed beside it, and that nothing else appears with it.
 *
 * `failed` has no entry because its message is `operatorErrorMessage(error,
 * 'Could not record the acknowledgement')`, a function of the error code. The
 * caller passes the expected string; there is nothing constant to table.
 */
export const ACK_PANEL_MESSAGE: Record<'already-resolved' | 'forbidden', string> = {
  'already-resolved': ACK_RESOLVED_PANEL,
  forbidden: ADMIN_ROUTE_FORBIDDEN,
};

/**
 * `ErrorDetail`'s `<summary>`. Part of the rendered text of any panel that
 * passes `details`, so it is part of the block.
 */
export const ACK_DETAIL_SUMMARY = 'Technical detail';

/**
 * One panel block as it reaches `textContent`.
 *
 * `ErrorPanel` renders the message `<div>`, then `<summary>`, then `<pre>` —
 * three sibling elements with no text between them, so `textContent`
 * concatenates them with NO separator. Written out here rather than fudged with
 * spaces, because the whole point of the pin is that it compares the real
 * string.
 */
export function ackPanelBlock(message: string, diagnostic?: string): string {
  return normalize(diagnostic ? `${message}${ACK_DETAIL_SUMMARY}${diagnostic}` : message);
}

/**
 * Every ATTRIBUTE the dialog is allowed to announce, and the reason this is a
 * separate closed set from the blocks.
 *
 * `textContent` cannot see an attribute. Round 4's sweep put `title="…"` on the
 * body grid and `aria-label="…"` on the lead paragraph, and both survived a pin
 * that compares rendered text character for character — the copy reached a
 * screen reader and a hover tooltip without appearing in `textContent` at all.
 *
 * `CLAUDE.md` forbids disclosing on a trust surface through a `title` for
 * reasons that apply exactly here: invisible on touch, invisible to the
 * keyboard, unreliably announced. This dialog is the only control on the page
 * that WRITES, so an unreviewed sentence that only some operators can perceive
 * is worse here than anywhere else on the card.
 *
 * Two values, both chrome this dialog does not author:
 *
 *   - `Close dialog` — `Modal`'s own header control, whose icon is
 *     `aria-hidden`, so this label is its entire accessible name.
 *   - `Technical detail` — `ErrorDetail`'s `<pre>`, which needs a name because
 *     a `<pre>` maps to ARIA `generic` and a scroll container needs to be
 *     reachable; the same string is its `<summary>` text, so it IS in the
 *     blocks as well.
 *
 * `aria-hidden` is excluded because it announces nothing by definition, and the
 * id-reference attributes (`aria-labelledby` and friends) are checked
 * separately: they carry no text of their own, and what they point at is
 * already inside the dialog and therefore already pinned.
 */
export const ANNOUNCED_TEXT_ATTRS = [
  'title',
  'alt',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
] as const;

export const ACK_CLOSE_CONTROL = 'Close dialog';

/**
 * A FUNCTION of the outcome, not a constant — which is the point.
 *
 * `Technical detail` is `ErrorDetail`'s `<pre>` name, and it exists only on the
 * two arms that pass `details`. Making that conditional pins both directions at
 * once: the 404 arm must NOT disclose (there is nothing diagnostic about an
 * alert that resolved on its own, and `ACK_RESOLVED_PANEL` promises no detail),
 * and the two error arms MUST — `ADMIN_ROUTE_FORBIDDEN` ends with "Read the
 * detail before changing any key", which is a dangling instruction if the
 * disclosure is absent. `admin-key-parity.test.tsx` requires the same pairing
 * of every surface that renders that string.
 */
export function expectedAnnounced(outcome: AckOutcome): string[] {
  const discloses = outcome === 'forbidden' || outcome === 'failed';
  return discloses ? [ACK_CLOSE_CONTROL, ACK_DETAIL_SUMMARY] : [ACK_CLOSE_CONTROL];
}

/**
 * The FOOTER's buttons, in order.
 *
 * A LOCAL union, unlike `AckStage` and `AckListingConsequence`, and that is
 * worth being explicit about: the component does not derive the footer from a
 * named function, it tests `resolved` and `mut.isPending` inline. So this table
 * cannot claim to be checked against the component's own state machine the way
 * the body tables are — a fourth footer state added inline would not fail `tsc`
 * here.
 *
 * It is still worth tabling, because the alternative (round 4's state) was no
 * footer coverage at all, and a fabricated footer sentence passed the suite.
 * What keeps it from drifting is the `nothing outside the blocks` half of the
 * pin, which covers the footer now that the pin's scope is the whole dialog:
 * any footer content not in this table fails whether or not this union knows
 * about it.
 *
 * `in-flight` and `closed-out` are mutually exclusive by construction — the
 * confirm button is not rendered on the resolved path, so there is nothing to
 * be pending.
 */
export type AckFooterState = 'confirmable' | 'in-flight' | 'closed-out';

const FOOTER_SET: Record<AckFooterState, true> = {
  confirmable: true,
  'in-flight': true,
  'closed-out': true,
};

export const ALL_FOOTER_STATES = Object.keys(FOOTER_SET) as AckFooterState[];

export const ACK_FOOTER: Record<AckFooterState, readonly string[]> = {
  confirmable: ['Cancel', 'Acknowledge'],
  // "Close" rather than "Cancel": there is nothing left to cancel once upstream
  // has said the alert is gone, and offering to cancel an action that cannot
  // happen is a false choice.
  'closed-out': ['Close'],
  'in-flight': ['Cancel', 'Acknowledging\u2026'],
};

/**
 * Anti-vacuity for the outcome axis.
 *
 * Round 4's gate found the copy pin covering four of SEVEN reachable dialog
 * bodies while its test was titled `renders exactly the pinned copy, in every
 * reachable arm`. The missing three were the 403 panel, the generic-error panel
 * and the in-flight footer — and the anti-vacuity check could not see the gap,
 * because it compared the scenario table against `ALL_STAGES` and
 * `ALL_CONSEQUENCES`: the two axes that omit the error dimension.
 *
 * That is the failure mode this whole file exists to avoid, one axis over. An
 * exhaustiveness check is only as wide as the axes it knows about, so adding an
 * axis to the component means adding it here, and `Object.keys` of a
 * `Record<AckOutcome, …>` is what makes that a compile error rather than a
 * judgement call.
 */
const OUTCOME_SET: Record<AckOutcome, true> = {
  none: true,
  'already-resolved': true,
  forbidden: true,
  failed: true,
};

export const ALL_OUTCOMES = Object.keys(OUTCOME_SET) as AckOutcome[];

/**
 * The WHOLE DIALOG, as the ordered list of BLOCKS it is rendered from.
 *
 * A list rather than one string, and the list is part of the pin:
 *
 *   - the ORDER is pinned, so the three facts cannot be reshuffled into an
 *     order that reads differently
 *   - the COUNT is pinned, so an added sentence is an added element rather than
 *     a substring nobody notices
 *   - the COMPOSITION is pinned, which is the part that matters most: it
 *     encodes that the bullets are withdrawn on the resolved path and that each
 *     panel appears only in its own arm. A test asserting each sentence
 *     separately would pass on a dialog that rendered "It records which key saw
 *     this alert" next to "there is no longer an alert to acknowledge" — the
 *     exact pairing this dialog's second round shipped.
 *
 * SCOPE, and round 4 is why it is stated: heading, body AND footer. It covered
 * the body alone, and both this file's opening line ("the acknowledge dialog's
 * copy") and the test's title ("every reachable arm") claimed more than that.
 * A sentence in the footer, a sentence gated on `isPending`, and a sentence
 * gated on a 403 each reached the operator with the full suite green.
 */
export function expectedDialogBlocks(opts: {
  stage: AckStage;
  consequence: AckListingConsequence | null;
  outcome: AckOutcome;
  footer: AckFooterState;
  authority: string;
  reason: string;
  /**
   * `errorDiagnostic(error)` for the arms that disclose it. Supplied by the
   * caller rather than tabled, because it carries the fixture's own status,
   * service and path.
   */
  diagnostic?: string;
  /**
   * The generic arm's message. A function of the error code, so it has no
   * constant form — see `ACK_PANEL_MESSAGE`.
   */
  failedMessage?: string;
}): string[] {
  const parts = [
    ACK_HEADING(opts.authority),
    ACK_LEAD[opts.stage](opts.authority, opts.reason),
  ];
  if (opts.consequence !== null) {
    parts.push(ACK_FACT_KEY, ACK_FACT_NOT_CLEARED, ACK_LISTING[opts.consequence]);
  }
  if (opts.outcome === 'already-resolved') {
    // The 404 panel passes no `details`: there is nothing diagnostic about an
    // alert that resolved on its own.
    parts.push(ackPanelBlock(ACK_PANEL_MESSAGE['already-resolved']));
  }
  if (opts.outcome === 'forbidden') {
    parts.push(ackPanelBlock(ACK_PANEL_MESSAGE.forbidden, opts.diagnostic));
  }
  if (opts.outcome === 'failed') {
    parts.push(ackPanelBlock(opts.failedMessage ?? '', opts.diagnostic));
  }
  parts.push(...ACK_FOOTER[opts.footer]);
  return parts.map(normalize);
}

/**
 * Whitespace removed entirely.
 *
 * Used for the second half of the pin — "and there is nothing in the dialog
 * BESIDES those blocks" — which compares the whole dialog's text against the
 * blocks concatenated. That comparison has to be blind to whitespace between
 * elements, because whether JSX emits a space between `</p>` and `<ul>` is a
 * formatting accident and changing it is not a copy change.
 *
 * DE-CLAIM, round 4: at HEAD this is DEFENSIVE, not load-bearing. Replacing it
 * with the identity function leaves the whole suite green — measured — because
 * JSX strips newline-plus-indent at element boundaries and this dialog emits no
 * whitespace text nodes between its blocks, so the raw concatenation already
 * equals the squashed one. It earns its keep the first time someone adds a
 * `{' '}` between two blocks, and it costs nothing; but a reader should not
 * take a passing suite as evidence that the whitespace-blindness is exercised.
 */
export function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '');
}

/**
 * Anti-vacuity: the full key sets, so a test can assert it exercised every arm
 * rather than the two that happened to be easy to reach.
 *
 * Read off the `Record`s rather than written out again. A hand-written literal
 * list would need its own exhaustiveness proof — `['alerting'] satisfies
 * readonly AckStage[]` type-checks perfectly well, so `satisfies` catches an
 * EXTRA member and not a MISSING one, which is the direction that matters here.
 * `Object.keys` of a `Record<Union, …>` cannot omit a member, because the
 * `Record` itself could not have been constructed without it.
 */
export const ALL_STAGES = Object.keys(ACK_LEAD) as AckStage[];
export const ALL_CONSEQUENCES = Object.keys(ACK_LISTING) as AckListingConsequence[];
