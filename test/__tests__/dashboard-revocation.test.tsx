// ══════════════════════════════════════════════════════════════════════
// The dashboard's Key Revocation card.
//
// UI-2 gated the card on `{d.keyRevocation && …}`, on the premise that the
// control plane omits the field when `KEY_REVOCATION_CHECK_ENABLED=false`. It
// does not: `dashboard.service.ts` builds the object unconditionally with
// `?? 0` on every member and no reference to the flag — which defaults to
// false. So the shipped render was a green "Pre-compromise (authorized) 0", a
// red "Revoked at/after boundary 0" and an amber "Revoked time unverifiable 0"
// from a deployment that never checked anything.
//
// These tests come in discriminating pairs: for each "renders absent" case
// there is a sibling that differs only in the payload and demands the numbers
// back. Inverting the render condition, or deleting it, fails one of each pair
// — neither can pass on an empty render.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpDashboardOverview } from '@/lib/types';
import { dashboardRevocationState } from '@/lib/utils/revocation';
import {
  ANNOUNCED_TEXT_ATTRS,
  DASHBOARD_CARD,
  DASHBOARD_PROSE,
  DASHBOARD_REPORTED_TILES,
  expectedDashboardCardBlocks,
  fullProse,
  normalize,
  proseKeyFor,
  squash,
  type ProseKey,
} from '../support/revocation-prose';

const useDashboard = vi.fn();
vi.mock('@/lib/hooks/use-dashboard', () => ({ useDashboard: () => useDashboard() }));
vi.mock('@/lib/hooks/use-scenarios', () => ({ useScenarios: () => ({ data: [] }) }));
vi.mock('@/lib/hooks/use-global-events', () => ({ useGlobalEvents: () => ({ events: [], live: false }) }));
// recharts needs a measured container it never gets in jsdom, and this page
// loads it through `next/dynamic`. The chart is not what is under test.
vi.mock('@/components/charts/bar-chart-card', () => ({ BarChartCard: () => <div data-testid="chart" /> }));
// `RecentRunsTable` calls `useRouter`, which throws outside an App Router tree.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DashboardPage from '@/app/dashboard/page';

function overview(over: Partial<CpDashboardOverview> = {}): CpDashboardOverview {
  return {
    window: '24h',
    totalRuns: 4,
    totalContexts: 9,
    totalAgents: 2,
    recentRuns: [],
    byScenario: [],
    byRegistry: [{ registry_authority: 'registry-a.playground.local', event_count: 9 }],
    ...over,
  };
}

function renderWith(data: CpDashboardOverview) {
  useDashboard.mockReturnValue({ isLoading: false, error: null, data });
  return render(<DashboardPage />);
}

/** The Key Revocation card, located by its heading rather than by position. */
function revocationCard(): HTMLElement {
  const el = screen.getByText('Key Revocation').closest('.card');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

afterEach(() => {
  cleanup();
  useDashboard.mockReset();
});

// ══════════════════════════════════════════════════════════════════════
// MIGRATED, not deleted (#97). Every test in the block below predates
// `features` and passes NO flags. THREE of the five therefore exercise the
// `unknown` arm — a control plane predating acdp-control-plane#178, where the
// old prose (hedge included) is still exactly the honest thing to say. The
// other two carry a non-zero count, which is self-evidencing and routes to
// `reported` whatever the flags say. That is the mapping criterion 8 asks for,
// and it is why these read unchanged:
//
//   "all-zero payload renders no figure"      -> kind `unknown`
//   "one non-zero renders all three figures"  -> kind `reported`
//   "omitted field lands in the same state"   -> kind `unknown`
//   "scopes the absence to the WINDOW"        -> kind `unknown`
//   "counters are window-scoped"              -> kind `reported`
//
// The four-state, six-rendering coverage the flags make possible is the
// describe that follows.
// ══════════════════════════════════════════════════════════════════════
describe('dashboard — Key Revocation with no feature flags (the pre-#178 backend)', () => {
  it('keeps the card but renders NO figure — not even a 0', () => {
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    // Half one: the card is still there. A card that vanishes is
    // indistinguishable from a control plane that predates the feature.
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain(DASHBOARD_PROSE['no-flags'].headline);
    // Half two: no numeric KPI inside it. Asserted structurally rather than by
    // searching for the string "0" — the surrounding prose has carried digits
    // before (it used to cite an upstream issue number), and a substring check
    // would have been satisfied by those.
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(card.textContent).not.toContain('Pre-compromise (authorized)');
    expect(card.textContent).not.toContain('Revoked at/after boundary');
    expect(card.textContent).not.toContain('Revoked time unverifiable');
  });

  it('DISCRIMINATES: one non-zero count renders all three figures, zeros included', () => {
    // The 9 proves the check ran, which makes the two zeros beside it real
    // information rather than an unexamined default.
    renderWith(
      overview({ keyRevocation: { preCompromise: 9, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    const values = [...card.querySelectorAll('.kpi-value')].map((v) => v.textContent);
    expect(values).toEqual(['9', '0', '0']);
    expect(card.textContent).not.toContain(DASHBOARD_PROSE['no-flags'].headline);
  });

  it('a pre-Phase-14 backend that omits the field lands in the same absent state', () => {
    renderWith(overview({ keyRevocation: undefined }));
    const card = revocationCard();
    expect(card.textContent).toContain(DASHBOARD_PROSE['no-flags'].headline);
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
  });

  it('scopes the absence claim to the WINDOW, never to the deployment', () => {
    // The copy used to read "Revocation checking is not reported by this
    // deployment" — a claim this card cannot support and that the demo dataset
    // refutes one click away: `DEMO_WINDOW_REVOCATION` is all-zero at 1h and
    // non-zero at 6h, so the same deployment produced both verdicts. Evidence
    // gathered over a window can only ever license a statement about that
    // window; /trust's equivalent copy already got this right.
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    // Scoped to the PARAGRAPH, not the card. Read off the whole card this was
    // half-vacuous in exactly the way round 2 found for the `checked-clean`
    // guard: the card subtitle carries its own "…older than this window is not
    // reflected here", which satisfied `toContain('window')` on its own, so
    // dropping the scope from the claim itself left this green. Proven by
    // stripping every "window" from the arm's prose — this test stayed green
    // until it was rescoped.
    const text = proseText();
    expect(text).toContain('window');
    expect(text).not.toMatch(/not reported by this deployment/);
    expect(text).not.toMatch(/this deployment (does not|never)/);
    // GUARDS THE GUARD, the same way the `checked-clean` sibling does. Without
    // these two lines the scoping fix above is itself unpinned: reverting
    // `proseText()` to `revocationCard().textContent` left this green, because
    // the subtitle's own "older than this window" supplies the substring. The
    // pair below cannot both hold on the whole card, so the revert now fails.
    expect(revocationCard().textContent).toMatch(/older than this window/);
    expect(text).not.toMatch(/older than this window/);
    // Whole-card reading would also pick up the header; the prose must not.
    expect(text).not.toMatch(/RFC-ACDP-0014/);
    // "…, and none ever has." was appended to this arm's headline with every
    // assertion in this test green — the negatives named two specific old
    // sentences, and a new clause is neither of them.
    assertNoUnscopedUniversal(text);
  });

  it('records that the counters are window-scoped and counted at audit time', () => {
    // A retroactive re-audit deliberately never touches `checked_at` upstream,
    // so an amendment marking hundreds of older events fail-closed leaves this
    // card at its old figures while the per-run panel is current. An operator
    // reading the card cannot infer that; it has to be written down.
    renderWith(overview({ keyRevocation: { preCompromise: 1, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }));
    expect(revocationCard().textContent).toContain('a re-audit amending an event older than this window is not reflected here');
  });
});

// ══════════════════════════════════════════════════════════════════════
// The four arms (#97).
//
// The card used to have two: figures, or one paragraph of prose. That prose
// asserted "the check is disabled by default" in EVERY not-reported case, which
// is simply false whenever the deployment says the check is on — the last
// surviving could-not-establish claim on this page.
//
// The arms must be distinguishable from each other, not merely present, or an
// operator gains nothing: the whole point is that a clean estate and an
// unmonitored one stop looking alike.
// ══════════════════════════════════════════════════════════════════════
const FEATURES: NonNullable<CpDashboardOverview['features']> = {
  receiptAudit: true,
  keyRevocationCheck: true,
  logWitness: true,
  logInclusionAudit: true,
  witnessCosigning: true,
  witnessQuorum: true,
};
const CLEAN = { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 };
const SOME = { preCompromise: 9, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 };

/** The one phrase that may appear in exactly one arm. */
const HEDGE = 'the check is disabled by default';

/**
 * One payload per rendering arm, shared by the distinctness loop and the
 * closed-set pin so neither can drift out from under the other.
 *
 * It was two separate inline lists. The pin is only as complete as this list,
 * so the pin also asserts that iterating it reaches every key in
 * `DASHBOARD_PROSE` — a PROSE payload dropped from here fails there rather
 * than silently un-checking an arm.
 *
 * THE `reported` PAYLOAD IS THE EXCEPTION, and this docblock claimed otherwise
 * for a round. `reported` has no `DASHBOARD_PROSE` entry (it renders figures,
 * not a paragraph), so the seen-set assertion cannot notice its absence:
 * dropping `[SOME, FEATURES]` from this list left the whole suite green. It is
 * still covered — by the distinctness loop, by two dedicated tests above, and
 * since round 9 by `pins the reported arm`, which carries its own payload — so
 * there was no coverage hole, only a docblock overstating what one assertion
 * reaches. The `pins every block` test asserts the same seen-set, with the same
 * exception, for the same reason.
 */
const ARM_PAYLOADS: ReadonlyArray<
  readonly [CpDashboardOverview['keyRevocation'], CpDashboardOverview['features']]
> = [
  [SOME, FEATURES], // reported
  [CLEAN, FEATURES], // checked-clean
  [CLEAN, { ...FEATURES, keyRevocationCheck: false }], // disabled
  [CLEAN, undefined], // unknown/no-flags
  [null, FEATURES], // unknown/flag-on-no-counters
  [{ revokedAtOrAfter: 3 } as never, FEATURES], // unknown/counters-partial
  [CLEAN, { ...FEATURES, keyRevocationCheck: 'true' } as unknown as typeof FEATURES], // flag-unreadable
] as const;

/**
 * The explanatory paragraph of the revocation tile, excluding the card header
 * and subtitle. The prose arms render as `<p>`; the `reported` arm renders a
 * `.kpi-grid` and no paragraph at all, so calling this on THAT arm THROWS —
 * deliberately. Returning `''` (what it used to do) silently satisfies every
 * `not.toMatch` in this file, so a change that removed the paragraph, or
 * reverted the prose arms to `<div>`, would turn a whole class of assertions
 * into no-ops while staying green.
 */
/**
 * Refuse the claim shapes that reach past this card's evidence, wherever they
 * appear in its prose.
 *
 * Every guard in this file used to name one wrong sentence, and round 6's gate
 * went through four of them at once by rephrasing rather than by deleting: "and
 * none ever has", "Nothing in the estate is revoked", "it ran over every event
 * here", "every audited run this deployment has ever recorded". Each was a
 * NEW sentence, so no `not.toMatch` aimed at the OLD one could see it.
 *
 * It was rewritten to "ban the SHAPE, not the sentence". IT DOES NOT DO THAT,
 * and this docblock claimed it did for a full round — which is worth more than
 * the guard itself, because a guard trusted to do something it cannot is how
 * the next four paraphrases got through review.
 *
 * What it actually is: nine literal phrase patterns, i.e. an enumerated-sentence
 * guard one abstraction level up. Round 7 appended four different unscoped
 * universals to the `checked-clean` arm with the whole suite green:
 *
 *   "No key in this deployment has been revoked."
 *   "Each event across this deployment checked out clean, throughout."
 *   "The entire fleet is clean."   (pattern 3 lists estate|deployment|fleet,
 *                                   pattern 4 lists only estate|deployment)
 *   "Across all 0 revoked events on record, nothing anywhere has been flagged."
 *
 * KEEP IT ANYWAY, and know what it is for. It fails FAST and READABLY — it
 * names the offending phrase — where the exact-text pin below reports only that
 * a paragraph changed. It is a lint, not a proof. The proof that the arms
 * cannot say more than their evidence licenses is the closed-set pin in
 * `test/support/revocation-prose.ts`, which admits exactly one string per arm
 * and therefore has no paraphrase to miss.
 *
 * The one legitimate use of "every event" — "It does not follow that every
 * event in the window was checked" — is a DENIAL of such a claim and is allowed
 * for explicitly, because a matcher cannot read negation. That exemption is
 * itself a reason not to trust this function: a guard that has to be told about
 * negation cannot be reading meaning.
 */
function assertNoUnscopedUniversal(text: string): void {
  const allowedDenial = /does not follow that every event in the window was checked/gi;
  // `g`, because a non-global `String.replace` strips only the FIRST match — so
  // a second legitimate denial would have produced a false failure.
  const stripped = text.replace(allowedDenial, '');
  for (const pattern of [
    /\bnone ever\b/i,
    /\bever (recorded|been|has|have)\b/i,
    /\bnothing in the (estate|deployment|fleet)\b/i,
    /\bthe (whole|entire) (estate|deployment)\b/i,
    /\bat any (time|point)\b/i,
    /\bever\b.{0,20}\b(revoked|classified|audited)\b/i,
    /\bevery (event|run|receipt)\b/i,
    /\ball (events|runs|receipts)\b/i,
    /\balways\b/i,
  ]) {
    expect(stripped, `unscoped universal \`${pattern}\` in: ${stripped.slice(0, 160)}`).not.toMatch(
      pattern,
    );
  }
}

function proseText(): string {
  const p = revocationCard().querySelector('p');
  if (p === null) {
    throw new Error('no <p> in the revocation card: the prose arms render no paragraph to scope');
  }
  return p.textContent ?? '';
}

describe('dashboard — Key Revocation says which of four states it is', () => {
  it('reported: figures, no prose', () => {
    renderWith(overview({ keyRevocation: SOME, features: FEATURES }));
    const card = revocationCard();
    expect([...card.querySelectorAll('.kpi-value')].map((v) => v.textContent)).toEqual(['9', '0', '0']);
    expect(card.textContent).not.toContain(HEDGE);
  });

  it('checked-clean: the flag is on and this window is empty — stated as two facts, not one inference', () => {
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).toContain('Revocation checking is enabled');
    expect(text).toContain('nothing in this window is classified against a revoked key');
    expect(revocationCard().querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(text).not.toContain(HEDGE);
  });

  it('checked-clean does NOT claim the check ran over this window\u2019s events', () => {
    // The gate's finding. The console holds two facts: a flag describing the
    // deployment NOW, and counters persisted AT AUDIT TIME. An event audited
    // before the check was switched on was classified `none` then and nothing
    // about flipping the flag revisits it on its own (`lib/types.ts` records
    // that `key_revocation_status` is NOT NULL DEFAULT 'none'), and the console
    // cannot know when the flag was flipped — so "the check ran over this
    // window" is exactly the inference that does not follow. It is the same
    // argument this change uses to deny /trust a clean arm; it transfers here
    // unchanged.
    //
    // NB what this comment must NOT say, and said until round 5's gate: that
    // "enabling the check does not re-classify rows already audited". Flipping
    // the flag does not, but the §7 sweep does — upstream re-audits
    // known-revoked fingerprints and amends already-sealed rows in place, which
    // is the very fact the test 130 lines below pins. Two comments in one file
    // contradicting each other is how a false claim gets back into the copy.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).not.toMatch(/checking ran over this window/i);
    // NOT anchored on the word "window". Round 6's gate inserted "it ran over
    // every event here" into this arm and every negative here stayed green,
    // because all three required `window` adjacent to `ran`/`checked`. The same
    // forbidden claim phrased with "here", "in this view" or "in the period"
    // walked straight through the guard written to forbid it — a scope word is
    // not what makes the claim wrong, the claim is wrong however it is scoped.
    expect(text).not.toMatch(/(ran|checked) (over|across)\b/i);
    expect(text).not.toMatch(/every event .{0,30}(was|were) checked(?! )/i);
    // And it says so positively, rather than merely omitting the claim.
    expect(text).toMatch(/does not follow that every event in the window was checked/i);
    expect(text).toMatch(/audit time/i);
  });

  it('every clean claim in the checked-clean arm is scoped to the window, sentence by sentence', () => {
    // `toContain('this window')` over the whole card is not the assertion the
    // docblock claims. The arm makes the clean statement more than once, so one
    // sentence can lose its scope while another keeps the substring green — a
    // mutation dropping "in this window" from the result sentence passed. The
    // scope has to hold per sentence, because a sentence is what a reader takes
    // as a unit: "nothing was classified against a revoked key" reads as a
    // deployment-level all-clear regardless of what preceded it.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    // Scoped to the PROSE paragraph, not the whole card. Round 2 of this
    // change's gate found the card-wide version half-vacuous: the card header
    // and its subtitle carry no terminal period, so splitting the card text on
    // the period glued "…an event older than this window is not reflected here"
    // onto the headline claim — and the SUBTITLE's own "this window" then
    // satisfied the scope assertion no matter what the claim said. Dropping
    // "in this window" from the headline left this test green.
    const prose = proseText();
    // `<br />` contributes no whitespace to textContent, so split on the period
    // itself rather than on a space after it.
    const sentences = prose.split(/(?<=\.)\s*/).filter((x) => x.trim().length > 0);
    const claims = sentences.filter((x) =>
      /classified against a revoked key|counters are zero/.test(x),
    );
    // Without this the loop below goes vacuous the moment the copy is reworded.
    expect(claims.length).toBeGreaterThanOrEqual(2);
    for (const x of claims) expect(x).toMatch(/this window|selected window/);
  });

  it('GUARDS THE GUARD: the card subtitle cannot supply the scope for a claim', () => {
    // The mechanism of the defect above, pinned directly. The subtitle is
    // outside the prose paragraph, so no wording of it can satisfy the per-
    // sentence assertion — and the prose must therefore carry its own scope.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const card = revocationCard().textContent ?? '';
    expect(card).toMatch(/older than this window/); // the subtitle really is there…
    expect(proseText()).not.toMatch(/older than this window/); // …and really is excluded.
    // And the headline claim carries the scope on its own.
    const headline = proseText().split(/(?<=\.)\s*/)[0];
    expect(headline).toMatch(/classified against a revoked key/);
    expect(headline).toMatch(/this window/);
  });

  it('checked-clean never states a DEPLOYMENT-level clean', () => {
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    // "this deployment reports the check as enabled" is fine — that IS about
    // the deployment. What must not appear is a claim that the deployment is
    // clean, which no window-scoped counter can support.
    expect(text).not.toMatch(/nothing is revoked/i);
    expect(text).not.toMatch(/no(thing)? .{0,30}revoked .{0,20}deployment/i);
    // Both of the above require the exact words adjacent. Round 6's gate
    // appended "Nothing in the estate is revoked." and both stayed green.
    expect(text).not.toMatch(/nothing\b[^.]{0,40}\bis revoked/i);
    assertNoUnscopedUniversal(text);
  });

  it('disabled: states the fact, without the hedge that made it false', () => {
    renderWith(
      overview({ keyRevocation: CLEAN, features: { ...FEATURES, keyRevocationCheck: false } }),
    );
    const text = revocationCard().textContent ?? '';
    expect(text).toContain('Revocation checking is switched off on this deployment');
    // The distinction the whole issue turns on: no figures SENT is not the
    // same as nothing FOUND.
    expect(text).toMatch(/not the same as having looked and found nothing/i);
    expect(text).not.toContain(HEDGE);
  });

  it('pins the explanatory tails no other assertion covers', () => {
    // Round 3's non-blocking B: five sentences could each be deleted with the
    // whole suite green. None of the deletions creates a FALSE claim — they are
    // explanatory tails — but one of them is load-bearing in a different way:
    // `flag-on-no-counters`' "no cause is offered beyond that" is the sentence
    // that STATES THE RESTRAINT, and this arm exists precisely because an
    // earlier version invented a cause. A guard that lets the restraint be
    // deleted silently is guarding the wrong half.
    renderWith(
      overview({
        keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 },
        features: { ...FEATURES, keyRevocationCheck: true },
      }),
    );
    const clean = proseText();
    expect(clean).toMatch(/a longer window may also show figures/i);
    cleanup();

    renderWith(overview({ keyRevocation: undefined, features: { ...FEATURES, keyRevocationCheck: true } }));
    const noCounters = proseText();
    expect(noCounters).toMatch(/same setting upstream/i);
    expect(noCounters).toMatch(/no cause is offered beyond that/i);
    cleanup();

    // `flag-unreadable`: NOT the "not a value this console can read" sentence —
    // that is already asserted elsewhere in this file, so pinning it here
    // duplicated a guard while leaving the arm's actual uncovered tail free to
    // be deleted. This is that tail.
    renderWith(overview({ keyRevocation: undefined, features: { ...FEATURES, keyRevocationCheck: 'yes' } as never }));
    expect(proseText()).toMatch(/whether anything was measured is exactly what could not be established/i);
    cleanup();

    // `no-flags` — the arm this test skipped for two rounds while being
    // extended to each of its neighbours in turn. Both of its explanatory
    // tails were freely deletable, and neither was a claim that turned false
    // when deleted.
    //
    // ROUND 9 replaced both. The old tails ("this is a statement about the
    // selected window, not about the deployment", "a different window may well
    // show figures") belonged to a headline that asserted what the window
    // contained — and that headline was the over-claim: this arm is licensed
    // by a `features` ABSENCE and is reached with no counters at all. The
    // tails that matter now are the two that say what could not be
    // established, which is what distinguishes this arm from `disabled`.
    renderWith(overview({ keyRevocation: CLEAN, features: undefined }));
    const noFlags = proseText();
    expect(noFlags).toMatch(/a backend that predates the feature report, or a payload that was not one/i);
    expect(noFlags).toMatch(/whether anything in this window was classified is exactly what could not be established/i);
    // The claim it may NOT make, stated as a negative because this is the
    // sentence that was there: the arm holds no counters, so it may not report
    // on them.
    expect(noFlags).not.toMatch(/carried a revocation classification/i);
  });

  it('GUARDS THE GUARD: proseText throws on the arm that renders no paragraph', () => {
    // `proseText()` is the scoping mechanism the three window tests depend on,
    // and its `throw` shipped with nothing exercising it: reverting it to
    // `return p?.textContent ?? ''` left the suite green. An empty string
    // satisfies every `not.toMatch` in this file silently, so that revert would
    // turn a whole class of assertions into no-ops without a single red test.
    renderWith(overview({ keyRevocation: SOME, features: FEATURES }));
    expect(() => proseText()).toThrow(/no <p> in the revocation card/);
  });

  it('disabled: pins the CAUSE it gives, not merely the cause it withholds', () => {
    // The headline new sentence was unpinned in the positive direction:
    // rewriting the cause entirely left the suite green, because the only
    // assertions over it were its tail and a negative. A negative assertion
    // excludes one wrong answer; it does not pin the right one.
    renderWith(
      overview({ keyRevocation: CLEAN, features: { ...FEATURES, keyRevocationCheck: false } }),
    );
    const text = proseText();
    expect(text).toMatch(/a zero produced while the check is off is not a finding/i);
    // And it must NOT claim the control plane withheld the count — on this very
    // payload the counters are present and the console is holding them.
    expect(text).not.toMatch(/stops sending|sends none|no figures are sent/i);
  });

  it('checked-clean: says a later revocation fact DOES amend sealed events', () => {
    // Round 4's second blocking finding. The arm used to say "enabling it does
    // not re-classify them", which is false: upstream re-audits known-revoked
    // fingerprints every pass and amends already-sealed rows in place
    // (RFC-ACDP-0014 §7). The sentence was true only for events whose key was
    // never revoked — i.e. false for exactly the events that would break the
    // clean claim it was caveating. It also contradicted this same card's
    // subtitle, which presupposes amendment happens.
    renderWith(
      overview({
        keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 },
        features: { ...FEATURES, keyRevocationCheck: true },
      }),
    );
    const text = proseText();
    expect(text).toMatch(/re-audits and amends already-sealed events in place/i);
    expect(text).toMatch(/does not update the audit timestamp/i);
    expect(text).not.toMatch(/does not re-classify them/i);
    // The CONSEQUENT, pinned in the positive direction — the half the change
    // that added it called "the part that matters for this tile", and the half
    // that was free. Round 5's gate rewrote it to "moves these figures wherever
    // the amended event sits" — the opposite claim, and false: `checked_at` is
    // what this window filters on, so an amendment to an event that has already
    // scrolled out of the window cannot move these figures at all. Deleting the
    // clause was tested; rewriting it was not, which is the same "unpinned in
    // the positive direction" gap the `disabled` cause had one round earlier.
    expect(text).toMatch(
      /moves these figures only where the amended event already sits inside this window/i,
    );
  });

  it('a counter object with no counters in it does not become a clean window', () => {
    // Round 6's NB3. `{}` is truthy, so `!keyRevocation` let it through to
    // `checked-clean`, whose copy states "this window's counters are zero" —
    // a figure asserted from a payload that sent none. The `reported` guard
    // above it declined silently (`undefined > 0` is false), which is exactly
    // how it got to an arm that asserts a value.
    //
    // Upstream always builds all three with `?? 0`, so this is not a shape a
    // correct control plane sends. Neither was `features: null` (round 2) or
    // `features: []` (round 3), and both reached this function off the network
    // and produced a false claim. A state the backend cannot reach must not be
    // asserted from this side.
    renderWith(overview({ keyRevocation: {} as never, features: FEATURES }));
    const text = proseText();
    expect(text).not.toMatch(/counters are zero/i);
    expect(text).not.toMatch(/nothing in this window is classified against a revoked key/i);
    expect(text).toMatch(/does not add up/i);
    expect(revocationCard().querySelectorAll('.kpi-value')).toHaveLength(0);
  });

  it('DISCRIMINATES: a COMPLETE all-zero triple is still checked-clean', () => {
    // The pair. Without it, the guard above could be satisfied by routing every
    // zero payload to `unknown` — which would delete the state #97 added.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    expect(proseText()).toMatch(/counters are zero/i);
  });

  // ── A PARTIAL triple ────────────────────────────────────────────────
  //
  // This test used to render exactly the payload below and assert only
  // `/does not add up/i`, which passed — and walked straight past the sentence
  // underneath it, which read "It reports the compromise-boundary check as
  // enabled, yet sent no counters at all — not even zeros" over a payload that
  // had sent a counter, and a zero at that. Worse, that sentence was pinned
  // POSITIVELY elsewhere in this file, so the suite enforced the false claim.
  //
  // The lesson is in the assertion style, not the routing: a test that checks
  // one phrase of a paragraph vouches for one phrase of a paragraph. These
  // assert the whole arm and, in the sibling below, that the sentence written
  // for a DIFFERENT payload is not on screen.

  it('a PARTIAL triple gets its own arm — it did not "send no counters"', () => {
    renderWith(overview({ keyRevocation: { preCompromise: 0 } as never, features: FEATURES }));
    const text = proseText();
    expect(text).toMatch(/counters arrived incomplete/i);
    expect(text).toMatch(/no denominator/i);
    // The sentence this payload used to be given, which it refutes by existing.
    expect(text).not.toMatch(/no counters at all/i);
    expect(text).not.toMatch(/not even zeros/i);
  });

  it('a partial triple with a NON-ZERO member still renders no figures', () => {
    // The half that matters most. `{ revokedAtOrAfter: 3 }` passed the
    // `reported` guard — `undefined > 0` is false, but the guard was a
    // disjunction and the third test passed — so the tile rendered
    // `['0', '3', '0']`: a green "Pre-compromise (authorized) 0" and an amber
    // "Revoked time unverifiable 0" from a payload that sent neither, beside
    // one real figure, with nothing on screen to tell them apart.
    renderWith(overview({ keyRevocation: { revokedAtOrAfter: 3 } as never, features: FEATURES }));
    const card = revocationCard();
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(card.textContent).toMatch(/counters arrived incomplete/i);
  });

  it('DISCRIMINATES: the COMPLETE triple with the same non-zero member does report', () => {
    // Without this, gating `reported` on the full triple could be satisfied by
    // never reporting at all.
    renderWith(
      overview({
        keyRevocation: { preCompromise: 0, revokedAtOrAfter: 3, revokedTimeUnverifiable: 0 },
        features: FEATURES,
      }),
    );
    const values = [...revocationCard().querySelectorAll('.kpi-value')].map((v) => v.textContent);
    expect(values).toEqual(['0', '3', '0']);
  });

  it('a partial triple is read BEFORE the flags, so no flag arm claims it', () => {
    // The arm is a fact about the payload, and it falsifies the copy on every
    // flag-derived arm: `no-flags` says "nothing in this window carried a
    // revocation classification", which a payload reporting three revoked
    // events plainly contradicts. Reached here with each of the four flag
    // states, all of which must produce the same reading.
    for (const features of [
      undefined,
      null as never,
      { ...FEATURES, keyRevocationCheck: false },
      { ...FEATURES, keyRevocationCheck: 'yes' as never },
    ]) {
      cleanup();
      renderWith(overview({ keyRevocation: { revokedAtOrAfter: 3 } as never, features }));
      const text = proseText();
      expect(text, `flags=${JSON.stringify(features)}`).toMatch(/counters arrived incomplete/i);
      expect(text, `flags=${JSON.stringify(features)}`).not.toMatch(
        /nothing in this window carried/i,
      );
    }
  });

  it('`{}` is NOT partial — it really did send no counters', () => {
    // The boundary. `{}` carries no member of the triple, so "sent no counters
    // at all, not even zeros" is true of it and it keeps that arm. Collapsing
    // the two would make the new arm's copy ("some came through and some did
    // not") false in its turn — the same mistake facing the other way.
    renderWith(overview({ keyRevocation: {} as never, features: FEATURES }));
    const text = proseText();
    expect(text).toMatch(/no counters at all/i);
    expect(text).not.toMatch(/counters arrived incomplete/i);
  });

  it('the array payload reaches no-flags, not a claim that a report arrived', () => {
    // `typeof [] === 'object'`, so without the explicit array test a `features:
    // []` passes the object guard and renders "It sent a feature report" — a
    // claim about something that is not a feature report. The guard was added
    // with no test; deleting it left the whole suite green.
    renderWith(overview({ keyRevocation: undefined, features: [] as never }));
    const text = proseText();
    expect(text).not.toMatch(/sent a feature report/i);
    expect(text).toContain(HEDGE);
  });

  it('disabled: does NOT claim nothing was measured over this window', () => {
    // Round 3's fourth finding. The console knows the check is off NOW. It does
    // not know the check was off for the whole window: upstream gates both the
    // query and the tile on the same config value, so switching the check off
    // nulls the tile regardless of what was classified earlier in that window,
    // while the persisted `key_revocation_status` rows are untouched. A
    // deployment that ran the check over the first half of the window and
    // disabled it yesterday was rendering "nothing was measured" — false.
    //
    // This is the same conflation of UNMONITORED with CLEAN that #97 exists to
    // remove, running in the opposite direction, so it is asserted as an
    // absence rather than left to the positive wording above.
    renderWith(
      overview({ keyRevocation: CLEAN, features: { ...FEATURES, keyRevocationCheck: false } }),
    );
    // Read off the PARAGRAPH. The sibling test three lines below already uses
    // `proseText()`; reading the whole card here is the same scoping mistake
    // this commit series fixed twice, and it is not vacuous only by luck —
    // the subtitle happens to contain neither string.
    const text = proseText();
    expect(text).not.toMatch(/nothing was measured/i);
    expect(text).not.toMatch(/never been checked|has not been checked/i);
    // …and it says so positively: the limit of what this view can tell.
    expect(text).toMatch(/cannot tell you .* whether the check was running earlier/i);
  });

  it('disabled: scopes \u201cnothing will be classified\u201d to NEW classification only', () => {
    // Round 2's fifth finding: this arm's body was unpinned in both directions
    // — deleting the retroactivity sentence and reverting to the over-claiming
    // version it replaced both left the suite green.
    //
    // Classification happens at AUDIT TIME. Switching the check off stops new
    // events being classified; it does not un-classify what an earlier window
    // already recorded. “No window will show figures until it is enabled” —
    // the wording this replaced — asserts the opposite, and would have an
    // operator read a historical window's real figures as impossible.
    renderWith(
      overview({ keyRevocation: CLEAN, features: { ...FEATURES, keyRevocationCheck: false } }),
    );
    const text = proseText();
    expect(text).toMatch(/nothing new will be classified/i);
    // Retroactivity, now stated for THIS window too rather than only an
    // earlier one — the narrower wording was what let the arm go on implying
    // that nothing in the current window could have been measured.
    expect(text).toMatch(/anything already recorded stays recorded/i);
    expect(text).toMatch(/in this window as much as an earlier one/i);
    expect(text).toMatch(/classification happens at audit time/i);
    // The over-claim, explicitly absent: no sentence may say that no window can
    // show figures while the check is off.
    expect(text).not.toMatch(/no window will show figures/i);
    expect(text).not.toMatch(/no figures .{0,40}until it is enabled/i);
  });

  it('disabled: reached by a null payload too, which is what upstream actually sends', () => {
    // `dashboard.service.ts:240` emits literal `null` when the check is off.
    renderWith(overview({ keyRevocation: null, features: { ...FEATURES, keyRevocationCheck: false } }));
    expect(revocationCard().textContent).toContain('Revocation checking is switched off');
  });

  it('unknown: and ONLY unknown keeps the hedge', () => {
    // The pre-#178 backend. Here "the check is disabled by default" is still
    // true and still load-bearing, because we genuinely cannot tell whether it
    // ran. The three tests above assert the phrase absent; this one asserts it
    // present, so the pair cannot both be satisfied by deleting the phrase.
    renderWith(overview({ keyRevocation: CLEAN, features: undefined }));
    expect(revocationCard().textContent).toContain(HEDGE);
  });

  it('EVERY rendering is DISTINGUISHABLE text', () => {
    // Four kinds, more renderings: `unknown` splits on `because`, and the whole
    // point of that split is that each reads differently — each says only what
    // holds on its own route. Without this, arms could collapse onto one
    // paragraph and every test above would still pass in isolation.
    //
    // The title carried the number "SIX" until round 9. It was wrong from the
    // commit that added the fourth `because`, while the assertion beneath it
    // was already `toBe(ARM_PAYLOADS.length)` and therefore right — a title
    // stating a total the code below derives is a second source of truth that
    // can only go stale. It is derived here too.
    const texts: string[] = [];
    for (const [k, f] of ARM_PAYLOADS) {
      renderWith(overview({ keyRevocation: k, features: f }));
      texts.push(revocationCard().textContent ?? '');
      cleanup();
    }
    expect(new Set(texts).size).toBe(ARM_PAYLOADS.length);
    // Every arm, not just the two that had a dedicated guard. The over-claims
    // round 6's gate inserted were each aimed at one arm, and four of the six
    // had nothing watching them at all — a claim that reaches past this card's
    // evidence is wrong on whichever arm it is written into.
    //
    // NOTE ON WHAT DOES THE WORK HERE. This loop is a secondary signal, not the
    // guarantee — see `assertNoUnscopedUniversal`'s docblock. The guarantee is
    // the exact-text pin in the test below, which closes the set of sentences
    // these arms can emit. Round 7 appended four different unscoped universals
    // to `checked-clean` and this loop passed all four.
    for (const t of texts) assertNoUnscopedUniversal(t);
  });

  // ══════════════════════════════════════════════════════════════════
  // THE CLOSED-WORLD PIN. This is the guard; everything else about this
  // card's copy is a readable early warning in front of it.
  //
  // Seven gate rounds defeated seven successive enumerations of forbidden
  // phrasings — the last of them twelve times in one round, by paraphrase
  // alone. "Does this English sentence claim more than the evidence licenses"
  // is an open-world question and a pattern list cannot answer it.
  //
  // So the set of sentences is closed instead. Each arm may render exactly the
  // text pinned in `test/support/revocation-prose.ts` and nothing else. A
  // paraphrase has nothing to evade: any text that is not byte-identical fails,
  // whatever it says. The review moves to that file, where each entry sits
  // beside the evidence that licenses it.
  // ══════════════════════════════════════════════════════════════════
  // SUBSUMED by `pins every block of every prose arm` (round 9), which reads
  // the same paragraph as one of its blocks. Kept as the fast, readable signal
  // — it names the arm that drifted, where a block-list diff reports an array —
  // and NOT as the guarantee. Loosening its `toBe` to `toContain` is green,
  // because the whole-card pin catches the same append; that is a fact about
  // this assertion's redundancy, not about the card being unguarded.
  it('every prose arm renders EXACTLY its pinned text, and no arm is unpinned', () => {
    const seen = new Set<ProseKey>();
    for (const [k, f] of ARM_PAYLOADS) {
      const key = proseKeyFor(dashboardRevocationState(k, f));
      renderWith(overview({ keyRevocation: k, features: f }));
      if (key === null) {
        // `reported` renders figures and no paragraph at all.
        expect(revocationCard().querySelector('p')).toBeNull();
        expect(revocationCard().querySelectorAll('.kpi-value').length).toBeGreaterThan(0);
        cleanup();
        continue;
      }
      seen.add(key);
      expect(proseText(), `arm \`${key}\` drifted from its pinned text`).toBe(
        fullProse(DASHBOARD_PROSE[key]),
      );
      cleanup();
    }
    // …and the payload list reaches every pinned arm. Without this, dropping a
    // payload from `ARM_PAYLOADS` would silently stop checking an arm while
    // every assertion above still passed.
    expect([...seen].sort()).toEqual((Object.keys(DASHBOARD_PROSE) as ProseKey[]).sort());
  });

  it('the pinned entries are distinct, so the table cannot collapse onto one sentence', () => {
    // The anti-vacuity half. A table whose six entries were the same string
    // would satisfy the test above on a card that rendered one paragraph for
    // every state — which is the defect round 2 found, with the pin reversed.
    const all = Object.values(DASHBOARD_PROSE);
    expect(new Set(all.map(fullProse)).size).toBe(all.length);
    expect(new Set(all.map((e) => e.headline)).size).toBe(all.length);
    // Every entry states what licenses it. An empty one is an entry nobody
    // argued for.
    for (const [key, e] of Object.entries(DASHBOARD_PROSE)) {
      expect(e.licensedBy.length, `\`${key}\` has no stated licence`).toBeGreaterThan(80);
    }
  });

  it('a non-zero count is REPORTED even when the flag says the check is off', () => {
    // Self-evidencing. A count means the check ran and found that, whatever the
    // deployment claims about itself — and rendering "switched off" over live
    // figures would be the worse error of the two.
    renderWith(overview({ keyRevocation: SOME, features: { ...FEATURES, keyRevocationCheck: false } }));
    expect([...revocationCard().querySelectorAll('.kpi-value')].map((v) => v.textContent)).toEqual(['9', '0', '0']);
  });

  it('a null payload with the check ENABLED is unknown, not clean — and is NOT explained as disabled', () => {
    // Upstream cannot produce this — both derive from one config value — so it
    // means something is wrong, and a clean estate must not be asserted from a
    // contradiction.
    //
    // The hedge assertion here used to be `toContain(HEDGE)`, which PINNED the
    // defect the gate found: the console holds `keyRevocationCheck === true`
    // and rendered "the check is disabled by default" over it — stating a
    // cause it has direct evidence against, which is the exact sentence #97
    // exists to delete. The `because` discriminator is what lets this arm
    // decline to explain itself.
    renderWith(overview({ keyRevocation: null, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).not.toContain(HEDGE);
    expect(text).not.toMatch(/disabled|switched off/i);
    expect(text).not.toContain('classified against a revoked key');
    expect(text).toMatch(/does not add up/i);
    // And it states the two facts it actually holds on THIS route, both of
    // which are false on the unreadable-flag route below.
    expect(text).toMatch(/reports the compromise-boundary check as enabled/i);
    expect(text).toMatch(/no counters at all/i);
  });

  it('an UNREADABLE flag says only that, and states nothing about the counters', () => {
    // Round 2's first finding. This route and the one above shared a rendering,
    // and the shared copy — "It says the compromise-boundary check is enabled
    // but sent no counters at all — not even zeros" — is false HERE on both
    // halves: nothing readable said the check is enabled, and the counters
    // arrived, as zeros. Stating one route's cause over another's is the same
    // defect the `because` split was introduced to remove, one level down.
    const stringy = { ...FEATURES, keyRevocationCheck: 'true' } as unknown as typeof FEATURES;
    renderWith(overview({ keyRevocation: CLEAN, features: stringy }));
    const text = revocationCard().textContent ?? '';
    // A features object DID arrive, so the pre-#178 hedge is not ours to reach.
    expect(text).not.toContain(HEDGE);
    // It must not claim the deployment reports the check as enabled…
    expect(text).not.toMatch(/reports the compromise-boundary check as enabled/i);
    expect(text).not.toMatch(/does not add up/i);
    // …nor that no counters arrived, when zeros did.
    expect(text).not.toMatch(/no counters at all|not even zeros/i);
    // …nor that the check is off.
    expect(text).not.toMatch(/switched off|disabled/i);
    // What it may say, and does: the flag could not be read.
    expect(text).toMatch(/did not say whether revocation checking is running/i);
    expect(text).toMatch(/not a value this console can read as on or off/i);
  });

  it('the SAME unreadable flag with the counters absent renders identically', () => {
    // The route is about the flag, so it must not fork on the counters — if it
    // did, one of the two renderings would be making a claim about them.
    const stringy = { ...FEATURES, keyRevocationCheck: 'true' } as unknown as typeof FEATURES;
    renderWith(overview({ keyRevocation: CLEAN, features: stringy }));
    const withZeros = proseText();
    cleanup();
    renderWith(overview({ keyRevocation: null, features: stringy }));
    expect(proseText()).toBe(withZeros);
  });

  it('a null `features` renders the pre-#178 arm instead of crashing the route', () => {
    // Round 2's fourth finding: `features === undefined` is false for `null`,
    // and the next line dereferenced it — taking down the whole `/dashboard`
    // render tree, which calls this inline.
    const nully = null as unknown as typeof FEATURES;
    expect(() => renderWith(overview({ keyRevocation: CLEAN, features: nully }))).not.toThrow();
    const text = revocationCard().textContent ?? '';
    // Nothing arrived that says anything about the check, so this is the one
    // place the legacy hedge is still fair.
    expect(text).toContain(HEDGE);
  });
});

describe('dashboard — Recent Runs', () => {
  it('shows no count when the window has no runs, rather than "Most recent 0"', () => {
    // The table already has its own "No runs yet" empty state; a count beside
    // it would be a header contradicting the body.
    renderWith(overview({ recentRuns: [] }));
    expect(screen.queryByText(/Most recent/)).toBeNull();
  });

  it('DISCRIMINATES: it does show the count when there are runs', () => {
    renderWith(overview({ recentRuns: [{ runId: 'r1' }] as unknown as CpDashboardOverview['recentRuns'] }));
    expect(screen.getByText('Most recent 1')).toBeInTheDocument();
  });
});

describe('dashboard — the window is selectable', () => {
  it('offers exactly the windows the control plane accepts', () => {
    renderWith(overview());
    const picker = screen.getByLabelText('Dashboard time window') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['1h', '6h', '24h', '7d', '30d']);
  });

  it('is reachable on the error path too, so a failed window is recoverable', () => {
    useDashboard.mockReturnValue({ isLoading: false, error: new Error('boom'), data: undefined });
    render(<DashboardPage />);
    expect(screen.getByLabelText('Dashboard time window')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The KPI row, and the health claim that used to sit under it (#100).
//
// `<KpiCard label="Registries" … delta="● all healthy" />` was a LITERAL. It had
// no input, so it was true of every dataset, every deployment and every outage —
// including the one #100 describes, a control plane whose database is gone,
// where this page's own data comes from the service that is down.
//
// Wiring it to a probe was rejected rather than deferred. The figure above the
// caption is `byRegistry.length`, an event count, so health is not what the tile
// is about; and demo mode — the default — returns `{ ok: true }` from
// `pingHealth` unconditionally, so a wired delta would render the identical
// sentence forever with a probe's authority behind it.
//
// Paired assertions, per this file's convention: the absence test cannot pass by
// the page failing to render, because its sibling demands the surviving delta
// and the tile's own figure.
// ══════════════════════════════════════════════════════════════════════
describe('the KPI row makes no health claim', () => {
  it('renders no "all healthy" caption anywhere on the page', () => {
    renderWith(overview());
    expect(screen.queryByText(/all healthy/i)).toBeNull();
    // Not just the exact literal — any restored variant of the claim, but
    // scoped to the KPI ROW rather than the page. A page-wide `/healthy/i`
    // would trip on any future legitimate use of the word anywhere on
    // `/dashboard`, which is a guard that eventually gets deleted rather than
    // understood.
    const row = screen.getByText('Registries').closest('.kpi-grid') as HTMLElement;
    expect(row.textContent).not.toMatch(/healthy/i);
  });

  it('still renders the Registries tile and its count', () => {
    // The sibling. Deleting the tile, or the page throwing, would satisfy the
    // assertion above; this is what makes it mean something.
    renderWith(overview({ byRegistry: [
      { registry_authority: 'registry-a.playground.local', event_count: 9 },
      { registry_authority: 'registry-b.playground.local', event_count: 4 },
    ] }));
    const tile = screen.getByText('Registries').closest('.kpi-card') as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.textContent).toContain('2');
    expect(tile.querySelector('.kpi-delta')).toBeNull();
  });

  it('leaves the one other delta on that row intact', () => {
    // Only `Total Runs` has a delta — `window 24h`, `deltaTone="muted"`.
    // `Contexts Published` and `Active Agents` never had one, so "the other
    // three still render theirs" would have been an assertion about two cards
    // that have nothing to render.
    renderWith(overview({ window: '24h' }));
    const runs = screen.getByText('Total Runs').closest('.kpi-card') as HTMLElement;
    expect(runs.querySelector('.kpi-delta')?.textContent).toBe('window 24h');
    for (const label of ['Contexts Published', 'Active Agents']) {
      const tile = screen.getByText(label).closest('.kpi-card') as HTMLElement;
      expect(tile.querySelector('.kpi-delta')).toBeNull();
    }
  });

  // REMOVED: a `expect(src).toContain('{delta && (')` assertion on
  // `kpi-card.tsx`'s source text. It broke on a harmless reformat while adding
  // nothing — "the fix is the removal of one prop at one call site" is already
  // established by the two tests above, which show `Total Runs` still rendering
  // its delta (so the component was not broken) and the other tiles rendering
  // none (so the prop really is gone). Asserting on a component's source
  // spelling to prove a caller changed is the wrong instrument.
});

// ══════════════════════════════════════════════════════════════════════
// THE WHOLE CARD, not just its paragraph (round 9).
//
// The paragraph pin above is real and holds. Its docblock claimed the card
// header, the subtitle and the KPI captions were "pinned by their own
// assertions in the test files". They were not pinned by anything, and the
// gate proved it with mutations that each left the whole suite green:
//
//   · `· this estate is clean` appended to the card subtitle
//   · round 7's verbatim escape sentence — "no key in this deployment has been
//     revoked" — appended to the Pre-compromise caption, i.e. printed directly
//     under the figures, on the one arm that renders figures at all
//   · the caption `Revoked time unverifiable` rewritten to `Revoked time
//     verified clean`, inverting the meaning of an amber fail-closed tile
//   · the fail-closed tile repainted `var(--success)`
//
// Every one of those sits an inch from the pin and outside it. So the pin's
// scope moves to the whole card: title, subtitle, and every block the body
// renders, equal to an enumerated list in order, with nothing outside it.
//
// Two halves, and both are needed. The list equality catches a changed or
// missing block; the squashed whole-card comparison catches text added
// somewhere the block selectors do not look, which is how the sharpest of the
// twelve escapes was written on the sibling surface (a new `<p>` beside an
// empty state).
// ══════════════════════════════════════════════════════════════════════
describe('dashboard — the Key Revocation card renders a CLOSED set of blocks', () => {
  /**
   * The card's text, block by block: heading, subtitle, then either the three
   * KPI tiles or the prose paragraph.
   *
   * Read as a LIST so order and count are pinned with the wording. Reading the
   * card's `textContent` as one string would turn an added caption into a
   * substring change, which is precisely what nobody noticed.
   */
  function cardBlocks(card: HTMLElement): string[] {
    const head = [...card.querySelectorAll<HTMLElement>('.card-header h2, .card-header .card-sub')];
    const body = card.querySelector<HTMLElement>('.card-body');
    expect(body, 'the card renders no .card-body').toBeTruthy();
    const tiles = [...body!.querySelectorAll<HTMLElement>('.kpi-card')];
    const bodyBlocks = tiles.length
      ? tiles
      : [...body!.querySelectorAll<HTMLElement>('p')];
    return [...head, ...bodyBlocks].map((n) => normalize(n.textContent));
  }

  /**
   * Half one: the blocks are exactly these, in order.
   *
   * SPLIT from half two rather than inlined beside it, and the split is not
   * cosmetic. With both halves in one function, a self-test asserting "this
   * helper throws on a bad render" is satisfied by EITHER half throwing — so
   * loosening one is invisible as long as the other still fires. Measured:
   * that is exactly what happened, and turning the block equality into a
   * containment stayed green through a guard-the-guard written that way.
   */
  function expectBlocksPinned(card: HTMLElement, expected: string[], label?: string) {
    expect(cardBlocks(card), label).toEqual(expected);
  }

  /**
   * Half two: there is NOTHING in the card besides those blocks.
   *
   * A bare text node or a `<span>` dropped into the body satisfies half one
   * completely and is the obvious way to add an unreviewed sentence.
   */
  function expectNothingOutside(card: HTMLElement, expected: string[], label?: string) {
    expect(squash(card.textContent), `${label ?? ''} — text outside the pinned blocks`).toBe(
      squash(expected.join('')),
    );
  }

  /**
   * Half three: nothing is ANNOUNCED that was not written down.
   *
   * ROUND 9. `textContent` cannot see an attribute, and a text-free
   * `<div title="No key in this deployment has been revoked."
   * aria-label="Nothing in this deployment is revoked" />` inside this very
   * card's body passed both halves above and the whole 1028-test suite.
   * `CLAUDE.md` already treats a hover-only disclosure as no disclosure —
   * which is an argument for not shipping the tooltip, not for leaving the
   * channel unread, since `aria-label` on the same node reaches a screen
   * reader in earnest.
   *
   * Set EQUALITY, so a LOST announcement fails too. `KpiCard` mirrors its
   * `hint` into `title`, so the legitimate set is exactly the captions the
   * reported arm renders; every other arm announces nothing at all.
   */
  function announcedIn(el: HTMLElement): string[] {
    const found: string[] = [];
    for (const node of [el, ...el.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of ANNOUNCED_TEXT_ATTRS) {
        const v = node.getAttribute(attr);
        if (v !== null && v !== '') found.push(normalize(v));
      }
    }
    return found;
  }

  function expectNothingAnnounced(card: HTMLElement, allowed: readonly string[], label?: string) {
    expect(new Set(announcedIn(card)), `${label ?? ''} — announced copy outside the pinned set`).toEqual(
      new Set(allowed.map(normalize)),
    );
    for (const node of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-details']) {
        for (const id of (node.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
          expect(
            card.querySelector(`#${CSS.escape(id)}`),
            `${attr}="${id}" points outside the pinned card`,
          ).toBeTruthy();
        }
      }
    }
  }

  function expectPinnedCard(expected: string[], label?: string, announced: readonly string[] = []) {
    const card = revocationCard();
    expectBlocksPinned(card, expected, label);
    expectNothingOutside(card, expected, label);
    expectNothingAnnounced(card, announced, label);
  }

  it('pins every block of every prose arm, and nothing else is in the card', () => {
    const seen = new Set<ProseKey>();
    for (const [k, f] of ARM_PAYLOADS) {
      const key = proseKeyFor(dashboardRevocationState(k, f));
      if (key === null) {
        cleanup();
        continue;
      }
      seen.add(key);
      renderWith(overview({ keyRevocation: k, features: f }));
      expectPinnedCard(expectedDashboardCardBlocks({ key }));
      cleanup();
    }
    // Anti-vacuity: the payload table reaches every pinned arm. Without it,
    // dropping a payload silently stops checking an arm.
    expect([...seen].sort()).toEqual((Object.keys(DASHBOARD_PROSE) as ProseKey[]).sort());
  });

  it('pins the reported arm: three labels, three figures, three captions, in order', () => {
    // The arm an operator reads when something has actually been FOUND, and
    // the least-guarded copy on the card before this test existed — the three
    // captions beside the figures had no positive assertion anywhere.
    renderWith(
      overview({
        keyRevocation: { preCompromise: 9, revokedAtOrAfter: 2, revokedTimeUnverifiable: 1 },
        features: FEATURES,
      }),
    );
    expectPinnedCard(
      expectedDashboardCardBlocks({ key: null, counts: ['9', '2', '1'] }),
      'reported arm',
      // `KpiCard` mirrors each `hint` into a `title`, so the three captions are
      // also the three tooltips — and nothing else may be.
      DASHBOARD_REPORTED_TILES.map((t) => t.hint),
    );
  });

  it('pins the reported arm’s ACCENTS, because colour carries meaning on this card', () => {
    // `lib/utils/revocation.ts` argues the point: pre-compromise is
    // "historically AUTHORIZED — the opposite of a violation", and this tile
    // says so in success green while the one beside it fails closed in red.
    // Repainting the fail-closed tile `var(--success)` was green in the suite.
    renderWith(
      overview({
        keyRevocation: { preCompromise: 9, revokedAtOrAfter: 2, revokedTimeUnverifiable: 1 },
        features: FEATURES,
      }),
    );
    const accents = [...revocationCard().querySelectorAll<HTMLElement>('.kpi-card')].map((t) =>
      t.style.getPropertyValue('--kpi-accent'),
    );
    expect(accents).toEqual(DASHBOARD_REPORTED_TILES.map((t) => t.accent));
    // The complement, so "paint everything danger" cannot pass either.
    expect(new Set(accents).size, 'two tiles share an accent').toBe(accents.length);
  });

  it('GUARDS THE GUARD: the announced half catches copy no textContent pin sees', () => {
    // The round-9 escape, exactly. A text-free node carrying the claim in two
    // attributes: invisible to the block list, invisible to the squash
    // comparison, visible to a screen reader and to a hover.
    cleanup();
    renderWith(overview({ keyRevocation: null, features: FEATURES }));
    const card = revocationCard();
    const expected = expectedDashboardCardBlocks({ key: 'flag-on-no-counters' });
    expectBlocksPinned(card, expected);
    expectNothingOutside(card, expected);
    expectNothingAnnounced(card, []);

    const ghost = document.createElement('div');
    ghost.setAttribute('title', 'No key in this deployment has been revoked.');
    ghost.setAttribute('aria-label', 'Nothing in this deployment is revoked');
    card.querySelector('.card-body')!.appendChild(ghost);

    // The half that sees it…
    expect(() => expectNothingAnnounced(card, [])).toThrow();
    // …and the two that do not, which is why there are three.
    expect(() => expectBlocksPinned(card, expected)).not.toThrow();
    expect(() => expectNothingOutside(card, expected)).not.toThrow();
  });

  it('GUARDS THE GUARD: the announced half catches a LOST announcement too', () => {
    // Set equality in both directions. The reported arm's three captions are
    // also its three tooltips; dropping one is a caption that stopped being
    // announced, which no "none of the forbidden values" check can see.
    cleanup();
    renderWith(
      overview({
        keyRevocation: { preCompromise: 9, revokedAtOrAfter: 2, revokedTimeUnverifiable: 1 },
        features: FEATURES,
      }),
    );
    const card = revocationCard();
    const allowed = DASHBOARD_REPORTED_TILES.map((t) => t.hint);
    expectNothingAnnounced(card, allowed);
    (card.querySelector('[title]') as HTMLElement).removeAttribute('title');
    expect(() => expectNothingAnnounced(card, allowed)).toThrow();
  });

  it('GUARDS THE GUARD: the pin REJECTS an appended clause and a stray element', () => {
    // Both halves of `expectPinnedCard`, exercised against states that must
    // fail — because loosening either is silent otherwise. Measured: turning
    // the block equality into a containment, and replacing the squash
    // comparison with a truthiness check, each left the whole suite green.
    //
    // The subject here is the HELPER, not two literals: a test that compares
    // two hand-written arrays proves something about `toEqual`, not about the
    // assertion the pin actually makes.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const key: ProseKey = 'checked-clean';

    // It passes as rendered…
    expectPinnedCard(expectedDashboardCardBlocks({ key }));

    // …rejects a block list differing by one appended clause, in the direction
    // the escape actually runs: extra text in what the CARD renders, not in
    // what the test expects. A test that appends to the expected list proves
    // only that `toEqual` distinguishes two arrays; it passes unchanged when
    // the assertion is loosened to admit appends, which is the loosening being
    // guarded against.
    //
    // A `<p>`, because `cardBlocks` reads `p` on the prose arms — so this
    // lands INSIDE the block list and is caught by its equality. It is the
    // exact shape of the sharpest escape found on the sibling surface: a new
    // paragraph beside an existing one.
    const extraBlock = document.createElement('p');
    extraBlock.textContent = 'No key in this deployment has been revoked.';
    revocationCard().querySelector('.card-body')!.appendChild(extraBlock);
    expect(() =>
      expectBlocksPinned(revocationCard(), expectedDashboardCardBlocks({ key })),
    ).toThrow();
    extraBlock.remove();

    // …and the OTHER half rejects text added outside the elements the block
    // selectors read, which a block-list equality cannot see at all.
    //
    // Each half is exercised ALONE. Calling the combined helper would let
    // either one's throw satisfy the assertion, so a loosening of one stays
    // green while the other covers for it — which is how the first version of
    // this guard-the-guard passed over a loosened block equality.
    const stray = document.createElement('span');
    stray.textContent = 'The entire fleet is clean.';
    revocationCard().querySelector('.card-body')!.appendChild(stray);
    expect(() =>
      expectNothingOutside(revocationCard(), expectedDashboardCardBlocks({ key })),
    ).toThrow();

    // And the normalisers really normalise rather than returning their input —
    // an identity `squash` makes the second half compare two equal strings
    // whatever the card holds.
    expect(squash('a b\n c')).toBe('abc');
    expect(normalize('a  b\n c')).toBe('a b c');
  });

  it('GUARDS THE GUARD: the demoted lint still rejects something', () => {
    // `assertNoUnscopedUniversal` is a lint in front of the pin, by its own
    // docblock. A lint that has been quietly emptied is worse than no lint:
    // it reads as cover. Turning its body into a no-op left the whole suite
    // green, because every call site passes text that already satisfies it.
    //
    // So it is exercised against a string that must fail and one that must
    // pass. This does NOT make it a proof — it cannot read English, and the
    // pin above is the guarantee — it only makes "someone emptied it" a red
    // test instead of a silent change.
    expect(() => assertNoUnscopedUniversal('Nothing in the deployment is revoked.')).toThrow();
    expect(() => assertNoUnscopedUniversal('Every event was checked.')).toThrow();
    // …and the ALLOWED denial, which is the exemption that makes the lint
    // untrustworthy on its own and must therefore keep working.
    expect(() =>
      assertNoUnscopedUniversal(
        'It does not follow that every event in the window was checked.',
      ),
    ).not.toThrow();
  });

  it('GUARDS THE GUARD: the pinned tile table is three distinct, non-empty entries', () => {
    // An emptied or collapsed table satisfies the pin against a card that
    // rendered nothing, or the same caption three times.
    expect(DASHBOARD_REPORTED_TILES).toHaveLength(3);
    for (const t of DASHBOARD_REPORTED_TILES) {
      expect(t.label.length, 'an empty tile label').toBeGreaterThan(0);
      expect(t.hint.length, `\`${t.label}\` has no caption`).toBeGreaterThan(20);
    }
    expect(new Set(DASHBOARD_REPORTED_TILES.map((t) => t.hint)).size).toBe(3);
    expect(new Set(DASHBOARD_REPORTED_TILES.map((t) => t.label)).size).toBe(3);
    // The subtitle is not empty either — an emptied `DASHBOARD_CARD.sub` would
    // pin a card that rendered no subtitle at all.
    expect(DASHBOARD_CARD.sub.length).toBeGreaterThan(80);
    expect(DASHBOARD_CARD.title).toBe('Key Revocation');
  });
});
