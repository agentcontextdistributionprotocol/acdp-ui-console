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
import type { RunTrustSummary } from '@/lib/types';

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
 * Does this run carry a revocation verdict that should redden its trust icon,
 * put it in the violations list, and sort it to the top?
 */
export function hasFailClosedRevocation(revoked: RevocationEntry[] | undefined): boolean {
  return failClosedEntries(revoked).length > 0;
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
// Distinct from everything above, and the harder question. The payload cannot
// say "checked, clean" versus "never checked": the control plane builds
// `keyRevocation` UNCONDITIONALLY with `?? 0` on every member, always emits
// `revoked` (as `[]` when disabled), makes `key_revocation_status` NOT NULL
// DEFAULT 'none', and exposes `KEY_REVOCATION_CHECK_ENABLED` — which defaults
// to **false** — on no HTTP surface at all. So with the check off, every
// revocation figure is a legitimate, meaningless zero.
//
// Rendering those zeros is a confident "we checked and found nothing" from a
// deployment that never looked. Under-claiming is the correct direction for an
// ambiguous trust signal, per this console's standing invariant that it never
// renders an unverified thing as verified.
//
// PROVISIONAL. The heuristic below is designed to be deleted: we have asked
// upstream for an explicit signal in acdp-control-plane#176 (a null field, a
// capabilities object, or a per-payload discriminator — any of them closes
// this). Replace `revocationReported*` with that signal when it lands; do not
// build more inference on top of these.

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
 * confirmed, and it is exactly what acdp-control-plane#176 fixes.
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

/** The dashboard overview's window-scoped revocation counters. */
export type DashboardRevocation = {
  preCompromise: number;
  revokedAtOrAfter: number;
  revokedTimeUnverifiable: number;
};

/**
 * Same question for the window-scoped dashboard tile. Written as a TYPE
 * PREDICATE so the three KPIs that follow a true result read
 * `d.keyRevocation.preCompromise` rather than asserting past the optional with
 * `!` — the guarantee is then checked by the compiler instead of promised in a
 * comment. No proof arm is
 * available here — the overview payload carries no `audited` total to lean on
 * — so this is heuristic only.
 */
export function dashboardRevocationReported(
  keyRevocation: DashboardRevocation | undefined,
): keyRevocation is DashboardRevocation {
  if (!keyRevocation) return false; // pre-Phase-14 backend: genuinely absent
  return (
    keyRevocation.preCompromise > 0 ||
    keyRevocation.revokedAtOrAfter > 0 ||
    keyRevocation.revokedTimeUnverifiable > 0
  );
}

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
