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
  return trust.flagged.length > 0 || hasFailClosedRevocation(trust.revoked);
}

/**
 * How many disqualifying findings a run carries, across both mechanisms.
 * Used only for ordering — the two kinds are reported separately everywhere
 * they are shown, and are summed here purely so "worst first" is well-defined.
 */
export function violationCount(trust: RunTrustSummary): number {
  return trust.flagged.length + failClosedEntries(trust.revoked).length;
}
