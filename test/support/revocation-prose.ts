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
//    regression that made it render prose is caught by the test that demands a
//    `.kpi-grid` there, not by this table.
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
      'triple whose three members are all zero. Nothing about WHEN the check ran: the flag is ' +
      'current config, the counters were persisted at audit time.',
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
    headline: 'Nothing in this window carried a revocation classification.',
    body:
      'No figures are shown rather than zeros: a zero would claim “nothing is revoked” ' +
      'when it cannot be told apart from never having looked — the check is disabled by ' +
      'default. This is a statement about the selected window, not about the deployment: a ' +
      'different window may well show figures. They appear as soon as anything is classified.',
    licensedBy:
      'No usable `features` at all — the pre-#178 backend, or a wire payload that sent null, ' +
      'an array or a scalar. This is the ONE arm where "the check is disabled by default" is a ' +
      'fair explanation, because nothing has told us otherwise. It is also the one arm whose ' +
      'headline is a claim about the counters, which is why a partial triple is routed away from ' +
      'it BEFORE any flag is read.',
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
// state — is enumerated here, and the tests assert the rendered blocks EQUAL
// that list, in order, with nothing outside it. An appended clause changes a
// block. A new element adds one. A rewritten caption changes one. There is no
// channel left that is "near the pin but not in it", which is where all twelve
// of the mutations above lived.
//
// The `reported` arm's tile ACCENTS are pinned alongside the text, because
// colour is load-bearing on that card by this module's own account
// (`lib/utils/revocation.ts`: pre-compromise is "historically AUTHORIZED —
// the opposite of a violation", and the tile says so in success green).
// Painting the fail-closed tile green was green in the suite too.
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
// surfaces on either page — the dashboard's other cards, `/trust`'s receipt
// coverage and DID sections — are NOT pinned by anything here. That sentence
// is the one bullet 2 got wrong; it is written narrowly on purpose.
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
