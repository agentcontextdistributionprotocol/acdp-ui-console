// ══════════════════════════════════════════════════════════════════════
// The CLOSED SET of sentences the revocation surfaces are allowed to say.
//
// ── Why this file replaced a pile of `not.toMatch` patterns ───────────
//
// Every copy guard on this change was an enumerated list of forbidden
// phrasings, and each gate round defeated the current list by rephrasing
// rather than by deleting. Round 6 walked through four guards at once. Round 7
// walked through their replacements — which had been rewritten specifically to
// "ban the shape, not the sentence" — twelve more times:
//
//   "No key in this deployment has been revoked."        (no listed phrase)
//   "Each event across this deployment checked out clean, throughout."
//                                       (`each` is not `every`; `throughout`
//                                        is not `all time`)
//   "The entire fleet is clean."         (one pattern listed estate|deployment
//                                        |fleet, the next listed only
//                                        estate|deployment — a one-word gap)
//   "Across all 0 revoked events on record, nothing anywhere has been flagged."
//   "; this deployment has the receipt-audit sweep switched off"
//                                       (`\breceipt audit\b` needs a SPACE;
//                                        the repo's own usual spelling is
//                                        hyphenated, and a semicolon is not
//                                        one of the four banned conjunctions)
//   "Nothing in this deployment binds badly."
//   "No measurement was taken here."
//
// The lesson is not that the lists were too short. It is that they were the
// wrong KIND of instrument. "Does this English sentence make a claim the
// console's evidence does not license" is an open-world question, and a finite
// list of patterns can only ever answer it for the phrasings someone already
// thought of. Seven rounds of adding patterns produced seven rounds of
// paraphrases.
//
// ── What this does instead ────────────────────────────────────────────
//
// It closes the world. Each arm's prose is pinned CHARACTER FOR CHARACTER
// below. The surfaces may emit these strings and no others. A paraphrase does
// not evade this guard, because there is nothing to evade: any text that is not
// byte-identical to its entry fails, whatever it says.
//
// That moves the review to the right place. A maintainer who needs to change
// the copy must change it here too, and the diff on this file is then a copy
// review with the argument for each sentence sitting next to it — rather than a
// silent edit in a page that no pattern happened to match.
//
// ── What it does NOT guarantee, stated because the previous guard's
//    docblock overstated itself and that is what got it trusted ────────
//
// 1. It does not read English. A maintainer who edits a sentence here AND in
//    the page, in the same commit, has satisfied this file completely. The
//    guard makes the change VISIBLE and reviewable; it cannot make it correct.
//    That is the honest limit, and it is why each entry carries `licensedBy`.
// 2. `DASHBOARD_PROSE` pins the prose PARAGRAPH of each arm and NOTHING ELSE
//    on the card.
//
//    This bullet used to end "the card header, the subtitle and the KPI
//    captions are pinned by their own assertions in the test files". That was
//    false — nothing pinned any of them — and it is recorded here rather than
//    quietly deleted, because the false half is what got the gap accepted: a
//    reviewer reading it concludes the captions are covered and stops looking.
//    Twelve copy mutations were then applied one at a time, each leaving the
//    whole suite green, including round 7's verbatim escape sentence printed
//    directly under the figures. They are enumerated at `WHOLE-SURFACE PINS`
//    below, which is the instrument that closes them.
//
//    The lesson is the one this whole file is about, turned on the file
//    itself: a guard's docblock that claims a scope the guard does not have is
//    the same defect as a page's copy claiming evidence it does not have.
// 3. `reported` has no entry because it renders figures and no paragraph. A
//    regression that made it render prose is caught by the assertion pair in
//    `dashboard-revocation.test.tsx` that demands `querySelector('p')` be
//    `null` AND `.kpi-value` be non-empty, not by this table.
//
//    ROUND 10's NB4: this used to say "the test that demands a `.kpi-grid`
//    there", and no test demands a `.kpi-grid` anywhere. The element named was
//    one level off from the element asserted. Harmless on its own, and worth
//    correcting exactly because it is harmless: a scope sentence that names the
//    wrong element is unfalsifiable by reading, so the next person to check it
//    either greps for `.kpi-grid`, finds nothing, and assumes the pin is gone,
//    or does not check at all.
// ══════════════════════════════════════════════════════════════════════
import type { DashboardRevocationState } from '@/lib/utils/revocation';

/**
 * One key per arm that renders prose.
 *
 * DERIVED FROM THE STATE UNION rather than written out, so adding an arm to
 * `DashboardRevocationState` fails to typecheck here until its copy is written
 * and reviewed. This is the same move that finally closed the sibling gate on
 * #95: put the "exactly these and no others" claim where `tsc` enforces it,
 * instead of in a test that reads a list at runtime.
 */
export type ProseKey =
  | Exclude<DashboardRevocationState, { kind: 'reported' | 'unknown' }>['kind']
  | Extract<DashboardRevocationState, { kind: 'unknown' }>['because'];

/** The `because` values alone, for the routing tests that do not render. */
export type UnknownBecause = Extract<DashboardRevocationState, { kind: 'unknown' }>['because'];

/**
 * Every `because` value, EXHAUSTIVE BY CONSTRUCTION.
 *
 * `Object.keys` of a `Record<Union, true>` cannot omit a member, because the
 * `Record` could not have been written without it. That matters more here than
 * it looks: `revocation.test.ts` asserted the reachability of the `because`
 * routes as `expect(new Set(reasons).size).toBe(3)`, and that hard-coded 3 went
 * stale in the same commit that added the fourth value — leaving a test
 * asserting a completeness claim one short of the union it described, which is
 * the shape this whole change exists to remove. Derived, it cannot.
 *
 * A literal array with `satisfies readonly UnknownBecause[]` would NOT do:
 * `['no-flags'] satisfies readonly UnknownBecause[]` type-checks, so
 * `satisfies` catches an extra member and not a missing one.
 */
const BECAUSE_SET: Record<UnknownBecause, true> = {
  'no-flags': true,
  'flag-on-no-counters': true,
  'flag-unreadable': true,
  'counters-partial': true,
};
export const ALL_BECAUSE = Object.keys(BECAUSE_SET) as UnknownBecause[];

export interface ProseEntry {
  /** The bold first line. */
  headline: string;
  /** Everything after the `<br />`. */
  body: string;
  /**
   * What the console actually holds that makes this text true — the question a
   * reviewer should be asking of any edit below.
   */
  licensedBy: string;
}

/**
 * `textContent` concatenates the `<strong>` headline and the body with no
 * separator, because the `<br />` between them contributes nothing.
 */
export function fullProse(e: ProseEntry): string {
  return e.headline + e.body;
}

export const DASHBOARD_PROSE: Record<ProseKey, ProseEntry> = {
  'checked-clean': {
    headline:
      'Revocation checking is enabled, and nothing in this window is classified against a revoked key.',
    body:
      'Two facts, stated separately because the console holds them separately: the deployment ' +
      'reports the compromise-boundary check as on, and this window’s counters are zero. It ' +
      'does not follow that every event in the window was checked — classification happens at ' +
      'audit time, so an event audited before the check was switched on was given its status then. ' +
      'Nor does that status stay fixed: when a revocation fact arrives later, the control plane ' +
      're-audits and amends already-sealed events in place. An amendment does not update the audit ' +
      'timestamp, so it moves these figures only where the amended event already sits inside this ' +
      'window. A longer window may also show figures.',
    licensedBy:
      'A `features.keyRevocationCheck === true` read as exactly true, and a complete counter ' +
      'triple whose three members are each exactly zero — not merely "none of them positive", ' +
      'which is what the routing tested until round 10’s NB5 and which admitted a negative ' +
      'member to the one arm whose job is to say a number is zero. Nothing about WHEN the check ' +
      'ran: the flag is current config, the counters were persisted at audit time.',
  },
  disabled: {
    headline: 'Revocation checking is switched off on this deployment.',
    body:
      'No figures are shown for this window because a zero produced while the check is off is not ' +
      'a finding — which is not the same as having looked and found nothing. It is also not a ' +
      'claim that nothing was classified: classification happens at audit time and is not undone ' +
      'by disabling the check, so anything already recorded stays recorded, in this window as much ' +
      'as an earlier one. What the console cannot tell you from here is whether the check was ' +
      'running earlier in this window. Nothing new will be classified until it is enabled.',
    licensedBy:
      '`features.keyRevocationCheck === false`, and NOTHING about the counters. Upstream gates ' +
      'both the query and the tile on one config value, so a deployment that ran the check over ' +
      'the first half of the window and switched it off yesterday reaches this arm holding real ' +
      'zeros a real check produced. "Nothing was measured" is therefore unlicensed here, in any ' +
      'wording — it has been written three times, each time as the fix for the last.',
  },
  'flag-on-no-counters': {
    headline: 'This deployment’s report about revocation checking does not add up.',
    body:
      'It reports the compromise-boundary check as enabled, yet sent no counters at all — not ' +
      'even zeros. Those two come from the same setting upstream, so one of them is wrong and ' +
      'there is no way to tell which from here. No figures are shown, and no cause is offered ' +
      'beyond that: the check is not reported as off, so saying it was would be inventing an ' +
      'explanation.',
    licensedBy:
      'The flag read as exactly true AND no member of the counter triple present at all (`null`, ' +
      '`undefined` or `{}`). "Not even zeros" is the load-bearing clause: it was false for a ' +
      'commit, when this arm also caught partial triples, and the suite pinned it positively.',
  },
  'counters-partial': {
    headline: 'This deployment’s revocation counters arrived incomplete.',
    body:
      'Some of the three counters came through and some did not, so the ones that did have no ' +
      'denominator to be read against. No figures are shown, because rendering the members that ' +
      'arrived would print a zero for each member that did not — and a zero this console ' +
      'invented is indistinguishable, on screen, from one the check produced.',
    licensedBy:
      'At least one member of the triple present and at least one absent. Nothing about the flag: ' +
      'this arm is reached with the check on, off, unreadable and unreported, so any sentence ' +
      'naming the flag would be true on one route and false on three.',
  },
  'flag-unreadable': {
    headline: 'This deployment did not say whether revocation checking is running.',
    body:
      'It sent a feature report, but the compromise-boundary setting in it was not a value this ' +
      'console can read as on or off. No figures are shown, because whether anything was measured ' +
      'is exactly what could not be established.',
    licensedBy:
      'A `features` OBJECT arrived (not null, not an array, not a scalar) whose ' +
      '`keyRevocationCheck` is neither `true` nor `false`. Says nothing about the counters, ' +
      'because on this route they may be absent or present-and-zero.',
  },
  'no-flags': {
    headline: 'This deployment sent no report about revocation checking.',
    body:
      'Nothing arrived that says whether the compromise-boundary check is running — a backend ' +
      'that predates the feature report, or a payload that was not one. No figures are shown ' +
      'rather than zeros: a zero would claim “nothing is revoked” when it cannot be told ' +
      'apart from never having looked, and the check is disabled by default. Whether anything in ' +
      'this window was classified is exactly what could not be established.',
    licensedBy:
      'No usable `features` at all — the pre-#178 backend, or a wire payload that sent null, ' +
      'an array or a scalar. This is the ONE arm where "the check is disabled by default" is a ' +
      'fair explanation for withholding FIGURES, because nothing has told us otherwise. It says ' +
      'nothing about the counters, and round 9 is why that clause is here: the headline used to ' +
      'read "Nothing in this window carried a revocation classification", which IS a claim about ' +
      'the counters, on a route reached with `keyRevocation` as null, undefined and `{}` — no ' +
      'counters at all. The sibling `flag-on-no-counters` arm refuses to say anything about what ' +
      'was classified on exactly that payload; this arm was applying a different standard to the ' +
      'same absence. A partial triple is still routed away from here before any flag is read, ' +
      'because the BODY would otherwise be false of it too.',
  },
};

/**
 * The prose key for a state, so a test can name the payload and let this derive
 * the arm rather than restating the routing.
 *
 * `reported` returns null: it renders figures, not a paragraph.
 */
export function proseKeyFor(state: DashboardRevocationState): ProseKey | null {
  if (state.kind === 'reported') return null;
  if (state.kind === 'unknown') return state.because;
  return state.kind;
}

// ══════════════════════════════════════════════════════════════════════
// `/trust`, closed the same way and for the same reason.
//
// This surface had NO shape guard at all — `assertNoUnscopedUniversal` is
// dashboard-only, and `assertNamesNoCause` bans four conjunctions rather than
// causes. Round 7 walked through it five times:
//
//   "Nothing in this deployment binds badly."      appended to the all-clear
//   "; this deployment has the receipt-audit sweep switched off"
//                        — round 6's finding respelled. `\breceipt audit\b`
//                          needs a SPACE, and a semicolon is not `because`.
//   "; the receipt-audit sweep is off on this deployment"   (check-ON arm)
//   "— the control plane had nothing to send"      (an attribution the page's
//                                                   own comment forbids)
//   "; this deployment has the receipt-audit sweep off"     (empty-run state)
//
// The violations all-clear — the card that cost round 6 a blocking finding —
// was guarded by `toContain` on one literal plus a `runs.length` split.
// ══════════════════════════════════════════════════════════════════════

/** The four arms of the Revoked-events KPI hint. */
export const TRUST_KPI_HINT = {
  'off-with-runs':
    'Revocation checking is switched off on this deployment — the counters still arrive with ' +
    'every audited run, but a zero from a check that never ran is not a finding',
  'off-no-runs':
    'Revocation checking is switched off on this deployment, and no audited run reached this view ' +
    '— so there are no counters here at all, zero or otherwise',
  'on-with-runs':
    'Not reported by this deployment — no run in this view carried a revocation classification',
  'on-no-runs':
    'Not reported in this view — no audited run reached it, and this console cannot tell from ' +
    'here why not',
} as const;

/**
 * The revocation clause of the violations card subtitle.
 *
 * Gated on the SAME predicate as the KPI above, so the two cannot disagree —
 * suppressing the KPI's number while restating it as "0 revoked across 0 runs"
 * two inches lower is the same unestablished claim in prose.
 */
export const TRUST_VIOLATIONS_SUB = {
  'check-off': 'revocation checking off',
  'not-reported': 'revocation not reported',
} as const;

/** The two empty states under the violations table. */
export const TRUST_EMPTY = {
  'no-runs': {
    title: 'No audited run reached this view',
    description:
      'Nothing here has been checked, so nothing here can be reported clean. A run carries trust ' +
      'figures only once the control plane has audited its receipts.',
    licensedBy:
      '`runs.length === 0`. Nothing audited is not nothing wrong — the conflation of ' +
      'UNMONITORED with CLEAN that #97 exists to remove, which may not survive on the page the ' +
      'change is about. It names NO cause: a disabled receipt audit, a run set with no audits ' +
      'yet, and a detail fetch that failed all produce an empty `runs` identically.',
  },
  'no-violations': {
    title: 'No trust violations',
    /** Templated on the run count, so it is pinned as a function of it. */
    description: (runs: number) =>
      `Every audited receipt bound cleanly to its served context, across the ${runs} run${
        runs === 1 ? '' : 's'
      } in this view.`,
    licensedBy:
      'At least one audited run in view and no finding on any of them. The count is IN the ' +
      'sentence because the claim is bounded by it: this is an assertion about the runs that ' +
      'reached this view, never about the deployment.',
  },
} as const;

// ══════════════════════════════════════════════════════════════════════
// WHOLE-SURFACE PINS (round 9).
//
// ── The hole these close, and how it was found ────────────────────────
//
// Round 8's gate took the pin above at its word. Its docblock said:
//
//   "2. It pins the prose PARAGRAPH of each arm. The card header, the subtitle
//       and the KPI captions are pinned by their own assertions in the test
//       files; this table is not a whole-card guarantee."
//
// The second sentence was FALSE. Nothing pinned the subtitle or the captions.
// Twelve copy mutations were applied one at a time and each left the whole
// suite green:
//
//   · `· this estate is clean` appended to the dashboard card subtitle
//   · `— no key in this deployment has been revoked` appended to the
//     `reported` arm's Pre-compromise caption, i.e. round 7's verbatim escape
//     sentence printed directly under the figures
//   · the caption `Revoked time unverifiable` rewritten to `Revoked time
//     verified clean`, inverting the meaning of an amber fail-closed tile
//   · `· every receipt in this deployment is clean` appended to the `/trust`
//     violations subtitle
//   · five more appends across the `/trust` KPI captions and section subtitle
//   · a whole `<p>No key in this deployment has been revoked.</p>` added
//     inside the `/trust` violations CardBody, rendering in one paint with
//     "No audited run reached this view · Nothing here has been checked, so
//     nothing here can be reported clean" — round 6's blocking finding,
//     reconstructed verbatim, with every guard in the branch green.
//
// The pin was real; its SCOPE was one paragraph, and the docblock asserted a
// scope it did not have. That is worse than the gap, because it is what got
// the gap accepted: a reviewer reading bullet 2 concludes the captions are
// covered.
//
// ── What these add ────────────────────────────────────────────────────
//
// The same instrument, applied to the whole surface rather than one element:
// every block of text the Key Revocation card and the `/trust` violations card
// can render — title, subtitle, KPI label, figure, caption, paragraph, empty
// state, COLUMN HEADER AND TABLE CELL — is enumerated here, and the tests
// assert the rendered blocks EQUAL that list, in order, with nothing outside
// it. An appended clause changes a block. A new element adds one. A rewritten
// caption changes one.
//
// "With nothing outside it" is a claim about the DOM these tests render, and
// round 11 falsified it twice without adding a block: once through the
// `next/link` mock, which discarded every prop and so hid an `aria-label` on
// the violations table's run link (closed), and once through CSS generated
// content, which no jsdom render can see (open, and recorded at
// `NON_ANNOUNCING_ATTRS` below). Both are additions this enumeration cannot
// see rather than additions it permits, which is the distinction the sentence
// above does not make on its own.
//
// ROUND 9 CORRECTION, and it is the second time a bullet in this docblock has
// claimed a closure the code did not have. It said "there is no channel left
// that is near the pin but not in it". Three were:
//
//   - The violations card's TABLE state was pinned by NOTHING. The reader
//     (`violationsBlocks`) hard-required `.empty-state`, so in the one state
//     where the card is actually reporting findings, neither half applied. A
//     `<p>` reading "No key in this deployment has been revoked" inside the
//     CardBody, in one paint with a live `revoked_at_or_after` row listed
//     beneath it, passed the whole suite. That is round 6's blocking finding
//     verbatim, reconstructed inside the card this paragraph called closed.
//   - The `/trust` KPI row had a block list and NO "nothing outside" half, in
//     a commit whose message said it had one. A `<p>` between two `.kpi-card`s
//     inside `.kpi-grid` survived; the same text one element deeper did not.
//   - `title` and `aria-label` were unread by either half on both surfaces.
//
// All three are closed below. The general lesson is the one this module keeps
// relearning from a different direction: a pin's scope is the SELECTOR, not the
// sentence describing it, and a reader who trusts the sentence stops looking.
//
// The `reported` arm's tile ACCENTS are pinned alongside the text, because
// colour is load-bearing on that card by this module's own account
// (`lib/utils/revocation.ts`: pre-compromise is "historically AUTHORIZED —
// the opposite of a violation", and the tile says so in success green).
// Painting the fail-closed tile green was green in the suite too.
//
// ROUND 11 CORRECTION. That argument was made for the dashboard tiles and then
// NOT carried across: on `/trust`, the violations table's three chips were
// pinned one out of three — the one whose class comes from
// `revocationChipClass` — and the STYLESHEET that decides what `.chip.bad`
// means was pinned nowhere at all. Measured, each alone, each 1045/1045 green:
// the flagged row's literal `chip bad` swapped to `chip ok`; the counter-only
// row's the same; the revoked detail cell's `color: C.danger` swapped to
// `C.success`; and `.chip.bad` repainted to `var(--success)` in
// `app/globals.css`, which is a green chip over a live `revoked_at_or_after`
// verdict — issue #97's harm in one word. The last matters most because
// CLAUDE.md sends every colour change to that file: "all colours come from CSS
// variables; raw hex lives only in `app/globals.css`". All four are pinned in
// `trust-page.test.tsx` now, the stylesheet with the same instrument
// `health-labels.test.tsx` already uses.
//
// `TRUST_KPI_CARDS` declares an `accent` and a `hint` per card for the same
// reason — and round 9 found that NOTHING READ EITHER. Repainting `/trust`'s
// fail-closed "Revoked events" tile `var(--success)` survived, as did
// rewriting every accent in the table and replacing a hint with the literal
// string `ANYTHING AT ALL`. The dashboard half of this same commit pinned
// exactly that inversion; the `/trust` half declared the field and left it
// unread, which is the standard the same diff applies to itself in
// `lib/types.ts`: a declaration nothing reads is a claim nothing checks. Both
// are read now, and the tests derive their expected blocks FROM this table
// rather than restating the strings as literals beside it.
//
// ── What they still do NOT guarantee ──────────────────────────────────
//
// The same limit as the paragraph pin, stated again because that is the bullet
// that went wrong: this does not read English. A maintainer who edits a string
// here AND in the page in one commit has satisfied it completely. It makes the
// change visible and reviewable; the argument for each sentence lives beside
// it, and the review is the guarantee.
//
// And the scope is exactly these two cards plus the `/trust` KPI row. Other
// surfaces on either page are NOT pinned by anything here. That sentence is the
// one bullet 2 got wrong; it is written narrowly on purpose.
//
// ROUND 10's NB3 — THE EXAMPLES UNDERSTATED THE HOLE THE SENTENCE ADMITS. The
// list used to read "the dashboard's other cards, `/trust`'s receipt coverage
// and DID sections", which are all CARDS, and a reader takes from that that the
// unpinned surface is other cards. It is not. Measured: `<p>Every receipt in
// this deployment is clean.</p>` placed at page level, directly BETWEEN the
// `.kpi-grid` and the violations card, left 1038/1038 green. Bare copy in the
// gap between two pinned surfaces is the widest part of what this admits, and
// it is also the most natural place for somebody to put a summary sentence.
//
// So the honest form of the scope is a POSITION, not a list of cards: every
// pin here is rooted at a card element or at the KPI row, and the page's own
// children — anything that is a sibling of those roots rather than a
// descendant — are outside every one of them. Naming the three cards made the
// sentence sound narrower than the code, which is the direction that gets a
// gap accepted.
// ══════════════════════════════════════════════════════════════════════

/** Collapse whitespace runs to one space and trim. Re-wrapping JSX is not a copy change. */
export function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Whitespace removed entirely.
 *
 * For the "and nothing BESIDES these blocks" half of each pin, which compares
 * the whole surface's text against the blocks concatenated. That comparison has
 * to be blind to the spacing BETWEEN elements, since whether JSX emits a space
 * between two siblings is a formatting accident.
 */
export function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '');
}

/** The dashboard's Key Revocation card chrome. */
export const DASHBOARD_CARD = {
  title: 'Key Revocation',
  sub:
    'RFC-ACDP-0014 · window-scoped compromise-boundary checks · counted at audit time, so a ' +
    're-audit amending an event older than this window is not reflected here',
} as const;

/**
 * The three tiles the `reported` arm renders, in DOM order, with their accents.
 *
 * The accent is pinned because it carries meaning here, not decoration: the
 * first tile is a SUCCESS-green count of events the control plane defines as
 * historically authorized, and the second is a danger-red count of events that
 * fail closed. Repainting the second green left the suite green.
 */
export const DASHBOARD_REPORTED_TILES = [
  {
    label: 'Pre-compromise (authorized)',
    hint: 'Signed strictly before the compromise boundary — historically authorized',
    accent: 'var(--success)',
  },
  {
    label: 'Revoked at/after boundary',
    hint: 'Fails closed under the strict profile — not attributable to the producer',
    accent: 'var(--danger)',
  },
  {
    label: 'Revoked time unverifiable',
    hint: 'No receipt-attested publish time to compare against the compromise boundary',
    accent: 'var(--warning)',
  },
] as const;

/**
 * Every block of text the Key Revocation card renders, in order.
 *
 * `key === null` is the `reported` arm, which renders the three tiles instead
 * of a paragraph; `counts` are the three figures as they appear on screen.
 */
export function expectedDashboardCardBlocks(opts: {
  key: ProseKey | null;
  counts?: readonly [string, string, string];
}): string[] {
  const head = [DASHBOARD_CARD.title, DASHBOARD_CARD.sub].map(normalize);
  if (opts.key === null) {
    const counts = opts.counts ?? ['', '', ''];
    return [
      ...head,
      ...DASHBOARD_REPORTED_TILES.map((t, i) => normalize(t.label + counts[i] + t.hint)),
    ];
  }
  return [...head, normalize(fullProse(DASHBOARD_PROSE[opts.key]))];
}

/** `/trust`'s page heading. */
export const TRUST_SECTION = {
  title: 'Trust',
  sub: 'Receipt-audit verdicts, coverage, and DID adoption · RFC-ACDP-0010',
} as const;

/**
 * The five KPI cards at the top of `/trust`, in DOM order.
 *
 * `hint: null` means the card renders NO caption — pinned as an absence,
 * because a caption appearing where there was none is exactly how four of the
 * twelve escapes above were written. The Revoked-events card's caption varies
 * and is composed separately from `TRUST_KPI_HINT` / `trustRevokedHint`.
 */
export const TRUST_KPI_CARDS = [
  { label: 'Verified', hint: null, accent: 'var(--success)' },
  { label: 'Historical', hint: 'Valid, signed by a retired key (§9)', accent: 'var(--warning)' },
  { label: 'Flagged events', hint: null, accent: 'var(--danger)' },
  { label: 'Revoked events', hint: 'varies', accent: 'var(--danger)' },
  { label: 'No receipt', hint: null, accent: 'var(--muted)' },
] as const;

/**
 * The Revoked-events caption when the view DOES carry a classification.
 *
 * Templated on both counts because the claim is bounded by them: the number is
 * summed across the view while the gate is per-run, so the caption has to name
 * how much of the view it covers.
 */
export function trustRevokedHint(reportingRuns: number, totalRuns: number): string {
  return (
    'RFC-ACDP-0014 · signed at/after a compromise boundary, or signing time unverifiable · ' +
    `across the ${reportingRuns} of ${totalRuns} runs that reported a classification`
  );
}

/** The violations card chrome. */
export const TRUST_VIOLATIONS_TITLE = 'Trust violations';

/**
 * The violations table's column headers, in DOM order.
 *
 * Round 9's gate: `violationsBlocks` hard-required `.empty-state`, so when the
 * card rendered a TABLE — the state in which it is actually reporting findings
 * — no pin applied to the card at all. Neither half. A `<p>` reading "No key in
 * this deployment has been revoked" inside the CardBody, in one paint with a
 * live `revoked_at_or_after` row listed beneath it, passed the whole suite.
 *
 * That is round 6's blocking finding reconstructed inside the card this
 * module's docblock called closed, in the one state where it is most damaging.
 */
export const TRUST_VIOLATIONS_COLUMNS = ['Run', 'Ctx ID', 'Finding', 'Detail', 'When'] as const;

/**
 * The violations subtitle, composed exactly as the page composes it.
 *
 * The pre-compromise clause is part of the pin and not an afterthought:
 * inverting it to "(revoked keys, violations)" states the precise falsehood
 * `lib/utils/revocation.ts` exists to prevent, and both inverting it and
 * deleting it outright were green before this pin existed.
 */
export function trustViolationsSub(opts: {
  flaggedEvents: number;
  flaggedRuns: number;
  revocationClause: string;
  preCompromiseEvents: number;
}): string {
  const plural = (n: number) => (n === 1 ? '' : 's');
  return (
    `${opts.flaggedEvents} flagged across ${opts.flaggedRuns} run${plural(opts.flaggedRuns)} · ` +
    opts.revocationClause +
    (opts.preCompromiseEvents > 0
      ? ` · ${opts.preCompromiseEvents} pre-compromise (historically authorized, not violations)`
      : '') +
    ' · environmental errors excluded'
  );
}

/** Every block the violations card renders when it is showing an empty state. */
export function expectedTrustViolationsBlocks(opts: {
  sub: string;
  empty: 'no-runs' | 'no-violations';
  runs: number;
}): string[] {
  const e = TRUST_EMPTY[opts.empty];
  const description =
    typeof e.description === 'function' ? e.description(opts.runs) : e.description;
  return [TRUST_VIOLATIONS_TITLE, opts.sub, e.title, description].map(normalize);
}

/**
 * Every block the violations card renders when it is showing a TABLE.
 *
 * `rows` is the cell matrix — five cells per row, in DOM order — supplied by
 * the caller from the fixture it rendered. Deliberately not derived here: the
 * point of the pin is that the card's text is a composition of the FIXTURE and
 * this chrome, and a helper that recomputed the page's own formatting would be
 * a second implementation of the page rather than a check on it.
 */
export function expectedTrustViolationsTableBlocks(opts: {
  sub: string;
  rows: readonly (readonly string[])[];
}): string[] {
  return [
    TRUST_VIOLATIONS_TITLE,
    opts.sub,
    ...TRUST_VIOLATIONS_COLUMNS,
    ...opts.rows.flat(),
  ].map(normalize);
}

/**
 * The attributes whose values are STRUCTURE — the only ones the announced-copy
 * scan may skip.
 *
 * `textContent` cannot see an attribute, and round 9 got an all-clear onto the
 * pinned dashboard card through a text-free `<div title="…" aria-label="…" />`
 * with both pin halves green. `CLAUDE.md` already treats a hover-only
 * disclosure as no disclosure at all — which is an argument for removing the
 * tooltip, not for leaving the channel unpinned, since `aria-label` on the same
 * node reaches a screen reader.
 *
 * ROUND 10 CORRECTION — THE LIST WAS THE WRONG WAY ROUND. It enumerated the
 * attributes that DO announce (`title`, `alt`, `placeholder`, `aria-label`,
 * `aria-description`, `aria-roledescription`, `aria-valuetext`,
 * `aria-placeholder`), which is an OPEN set. Round 10's gate put
 * `<input readOnly value="No key in this deployment has been revoked." />`
 * UNCONDITIONALLY into the violations card body and into the dashboard's Key
 * Revocation card body, and both were green at 1038/1038: `value` renders as
 * visible text, contributes nothing to `textContent`, and was not on the list.
 * `srcdoc`, `download`, `label`, `abbr`, `aria-keyshortcuts` and
 * `aria-errormessage` are the same shape, and enumerating them leaves the next
 * one. The sibling #84 and #95 branches were beaten by the identical escape in
 * the same week, by two other gates — so this is a repo-wide shape, not a quirk
 * of these two cards.
 *
 * So the licence is the NON-announcing side, which is closed as a list of
 * ATTRIBUTES: these surfaces are `div`s, headings, paragraphs, tables and one
 * `svg` per empty state, and an attribute that carries text must either be
 * licensed by value at the call site or be added here, in a diff, with a
 * reason.
 *
 * ROUND 11 CORRECTION. The sentence used to end "which really is closed", full
 * stop, and that is one word wider than the list is. Two channels get past it
 * without adding an attribute this list does not hold:
 *
 *   - `class` is ON this list, correctly — it announces nothing itself — and a
 *     class plus `.all-clear::after { content: ' No key in this deployment has
 *     been revoked.'; }` in `app/globals.css` prints a sentence under the
 *     pinned paragraph in every real browser at 1045/1045 green. jsdom loads no
 *     stylesheet and `textContent` never includes generated content, so neither
 *     half of every pin in this module can see it. The sibling #95 branch built
 *     `test/support/stylesheet-text.ts` for exactly this channel, over the
 *     union of the stylesheets the repository holds and the ones the app loads;
 *     it lands before this branch does, and these two surfaces want the same
 *     bound. Recorded here as a residual rather than as a closure, because the
 *     previous version of this sentence is what would have stopped the next
 *     reader looking.
 *   - The `next/link` MOCK used to render a bare `<span>` carrying only its
 *     children, so nothing hung on the violations table's one interactive
 *     element reached any pin. That one is closed — `trust-page.test.tsx`
 *     forwards props now, and has a case for `aria-label` and `title` on the
 *     run link — and it is worth recording beside this list because the attack
 *     did not need an attribute the list was missing. It needed a test double
 *     that renders less than the component.
 *
 * `aria-hidden` is on this list because it announces nothing ITSELF. What it
 * SILENCES beneath it is a different defect — a suppression rather than an
 * addition — and no scan over attribute values can see one; that is
 * `expectNothingSilenced`'s job at the call sites.
 */
export const NON_ANNOUNCING_ATTRS = [
  'class',
  'style',
  'id',
  'role',
  'tabindex',
  'type',
  'disabled',
  'open',
  'colspan',
  'rowspan',
  'scope',
  'href',
  // Announces nothing itself; what it hides is the reachability check's problem.
  'aria-hidden',
  // Id references carry no text of their own; that they must RESOLVE INSIDE the
  // pinned surface is asserted separately.
  'aria-labelledby',
  'aria-describedby',
  'aria-details',
  // SVG: the icons `EmptyState` and `KpiCard` render.
  'xmlns',
  'width',
  'height',
  'viewbox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'd',
  'points',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'rx',
  'ry',
  'transform',
] as const;

/** The id-reference attributes, which must resolve inside the pinned surface. */
export const ID_REFERENCE_ATTRS = ['aria-labelledby', 'aria-describedby', 'aria-details'] as const;

// ══════════════════════════════════════════════════════════════════════
// ROUND 13's B3, B4 and B5: three instruments the two revocation surfaces
// had one copy of each, or none.
//
// Round 11's B4 was the two surfaces' reachability walks differing by one
// line. The answer then was to fix both copies; the answer now is that there
// is one copy, here, and both surfaces import it — because "fix both copies"
// is a promise about future edits and this is a property of the code.
// ══════════════════════════════════════════════════════════════════════

/**
 * The attributes that remove a subtree from a reader without removing it from
 * the DOM.
 *
 * Genuinely closed, and worth saying why rather than asserting it: HTML gives
 * `hidden` and `inert`, ARIA gives `aria-hidden`, and there is no fourth. Every
 * OTHER way to make text unreadable is a styling question, which is bounded
 * below by a completely different mechanism because a denylist of styling
 * properties is not a closed set and this branch has been beaten by open sets
 * in four consecutive rounds.
 */
export const SUPPRESSING_ATTRS = ['aria-hidden', 'hidden', 'inert'] as const;

export function suppressorOn(node: Element): string | null {
  if (node.getAttribute('aria-hidden') === 'true') return 'aria-hidden="true"';
  if (node.hasAttribute('hidden')) return 'hidden';
  if (node.hasAttribute('inert')) return 'inert';
  return null;
}

/**
 * Every inline style declaration on the pinned surface and on everything above
 * it, as `<tag.class> prop: value` — the PRODUCT, for the caller to pin.
 *
 * ── ROUND 13's B4: THE SUPPRESSION CHANNEL THIS APP ACTUALLY USES ────
 *
 * `suppressorOn` models three attributes, and both reachability walks were
 * built on it alone under a docblock saying "everything written down is still
 * REACHABLE". Measured on both surfaces:
 *
 *   <div className="kpi-grid" style={{ display: 'none' }}>            SURVIVED
 *   <div className="kpi-grid" style={{ visibility: 'hidden' }}>       SURVIVED
 *   <div style={{ display: 'none' }}><RevocationBody …/></div>        SURVIVED
 *
 * each at 42 files / 1050 tests green, while `aria-hidden="true"` on the same
 * element is 3 red. `display: none` is a STRICTLY STRONGER suppression — it
 * removes the subtree from the accessibility tree and from the visual render —
 * so the walks caught the weaker one and not the stronger.
 *
 * The excuse written beside them was "not a styling check: jsdom applies no
 * stylesheet, so `display: none` and `visibility: hidden` are invisible from
 * here". The premise is about STYLESHEETS. jsdom reflects an INLINE `style`
 * attribute exactly, and `CLAUDE.md` mandates inline styles for this
 * repository — so the one styling channel these pages actually use is the one
 * that sentence excused itself from.
 *
 * A denylist (`display`, `visibility`, `opacity`, `font-size: 0`, `clip-path`,
 * `color: transparent`, `content-visibility`, `transform: scale(0)`, …) is an
 * open set. So the ALLOW side is bounded instead, the way every other
 * enumeration on this branch has had to be inverted: this returns every inline
 * declaration on and above the pinned surface, and the caller pins the whole
 * product. A new inline style anywhere on the path is then a reviewable diff
 * whatever property it sets, and nobody has to have anticipated it.
 */
export function inlineStyleDeclarations(root: HTMLElement, blocks: readonly HTMLElement[]): string[] {
  const seen = new Set<Element>();
  const out = new Set<string>();
  const describe = (el: Element): string => {
    const cls = el.getAttribute('class');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`;
  };
  const visit = (el: Element): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const style = (el as HTMLElement).style;
    if (!style) return;
    for (let n = 0; n < style.length; n += 1) {
      const prop = style.item(n);
      out.add(`${describe(el)} ${prop}: ${style.getPropertyValue(prop).trim()}`);
    }
  };
  for (const el of [root, ...root.querySelectorAll('*')]) visit(el);
  // …and UPWARDS to the document, because suppression is inherited: an
  // ancestor above the pinned surface removes it exactly as one inside it
  // does. This is round 11's B4 in the styling channel.
  for (const block of blocks) {
    for (let n: Element | null = block; n !== null; n = n.parentElement) visit(n);
  }
  return [...out].sort();
}

/**
 * The members of an `export interface X { … }`, read out of the module that
 * declares it.
 *
 * ── ROUND 13's B5: ONE TYPE, ON ONE SURFACE ──────────────────────────
 *
 * Round 12 closed NB1 by varying the six `TrustTotals` members the violations
 * card does not read, and checking the read/unread split against the interface
 * so a new member lands in neither list and is red. The commit said "a new
 * member of that interface lands in neither list and is a red test rather than
 * a new unvaried coordinate" — true of `TrustTotals`, and the general property
 * it reads as was never built. Round 13 measured seven escapes through the
 * types it was not carried to, each a one-line coordinate rendering a
 * deployment-wide all-clear at 42 files / 1050 tests green, and two of them
 * fire on the console's own DEFAULT DEMO POSTURE:
 *
 *   d.recentRuns.length > 0                        (dashboard — MOCK_DASHBOARD
 *                                                   sets five)
 *   features?.logInclusionAudit === false          (MOCK_DASHBOARD sets false)
 *   d.features?.witnessCosigning === false         (MOCK_DASHBOARD sets false)
 *   features?.receiptAudit === false               (upstream default false)
 *   runs.some(r => r.run.status === 'completed')   (CpRun cast with 3 of 12
 *   runs.some(r => (r.run.registries ?? []).length) members set)
 *
 * So the instrument is here, and `assertClassifiesEveryMember` is what makes
 * "this surface renders identically across every member of every input it is
 * handed" a property of the code rather than a sentence in a commit message.
 */
export function interfaceMembers(source: string, name: string): string[] {
  const body = source.match(new RegExp(`(?:export )?interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!body) throw new Error(`no \`interface ${name}\` in the given source — this classification lost its subject`);
  const members = [...body[1].matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((m) => m[1]).sort();
  if (members.length === 0) throw new Error(`\`interface ${name}\` parsed to no members — the reader is vacuous`);
  return members;
}

/**
 * The read and unread lists must PARTITION the interface: every member in
 * exactly one, and nothing in neither.
 *
 * "In neither" is the whole point. A member nobody classified is a coordinate
 * no fixture varies, which is the shape of every escape round 13 found.
 */
export function classificationGaps(
  members: readonly string[],
  read: readonly string[],
  unread: readonly string[],
): { unclassified: string[]; unknown: string[]; both: string[] } {
  const r = new Set(read);
  const u = new Set(unread);
  return {
    unclassified: members.filter((m) => !r.has(m) && !u.has(m)),
    unknown: [...r, ...u].filter((n) => !members.includes(n)).sort(),
    both: members.filter((m) => r.has(m) && u.has(m)),
  };
}

/**
 * Every posture that varies a member of an input the pinned surface does NOT
 * read — one member at a time, and then all of them at once.
 *
 * ── THE INSTRUMENT, NOT THE INSTANCE ─────────────────────────────────
 *
 * Round 12 built this shape ONCE, by hand, for `TrustTotals` on the violations
 * card. Round 13 then measured seven one-line escapes through the other inputs
 * the same two surfaces receive, each rendering a deployment-wide all-clear at
 * 42 files / 1050 tests green, and two of them fire on the console's own
 * default demo posture. The instrument was right; it was applied to one type on
 * one page, and the commit message generalised it anyway.
 *
 * So the sweep is derived rather than written:
 *
 *  - `read` / `unread` must PARTITION the interface, read out of the module
 *    that declares it. A member in neither list throws — a new field is a
 *    coordinate nothing varies, which is the shape of every escape round 13
 *    found, and a hand-written pair of lists cannot notice its own gap.
 *  - Every unread member must have a value in `rich` that DIFFERS from the one
 *    in `lean`, or this throws. A posture that varies a field to the value it
 *    already holds distinguishes nothing, and would leave the sweep green and
 *    vacuous.
 *  - `lean` is the emptiest posture the input admits and `rich` the most
 *    eventful one, so a gate reading the member in EITHER direction
 *    (`x.length > 0` and `x.length === 0`, `=== true` and `=== false`) is
 *    caught. Round 13's escapes came in both.
 *
 * The caller renders `lean` for its expectation and then asserts every returned
 * posture renders identically. The claim that buys is "this surface renders the
 * same thing whatever those members hold", which is about the surface's INPUTS
 * rather than about the code that happens to ignore them today — and that is
 * the version that survives the next edit.
 */
export function unreadMemberPostures<T extends object>(opts: {
  source: string;
  interfaceName: string;
  read: readonly string[];
  unread: readonly string[];
  lean: T;
  rich: Record<string, unknown>;
}): { label: string; input: T }[] {
  const { source, interfaceName, read, unread, lean, rich } = opts;
  const gaps = classificationGaps(interfaceMembers(source, interfaceName), read, unread);
  if (gaps.unclassified.length > 0) {
    throw new Error(
      `${interfaceName} has member(s) nothing here classifies: ${gaps.unclassified.join(', ')} — ` +
        'a member in neither list is a coordinate no posture varies',
    );
  }
  if (gaps.unknown.length > 0) {
    throw new Error(`${interfaceName} no longer declares: ${gaps.unknown.join(', ')}`);
  }
  if (gaps.both.length > 0) {
    throw new Error(`${interfaceName} member(s) called both read and unread: ${gaps.both.join(', ')}`);
  }
  if (unread.length === 0) {
    throw new Error(`${interfaceName} has no unread member — this sweep would assert nothing`);
  }
  const show = (v: unknown): string => JSON.stringify(v) ?? 'undefined';
  const postures: { label: string; input: T }[] = [];
  const together: Record<string, unknown> = {};
  for (const member of unread) {
    if (!(member in rich)) {
      throw new Error(
        `no varied value for ${interfaceName}.${member} — an unswept member is an unvaried coordinate`,
      );
    }
    if (show((lean as Record<string, unknown>)[member]) === show(rich[member])) {
      throw new Error(
        `${interfaceName}.${member} varies to the value it already holds (${show(rich[member])}) — ` +
          'this posture distinguishes nothing',
      );
    }
    together[member] = rich[member];
    postures.push({
      label: `${interfaceName}.${member} = ${show(rich[member])}`,
      input: { ...lean, [member]: rich[member] } as T,
    });
  }
  postures.push({
    label: `${interfaceName}: all ${unread.length} unread members at once`,
    input: { ...lean, ...together } as T,
  });
  return postures;
}

/**
 * The `:root` custom-property table of a stylesheet.
 *
 * ── ROUND 13's B3: A TOKEN NAME IS NOT A COLOUR ──────────────────────
 *
 * The colour pin asserted `colourOf('.chip.bad') === 'var(--danger)'` and that
 * the three token NAMES are distinct, under a docblock calling that "the
 * property an operator actually relies on". An operator relies on distinct
 * COLOURS. Measured, one line in the file `CLAUDE.md` names as the only home
 * for colour:
 *
 *   :root { --danger: #f05d7a; }  ->  :root { --danger: #22d48f; }
 *
 * 42 files / 1050 tests green, and it repaints the fail-closed chip, the
 * detail cell, `/trust`'s "Revoked events" KPI accent and the dashboard's
 * "Revoked at/after boundary" tile — every danger surface in the console — in
 * success green. `new Set(tones).size === 3` passes, because three distinct
 * names can resolve to two colours.
 *
 * Two more channels went with it. `rule()` used `css.match`, which returns the
 * FIRST occurrence while the cascade takes the last, so appending
 * `.data-table .chip.bad { color: var(--success) }` was invisible; and an
 * inline `style={{ color: C.success }}` on the chip is invisible to every
 * attribute-based half because `style` is licensed as non-announcing.
 */
export function cssCustomProperties(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      out[decl[1]] = decl[2].trim();
    }
  }
  return out;
}

/**
 * The LAST rule whose selector ends with the given one — the cascade's answer,
 * not the first match's.
 *
 * The selector is matched at a token boundary, so `.data-table .chip.bad` is
 * found as a rule for `.chip.bad` and `.chip.badge` is not.
 */
export function lastRuleFor(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp(`([^{}]*${esc})\\s*\\{([^}]*)\\}`, 'g'))].filter(
    (m) => !/[A-Za-z0-9_-]/.test(css.slice(m.index + m[1].length, m.index + m[1].length + 1)),
  );
  return rules.length === 0 ? null : rules[rules.length - 1][2];
}

/** The colour a selector RESOLVES to, through the `:root` table. */
export function resolvedColour(css: string, selector: string): string | null {
  const block = lastRuleFor(css, selector);
  if (block === null) return null;
  const m = block.match(/(?:^|[;{])\s*color\s*:\s*([^;}]+)/);
  if (!m) return null;
  const value = m[1].trim();
  const vars = cssCustomProperties(css);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? (vars[ref[1]] ?? null) : value;
}
