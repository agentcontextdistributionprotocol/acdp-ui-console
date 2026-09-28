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
//      (`AckStage`, `AckListingConsequence`), so adding a state to the dialog
//      fails `tsc` here until its copy is written. Every previous round of this
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
} from '@/components/registries/log-witness-alerts';

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
    'use Show acknowledged above.',
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
 * The WHOLE body, as the ordered list of BLOCKS it is rendered from.
 *
 * A list rather than one string, and the list is part of the pin:
 *
 *   - the ORDER is pinned, so the three facts cannot be reshuffled into an
 *     order that reads differently
 *   - the COUNT is pinned, so an added sentence is an added element rather than
 *     a substring nobody notices
 *   - the COMPOSITION is pinned, which is the part that matters most: it
 *     encodes that the bullets are withdrawn on the resolved path and that the
 *     panel appears only there. A test asserting each sentence separately would
 *     pass on a dialog that rendered "It records which key saw this alert" next
 *     to "there is no longer an alert to acknowledge" — the exact pairing this
 *     dialog's second round shipped.
 */
export function expectedAckBlocks(opts: {
  stage: AckStage;
  consequence: AckListingConsequence | null;
  authority: string;
  reason: string;
}): string[] {
  const parts = [ACK_LEAD[opts.stage](opts.authority, opts.reason)];
  if (opts.consequence !== null) {
    parts.push(ACK_FACT_KEY, ACK_FACT_NOT_CLEARED, ACK_LISTING[opts.consequence]);
  }
  if (opts.stage === 'resolved') parts.push(ACK_RESOLVED_PANEL);
  return parts.map(normalize);
}

/**
 * Whitespace removed entirely.
 *
 * Used for the second half of the pin — "and there is nothing in the body
 * BESIDES those blocks" — which compares the whole body's text against the
 * blocks concatenated. That comparison has to be blind to whitespace between
 * elements, because whether JSX emits a space between `</p>` and `<ul>` is a
 * formatting accident and changing it is not a copy change.
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
