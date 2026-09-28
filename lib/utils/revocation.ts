// ══════════════════════════════════════════════════════════════════════
// RFC-ACDP-0014 key-revocation verdicts: what counts as a violation.
//
// The control plane packs THREE semantically different verdicts into one
// `revoked[]` array — it filters `key_revocation_status !== 'none'`
// (`receipt-audit.repository.ts`), so "the key was revoked at some point" is
// the membership test, NOT "this event is untrustworthy". Treating the array
// length as a violation count is therefore an over-claim, and it is the defect
// this module exists to prevent recurring:
//
//   pre_compromise             → the receipt-attested `created_at` verifies
//                                strictly BEFORE the compromise boundary.
//                                HISTORICALLY AUTHORIZED — the opposite of a
//                                violation. The dashboard tile already labels
//                                this "(authorized)" in success green.
//   revoked_at_or_after        → signed at or after the boundary. Fail-closed.
//   revoked_time_unverifiable  → the signing time could not be established, so
//                                it cannot be shown to precede the boundary.
//                                Fail-closed per RFC-ACDP-0014 §7: an
//                                unprovable ordering is not an authorization.
//
// Every surface that reports on revocation derives from the helpers here, so
// the definition lives in exactly one place. Three surfaces previously each
// had their own idea of it (or none), which is how a run carrying a live
// `revoked_at_or_after` verdict came to render a green check-mark.
// ══════════════════════════════════════════════════════════════════════
import type { CpDashboardFeatures, DashboardRevocation, RunTrustSummary } from '@/lib/types';

export type RevocationEntry = NonNullable<RunTrustSummary['revoked']>[number];

/**
 * The one status that is NOT a violation. Expressed as an allow-list rather
 * than a fail-closed deny-list on purpose: the upstream column is
 * `varchar(32)` with no CHECK constraint, so a newer control plane can emit a
 * status this console has never heard of. An allow-list makes the unknown case
 * fail CLOSED (counted as a violation) automatically; a deny-list would have
 * made it fail open, silently rendering an unrecognised verdict as authorized.
 */
const AUTHORIZED_STATUSES: ReadonlySet<string> = new Set(['pre_compromise']);

/** Is this verdict a trust violation the operator must act on? */
export function isFailClosed(status: string): boolean {
  return !AUTHORIZED_STATUSES.has(status);
}

/** Is this verdict "valid, but signed under a key that is no longer current"? */
export function isHistoricallyAuthorized(status: string): boolean {
  return AUTHORIZED_STATUSES.has(status);
}

/** Fail-closed entries only — the real violation count. */
export function failClosedEntries(revoked: RevocationEntry[] | undefined): RevocationEntry[] {
  return (revoked ?? []).filter((r) => isFailClosed(r.status));
}

/**
 * How many fail-closed verdicts this run carries, reading BOTH the per-event
 * array and the aggregate counters.
 *
 * The two describe the same rows upstream today — `summarizeByRun` derives
 * both from one `.limit(500)` result set — so this is `max` of two numbers that
 * currently always agree. It exists because they are not *contractually*
 * bound to agree, and this module already hardens the status vocabulary
 * against a control plane newer than this console while leaving the payload
 * SHAPE unhardened in the fail-OPEN direction. That asymmetry was reachable:
 * a payload with `revokedAtOrAfter: 2` and an empty `revoked[]` had
 * `runRevocationReported` (which reads the counters) saying "we checked" while
 * `hasTrustViolation` (which read only the array) said "clean" — a green
 * check-mark beside a rendered `Revoked 0`. That is the precise outcome this
 * module exists to prevent, arrived at through its own newer half.
 *
 * `max`, not the array alone and not the counters alone: either source
 * reporting a fail-closed verdict is enough to disqualify the run, and neither
 * may be silently trusted to be complete.
 */
export function failClosedCount(trust: RunTrustSummary): number {
  return Math.max(
    failClosedEntries(trust.revoked).length,
    (trust.keyRevocationRevokedAtOrAfter ?? 0) + (trust.keyRevocationRevokedTimeUnverifiable ?? 0),
  );
}

/**
 * How many fail-closed verdicts were counted but arrived with no per-event
 * detail. Non-zero only on a payload whose counters outrun its array — which
 * upstream cannot currently produce. Surfaced rather than swallowed: a run
 * that reddens its icon must never render an empty findings table, which is
 * the failure mode Phase 2 removed and which counting the counters would
 * otherwise reintroduce for exactly this payload.
 */
export function undetailedFailClosedCount(trust: RunTrustSummary): number {
  return Math.max(0, failClosedCount(trust) - failClosedEntries(trust.revoked).length);
}

/** Historically-authorized entries — surfaced separately, never as violations. */
export function preCompromiseEntries(revoked: RevocationEntry[] | undefined): RevocationEntry[] {
  return (revoked ?? []).filter((r) => isHistoricallyAuthorized(r.status));
}

/**
 * How many historically-authorized verdicts this run carries, reading BOTH the
 * array and the counter — the exact counterpart of `failClosedCount`, and
 * added for the same reason after the asymmetry shipped.
 *
 * `failClosedCount` was made counter-aware and this one was not, so a payload
 * with `revoked: []` and `keyRevocationPreCompromise: 2` rendered
 * **`Pre-compromise 0`** on the very panel whose purpose is never to state a
 * number nobody established — while the identical counter rendered as a figure
 * on the dashboard. A stat reading zero over a payload that says two is the
 * same defect as a green check over a live violation, pointed the other way:
 * both assert a fact the evidence contradicts.
 *
 * `max`, like its sibling: neither source may be trusted to be complete, and
 * under-reporting an authorized-but-retired key is still under-reporting.
 */
export function preCompromiseCount(trust: RunTrustSummary): number {
  return Math.max(
    preCompromiseEntries(trust.revoked).length,
    trust.keyRevocationPreCompromise ?? 0,
  );
}

/**
 * Does this run carry a revocation verdict that should redden its trust icon,
 * put it in the violations list, and sort it to the top?
 *
 * Takes the whole `RunTrustSummary` and delegates to `failClosedCount`, so
 * there is exactly one definition of "fail-closed" and this predicate cannot
 * disagree with the number rendered next to it.
 *
 * It did. The docblock named three call sites and had none: every one of them
 * had moved to `failClosedCount` when the counters were added, leaving this
 * function reading `revoked[]` alone — the pre-hardening rule, preserved intact
 * behind a comment asserting it was the one in force. On the payload the
 * counter hardening exists for (`revokedAtOrAfter: 2`, `revoked: []`) it
 * returns `false` where every real caller says `true`. Nothing caught it
 * because nothing called it, and its tests passed for the same reason.
 *
 * Kept rather than deleted because the question it names is a real one and is
 * asked as a boolean in three places; reshaped so that adopting it is now the
 * cheap path and re-deriving the rule by hand is the expensive one.
 */
export function hasFailClosedRevocation(trust: RunTrustSummary): boolean {
  return failClosedCount(trust) > 0;
}

/**
 * Chip class for a revocation status. Falls back to the fail-closed style for
 * an unrecognised value — previously `REVOKED_STATUS_CHIP[status]` returned
 * `undefined` there, yielding an unstyled chip that read as neutral, which is
 * the most misleading possible rendering of a verdict we do not understand.
 *
 * Routed through `isHistoricallyAuthorized` rather than repeating the
 * `'pre_compromise'` literal, so the allow-list above stays the single source
 * of truth — a status added to it would otherwise still render red here.
 */
export function revocationChipClass(status: string): string {
  if (isHistoricallyAuthorized(status)) return 'chip ok';
  if (status === 'revoked_time_unverifiable') return 'chip warn';
  // `revoked_at_or_after` and anything unrecognised.
  return 'chip bad';
}

// ── the composite: what makes a RUN a violation ────────────────────────
//
// A run is disqualified by EITHER mechanism: a `flagged` receipt-audit
// discrepancy (content/signature) or a fail-closed revocation verdict (the
// signing key's authority was revoked). These live here, beside the revocation
// half, because three surfaces need them — the run panel's header icon,
// `/trust`'s violations filter, and `useTrust`'s ordering. Each of those
// previously expressed "is a violation" for itself, which is how they came to
// disagree in the first place; re-deriving the composite per surface would
// reproduce that defect one level up.

/** Does this run carry a disqualifying finding of either kind? */
export function hasTrustViolation(trust: RunTrustSummary): boolean {
  // Via `failClosedCount`, not `revoked[]` alone — see its docblock for the
  // fail-open payload that distinction closes.
  return trust.flagged.length > 0 || failClosedCount(trust) > 0;
}

/**
 * How many disqualifying findings a run carries, across both mechanisms.
 * Used only for ordering — the two kinds are reported separately everywhere
 * they are shown, and are summed here purely so "worst first" is well-defined.
 */
export function violationCount(trust: RunTrustSummary): number {
  return trust.flagged.length + failClosedCount(trust);
}

// ── was revocation checked AT ALL? ─────────────────────────────────────
//
// Distinct from everything above, and the harder question: "checked, clean"
// versus "never checked". The run-scoped payload still cannot say — it always
// emits `revoked` (as `[]` when disabled) and `key_revocation_status` is NOT
// NULL DEFAULT 'none', so with the check off every revocation figure is a
// legitimate, meaningless zero.
//
// Rendering those zeros is a confident "we checked and found nothing" from a
// deployment that never looked. Under-claiming is the correct direction for an
// ambiguous trust signal, per this console's standing invariant that it never
// renders an unverified thing as verified.
//
// RUN-SCOPED ONLY, AND THAT IS NOW THE WHOLE POINT. When this heuristic was
// written the control plane exposed `KEY_REVOCATION_CHECK_ENABLED` nowhere.
// Since acdp-control-plane#178 it does — `GET /dashboard/overview` returns
// `keyRevocation: null` when the check is off and carries a `features` object
// with all six audit/witness flags — so the DASHBOARD tile no longer infers
// anything from a zero: `dashboardRevocationState()` below reads the flag and
// says which of FOUR states it is (#97). It still derives `reported` from the
// counters, which is not an inference about the check — a non-zero count is
// self-evidencing.
//
// This run-scoped inference stays, because there is no equivalent signal for it.
// `features` rides on the overview payload and nothing else; a run's trust
// summary carries no flag, so for a single run "all zero" genuinely is all we
// have. Do not build MORE inference on top of it, and do not copy this pattern
// to a surface that has an explicit answer available.

/**
 * Did this RUN's payload actually carry a revocation classification?
 *
 * Two arms, and be precise about what each one is worth — an earlier draft of
 * this comment (and of the plan behind it) over-claimed the first:
 *
 *  - **Defensive, not load-bearing: `audited === 0`.** Upstream *does* enforce
 *    that `KEY_REVOCATION_CHECK_ENABLED=true` requires `RECEIPT_AUDIT_ENABLED=true`
 *    (`app-config.service.ts` throws at boot otherwise), so a summary with zero
 *    audited events cannot have classified anything. But that summary never
 *    arrives: `receipt-audit.repository.ts`'s `summarizeByRun` returns **null**
 *    when it finds no rows and sets `audited: rows.length`, and
 *    `components/runs/run-workbench.tsx` renders this panel only on
 *    `run.trust &&`. So the real "receipt audit is off" case shows up as an
 *    ABSENT panel, not as `audited: 0`. This arm is a cheap guard against a
 *    payload shape upstream does not currently produce — keep it, but do not
 *    describe it as covering the common case, and do not let a reviewer believe
 *    the distinct copy it drives is reachable UI today.
 *  - **Load-bearing: the heuristic.** A non-zero count proves the check ran,
 *    which makes every figure in that payload trustworthy *including the zeros
 *    among them*. An all-zero payload is genuinely ambiguous.
 *
 * So the ambiguity this function actually carries, on essentially every real
 * payload, is receipt-audit ON with revocation OFF — the default combination —
 * which yields `audited > 0` and all-zero counts. Known cost, stated plainly: a
 * deployment with the check ENABLED and a genuinely clean estate also reads
 * "not reported", and since it never classifies anything it stays that way.
 * That is the healthy steady state and the one an operator most wants
 * confirmed. acdp-control-plane#176 asked for the signal that would fix it and
 * shipped as their PR #178 — but on `/dashboard/overview` only; this run-scoped
 * payload was not touched, so the cost above still stands here.
 */
export function runRevocationReported(trust: RunTrustSummary): boolean {
  // Entries FIRST, before the defensive guard below. `revoked[]` rows are
  // rendered as a table by the panel no matter what this predicate says, so a
  // guard that fired ahead of them produced a panel simultaneously listing
  // three revocation verdicts and stating that no revocation classification
  // could have run. A defensive guard that makes the UI contradict itself is
  // worse than no guard. Evidence that something WAS classified wins.
  if ((trust.revoked?.length ?? 0) > 0) return true;
  // Defensive guard — see the docblock. Upstream cannot currently emit a
  // non-null summary with `audited: 0`. Kept ahead of the counters (which, on
  // their own, render nothing when suppressed, so there is nothing for them to
  // contradict) because counters claiming classifications over zero audited
  // events describe a payload that cannot exist, and the safe reading of an
  // incoherent trust payload is "unknown".
  if (trust.audited === 0) return false;
  const counted =
    (trust.keyRevocationPreCompromise ?? 0) +
    (trust.keyRevocationRevokedAtOrAfter ?? 0) +
    (trust.keyRevocationRevokedTimeUnverifiable ?? 0);
  return counted > 0;
}

/*
 * `DashboardRevocation` is NOT re-exported from here.
 *
 * An earlier revision of this change re-exported it with the rationale that
 * doing so "keeps this module's existing import surface intact". That rationale
 * was false: the type was only ever referenced inside this file, so the
 * re-export had no consumer to keep intact, before the change or after. It now
 * lives in `lib/types.ts` beside `CpDashboardOverview`, which is the field's
 * actual home — import it from there.
 */

/**
 * REMOVED with #97: `dashboardRevocationReported`, a type predicate over the
 * dashboard's revocation counters.
 *
 * It answered "did this window report a classification?" by testing whether any
 * of the three counters exceeded zero — which cannot tell a deployment that ran
 * the check and found nothing from one that never looked. That was its whole
 * failure mode and it is the whole content of #97: a check that IS enabled over
 * a genuinely clean estate read "not reported" forever.
 *
 * It was a type predicate so the three KPIs following a true result could read
 * `d.keyRevocation.preCompromise` without asserting past the optional with `!`.
 * `dashboardRevocationState` keeps that property and improves on it —
 * `state.kind === 'reported'` narrows `state.counts` — so there was nothing left
 * for the predicate to do that the discriminated union does not do better, and
 * leaving it exported would have left a second, weaker answer to the same
 * question available to the next surface that needed one.
 *
 * `runRevocationReported` above is a DIFFERENT function over run-scoped data and
 * is deliberately untouched: there is no `features` equivalent for a single run,
 * so for one run "all zero" genuinely is all the evidence there is.
 */

// ── the two spellings of the revocation context type ───────────────────
//
// `acdp-primitives` defines BOTH `KEY_REVOCATION = "key-revocation"` and
// `KEY_REVOCATION_INTERIM = "acdp:key-revocation"`, and RFC-ACDP-0014 §10
// requires a 0.3.0 consumer to treat them as equivalent. A ≥0.5.0 registry
// rejects *new* interim publishes but keeps serving bodies already published
// under it — so the interim form is historical data that still exists and is
// still served.
//
// Registry search matches `type` as an exact string, so a query for one
// spelling returns none of the other. Asking for only the canonical form is
// therefore a silent "there are none here" about contexts that do exist: the
// same claiming-absence-without-looking defect as the revocation counters
// above, which is why both live in this module.

/** Canonical (0.5.0+) revocation context type. */
export const KEY_REVOCATION_TYPE = 'key-revocation';

/** Interim (0.3.0-era) spelling, still served for already-published bodies. */
export const KEY_REVOCATION_INTERIM_TYPE = 'acdp:key-revocation';

/** Both spellings, in the order they are queried. */
export const KEY_REVOCATION_TYPE_ALIASES: readonly string[] = [
  KEY_REVOCATION_TYPE,
  KEY_REVOCATION_INTERIM_TYPE,
];

/**
 * Is this facet selection the one that must fan out over both spellings?
 *
 * Deliberately true for the interim value as well: an operator who somehow
 * selects `acdp:key-revocation` should get the same union, not the mirror-image
 * blind spot. Every other `type` value is untouched — the fan-out, and the
 * cursor suppression it forces, applies to this facet only.
 */
export function isKeyRevocationFacet(type: string | undefined): boolean {
  return !!type && KEY_REVOCATION_TYPE_ALIASES.includes(type);
}

/**
 * What the dashboard can honestly say about key revocation, as four states
 * rather than a boolean.
 *
 * The boolean above collapses two genuinely different situations into "not
 * reported": a deployment that ran the check and found nothing, and one that
 * never looked. An operator seeing the same rendering for both cannot tell a
 * clean estate from an unmonitored one, which is the entire content of #97.
 *
 * Four arms, because there really are four things that can be true:
 *
 *   `reported`       counters arrived with something in them — render them.
 *   `checked-clean`  the flag says the check is ON, and the counters that
 *                    arrived are all zero. This is the state that did not
 *                    previously exist and is the reason the function exists.
 *                    NOT "the flag says the check RAN": the flag is current
 *                    config and describes the deployment NOW, while the
 *                    counters were persisted at audit time — so it cannot say
 *                    the check was on when each event in the window was
 *                    classified. `app/dashboard/page.tsx` renders exactly that
 *                    caveat ("It does not follow that every event in the window
 *                    was checked") and `dashboard-revocation.test.tsx` forbids
 *                    the stronger reading outright. This bullet said "the check
 *                    RAN" for one commit after the `disabled` bullet below was
 *                    corrected for the same over-claim; a neighbouring arm is
 *                    where these keep surviving.
 *   `disabled`       the flag says the check is OFF. Whatever counters arrived
 *                    are therefore not evidence either way: from here the
 *                    console cannot tell a zero the check produced from a zero
 *                    it never ran for, so neither may be rendered as a finding.
 *
 *                    NOT "nothing was measured", and NOT "zeros a check never
 *                    produced" — which is the SAME CLAIM in different words,
 *                    and is refuted by the next sentence of this very bullet.
 *                    Upstream gates both the query and the tile on one config
 *                    value, so disabling the check nulls the tile regardless of
 *                    what was classified earlier in the window, and the
 *                    persisted rows are untouched: a deployment that ran the
 *                    check over the first half of the window and switched it
 *                    off yesterday reaches this arm holding real zeros that a
 *                    real check produced.
 *
 *                    This bullet has now stated that over-claim twice, in two
 *                    wordings, each time as the FIX for the previous one —
 *                    rounds 3 and 6 of this change's gate. The rendering has
 *                    been right since round 3 (`app/dashboard/page.tsx`, "a
 *                    zero produced WHILE THE CHECK IS OFF is not a finding",
 *                    with `dashboard-revocation.test.tsx` forbidding the
 *                    stronger reading outright); it is the definition that
 *                    keeps lagging, and the definition is where the next
 *                    consumer reads the meaning from.
 *   `unknown`        we cannot tell — for one of the reasons enumerated
 *                    below, carried on the arm as `because`, because they
 *                    license different copy.
 *
 *                    NO NUMBER HERE, deliberately, and that is the third
 *                    correction to this one line. It said "two" for one commit
 *                    after the third `because` was added, contradicting its own
 *                    list twenty lines further down; round 8's gate returned a
 *                    blocking finding on it; the commit that fixed that added a
 *                    FOURTH `because` and left "THREE" standing here, in this
 *                    line and in five others. A count written in prose beside a
 *                    list that already carries it is a second source of truth
 *                    that only ever goes stale, and a stale one invites the
 *                    next reader to conclude an arm is dead and merge it —
 *                    which is precisely how the over-claiming `flags-disagree`
 *                    copy came to be written. Count the list.
 *
 * The `because` split exists for a defect the first gate round on this change
 * found. The `unknown` arm inherited the old prose verbatim, hedge included —
 * "the check is disabled by default" — on the argument that this arm is a
 * pre-#178 backend where the hedge is still honest. That argument covers only
 * ONE of the routes into the arm. The others reach it holding a `features`
 * object whose `keyRevocationCheck` is `true`, and rendering "disabled by
 * default" there states a cause the console has direct evidence against. So:
 *
 *   `because: 'no-flags'`            nothing said whether the check runs
 *                                    (pre-#178). The legacy hedge is a fair
 *                                    explanation here and only here.
 *   `because: 'flag-on-no-counters'` the flag says the check runs and the
 *                                    counters are ABSENT (not zero). Upstream
 *                                    cannot produce that combination.
 *   `because: 'flag-unreadable'`     a `features` object arrived but its
 *                                    `keyRevocationCheck` is neither `true` nor
 *                                    `false`.
 *   `because: 'counters-partial'`    some of the three counters arrived and
 *                                    some did not. A fact about the PAYLOAD, so
 *                                    it is read before any flag — it falsifies
 *                                    the copy on the flag-derived arms rather
 *                                    than being explained by them.
 *
 * The list has grown twice, both times because a value named a fact that did
 * NOT hold on every route carrying it — which is the one invariant a `because`
 * has to satisfy.
 *
 * `counters-partial` (seventh gate round): `flag-on-no-counters` had been
 * widened to catch `{}` and swallowed partial triples with it, so its sentence
 * — "sent no counters at all, not even zeros" — rendered over payloads that had
 * sent a zero. The suite pinned that sentence positively, so it enforced the
 * false claim instead of catching it.
 *
 * `flag-unreadable` (second gate round): a single `flags-disagree` value
 * collapsed it with `flag-on-no-counters`, and the copy written for the pair
 * described only the latter — it said the deployment "says the check is enabled
 * but sent no counters at all", which on the unreadable route is false twice
 * over: the deployment said nothing readable about the check, and the counters
 * may well have arrived as zeros. Rendering one route's cause over another's is
 * the same defect this split was introduced to remove, one level down.
 *
 * Widening a route without re-reading its copy is how the invariant keeps
 * breaking, and it is why the pin in `test/support/revocation-prose.ts` keys
 * its table off this union: a new value fails to typecheck there until its copy
 * is written.
 *
 * `null` counters WITH `keyRevocationCheck === true` is a combination upstream
 * cannot produce — both derive from the same config value
 * (`dashboard.service.ts:39` and `:240`, cited from #97 rather than verified
 * from here) — so it maps to `unknown` rather than `checked-clean`. A state the
 * backend cannot reach must not be asserted from this side; if it ever appears,
 * something is wrong and "we do not know" is the only defensible reading.
 *
 * Every flag read is `=== true` / `=== false`, never truthiness. `features` is
 * typed with all six booleans required, so a partial object fails typecheck
 * here — but a partial WIRE payload would leave a flag `undefined`, and
 * `undefined` must fall to `unknown`, not silently to `disabled`. Same
 * discipline `log-witness-card.tsx` uses for the nullable quorum counts.
 */
export type DashboardRevocationState =
  | { kind: 'reported'; counts: DashboardRevocation }
  | { kind: 'disabled' }
  | { kind: 'checked-clean' }
  | {
      kind: 'unknown';
      because: 'no-flags' | 'flag-on-no-counters' | 'flag-unreadable' | 'counters-partial';
    };

/**
 * Did a counter TRIPLE actually arrive, as three numbers?
 *
 * `!!keyRevocation` is not the same question, and the difference is a false
 * claim: `{}` is truthy, carries nothing, and routed to `checked-clean`, whose
 * copy states "this window's counters are zero".
 *
 * This docblock used to continue: "`undefined > 0` is `false`, so the
 * `reported` guard already handled a missing member silently — it declined to
 * report." That was wrong, and it is left here as the correction rather than
 * deleted, because it is the sentence that made the defect invisible for three
 * revisions. `undefined > 0` is indeed false, but the guard was a DISJUNCTION:
 * `{ revokedAtOrAfter: 3 }` fails two of its three tests and passes the third,
 * so it reported — and the tile rendered a fabricated `0` for each member that
 * never arrived. The guard did not decline anything. It is now gated on this
 * predicate, which is what the sentence claimed was already true.
 *
 * All three, not any: a partial triple is not a payload this console can read,
 * and picking the members that happen to be present would report a sum over an
 * unknown denominator.
 */
function hasCounters(k: DashboardRevocation | null | undefined): k is DashboardRevocation {
  return (
    !!k &&
    typeof k.preCompromise === 'number' &&
    typeof k.revokedAtOrAfter === 'number' &&
    typeof k.revokedTimeUnverifiable === 'number'
  );
}

/**
 * Did SOMETHING counter-shaped arrive, without all three being there?
 *
 * The distinction `hasCounters` alone could not make, and the gap the previous
 * revision fell into. `hasCounters` sorts payloads into "readable" and "not
 * readable", but "not readable" then held two populations whose copy must
 * differ: `{}` and `null` sent nothing, and `{ preCompromise: 0 }` sent
 * something. Routing both to `flag-on-no-counters` made that arm's sentence —
 * "sent no counters at all, not even zeros" — false of the second, and the
 * suite POSITIVELY PINNED the sentence, so it enforced the false claim.
 *
 * `{}` is deliberately NOT partial: it carries no member of the triple, so
 * "sent no counters" is true of it. The predicate is about members that are
 * actually numbers, not about the object's existence.
 */
function hasSomeCounters(k: DashboardRevocation | null | undefined): boolean {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return false;
  const r = k as unknown as Record<string, unknown>;
  return (
    typeof r.preCompromise === 'number' ||
    typeof r.revokedAtOrAfter === 'number' ||
    typeof r.revokedTimeUnverifiable === 'number'
  );
}

export function dashboardRevocationState(
  keyRevocation: DashboardRevocation | null | undefined,
  // `| null` is not decoration. `CpDashboardFeatures | undefined` is what a
  // correct upstream sends, but this value comes off the network, and the
  // second gate round reached this function with `features: null` and crashed
  // the whole `/dashboard` route — `=== undefined` is false for `null`, and the
  // next line dereferenced it. `/trust` was already null-safe via `?.`, so the
  // two surfaces disagreed about the same payload. Typed as nullable so the
  // guard below is required rather than remembered.
  features: CpDashboardFeatures | null | undefined,
): DashboardRevocationState {
  // Counters with something in them are self-evidencing: whatever the flags
  // say, a non-zero count means the check ran and found that. Checked first so
  // the tile renders figures even against a backend whose `features` is missing
  // or contradicts them.
  //
  // `hasCounters` GATES THIS ARM, and its absence was a live defect. The guard
  // used to be `keyRevocation && (a > 0 || b > 0 || c > 0)`, and `undefined > 0`
  // is `false` — so `{ revokedAtOrAfter: 3 }` passed it, and the tile rendered
  // `['0', '3', '0']`: a green "Pre-compromise (authorized) 0" and an amber
  // "Revoked time unverifiable 0" from a payload that sent neither. Two
  // fabricated zeros on a trust surface, beside one real figure, with nothing
  // to tell them apart. This module's docblock said in three places that a
  // partial triple "is not a payload this console can read"; this arm read one
  // anyway.
  if (
    hasCounters(keyRevocation) &&
    (keyRevocation.preCompromise > 0 ||
      keyRevocation.revokedAtOrAfter > 0 ||
      keyRevocation.revokedTimeUnverifiable > 0)
  ) {
    return { kind: 'reported', counts: keyRevocation };
  }

  // A PARTIAL triple, checked before any flag is read.
  //
  // Its position is the point. This is a fact about the PAYLOAD, and it
  // falsifies the copy on every flag-derived arm below: `no-flags` says
  // "nothing in this window carried a revocation classification" (false of
  // `{ revokedAtOrAfter: 3 }`), and `flag-on-no-counters` says "sent no
  // counters at all — not even zeros" (false of anything that sent one). An
  // earlier revision routed partials into the latter and the test suite pinned
  // that sentence positively, so the guard enforced the false claim rather than
  // catching it.
  if (!hasCounters(keyRevocation) && hasSomeCounters(keyRevocation)) {
    return { kind: 'unknown', because: 'counters-partial' };
  }

  // No usable flag object at all — the pre-#178 backend, or a wire payload that
  // sent `null` or something that is not an object. This is the ONE route into
  // `unknown` where "the check is disabled by default" is a fair explanation,
  // because nothing has told us otherwise.
  //
  // `typeof !== 'object'` as well as the null test: a `features` that arrived
  // as a string or a number tells us nothing about the check either, and
  // reading a property off it would yield `undefined` and route to
  // `flag-unreadable` — which would claim a features object arrived when what
  // arrived was not one.
  //
  // An ARRAY is the gap in that reasoning and is excluded explicitly:
  // `typeof [] === 'object'`, so without the array test a `features: []` would
  // pass this guard and render "It sent a feature report, but the
  // compromise-boundary setting in it was not a value this console can read" —
  // asserting a feature report arrived when an array is not one either. The
  // rationale above covers what it says it covers; this is the case it did not.
  if (
    features === undefined ||
    features === null ||
    typeof features !== 'object' ||
    Array.isArray(features)
  ) {
    return { kind: 'unknown', because: 'no-flags' };
  }

  if (features.keyRevocationCheck === false) return { kind: 'disabled' };

  if (features.keyRevocationCheck === true) {
    // The impossible combination described above: the flag says the check runs,
    // but the counters are absent rather than zero. Do not report clean — and
    // do not explain it as "disabled" either, since the one thing we can read
    // says it is on.
    //
    // `hasCounters`, not truthiness. `keyRevocation: {}` is truthy and carries
    // no counters, so it fell through to `checked-clean` and rendered "this
    // window's counters are zero" over a payload that sent none — a figure
    // asserted from an absence, which is the one thing this module exists to
    // stop. Upstream always builds all three with `?? 0`, so `{}` is not a
    // shape a correct control plane sends; neither was `features: null` (round
    // 2) or `features: []` (round 3), and both of those reached here off the
    // network and produced a false claim.
    if (!hasCounters(keyRevocation)) return { kind: 'unknown', because: 'flag-on-no-counters' };
    return { kind: 'checked-clean' };
  }

  // `keyRevocationCheck` is neither `true` nor `false` — a wire payload with
  // the flag missing or non-boolean. Unreachable through the type, reachable
  // through the network. Its own `because`, not the one above: the counters on
  // this route may be absent OR present-and-zero, so nothing may be said about
  // them, and a `features` object DID arrive, so the pre-#178 explanation is
  // also unavailable. The only fact that holds on every route here is that the
  // flag itself could not be read.
  return { kind: 'unknown', because: 'flag-unreadable' };
}
