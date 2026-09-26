import { ApiError } from '@/lib/api/fetcher';

// ══════════════════════════════════════════════════════════════════════
// Operator-facing copy for a failed context fetch, keyed by upstream error
// code.
//
// Two call sites — `app/contexts/page.tsx` and
// `components/runs/context-inspector.tsx` — each collapsed
// `CONTEXT_ID_MISMATCH` and `CONTEXT_BINDING_UNVERIFIABLE` into one boolean and
// rendered one string for both. The control plane keeps them apart on purpose,
// and `acdp-control-plane/src/errors/error-codes.ts:20-26` says why in as many
// words:
//
//   CONTEXT_ID_MISMATCH          — "we DID check, and the upstream served a
//                                   different context than the one requested.
//                                   The registry may be hostile."
//   CONTEXT_BINDING_UNVERIFIABLE — "we COULD NOT check … The registry is most
//                                   likely misconfigured. No mismatch was ever
//                                   established, so claiming one here would be
//                                   a lie."
//
// The console emitted that lie for the second code, and not academically:
// `CONTEXT_BINDING_UNVERIFIABLE` fires on three causes involving no
// substitution at all (`contexts.controller.ts:144-190`) —
// `response_not_json` (a proxy or WAF in front of the registry answering 200
// with HTML), `response_has_no_body_member`, and `sdk_could_not_verify`, the
// last of which includes *the operator's own ctx_id being malformed*
// (`contexts.controller.ts:233-238` documents a ctx_id slipping through the
// 63-character DNS-label gap landing exactly here). So pasting an over-long
// authority told the operator a registry was serving substituted contexts.
//
// This is Phase 1's defect one layer up: could-not-check rendered as a failure.
//
// Living in `lib/utils/` rather than beside `ApiError` in `lib/api/fetcher.ts`
// is deliberate — this is operator-facing copy, not transport, and keeping the
// fetcher free of UI strings preserves the layer split. Both are inside the
// `lib/**` coverage glob, so it costs no coverage.
// ══════════════════════════════════════════════════════════════════════

/**
 * Keyed by the exact wire value of `ApiError.errorCode`, with **no**
 * normalisation of the incoming code.
 *
 * `errorCode` is NOT control-plane-exclusive: `fetcher.ts`'s `error.code`
 * fallback also matches the registry's own RFC-ACDP-0007 §5 envelope
 * (`acdp-registry-types/src/error.rs:83-92`), so a direct registry call
 * populates it with lowercase snake_case codes (`schema_violation`,
 * `rate_limited`, `not_authorized`). There is no collision today — control-plane
 * codes are SCREAMING_SNAKE — but case-folding a lookup would manufacture one,
 * so the lookup is exact.
 *
 * Apostrophes here are ASCII, not typographic: the plan's acceptance criterion
 * for this module is a literal `grep` for the mismatch sentence across the two
 * call sites, and a U+2019 would quietly make that check match nothing while
 * appearing to pass.
 *
 * A `Map` rather than an object literal: a lookup on a plain object would
 * resolve `constructor` / `toString` through the prototype chain and hand a
 * *function* back to a surface rendering an error, and an upstream error code
 * is attacker-influenced input from this console's point of view.
 */
export const CONTEXT_ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    'CONTEXT_ID_MISMATCH',
    "Registry served a context that doesn't match its own claimed id — this response cannot be trusted.",
  ],
  [
    'CONTEXT_BINDING_UNVERIFIABLE',
    // Every clause here is upstream's, not ours. `error-codes.ts:22-26` gives
    // the causes ("a 2xx body that is not JSON, carries no `body` member, or
    // names a `ctx_id` the protocol grammar refuses") AND the prior ("The
    // registry is most likely misconfigured") — so the prior is stated in that
    // direction. An earlier draft closed with "Check the id you entered before
    // suspecting the registry", which was wrong twice over: it inverted
    // upstream's prior, and no surface in this console accepts a typed ctx_id
    // (both call sites pass an id the operator CLICKED). Telling an operator to
    // re-check something they never entered is this phase's own defect class,
    // pointed at the operator instead of the registry.
    "The registry's response could not be checked against the id that was requested, so it was not relayed. " +
      'No mismatch was established — the check could not run at all. The registry is most likely misconfigured, ' +
      'or something in front of it answered with a page that is not a context; the other possible cause is a ' +
      'ctx_id the protocol grammar refuses.',
  ],
  [
    'FEDERATION_UPSTREAM_RATE_LIMITED',
    'The upstream registry is rate limiting this control plane, so the context was not fetched. ' +
      'Wait and retry — nothing about this context has failed verification.',
  ],
  [
    'CONTEXT_NOT_FOUND',
    'No context body was returned for this id. Nothing here has failed verification — there is simply nothing to verify.',
  ],
]);

/**
 * The one string this module ends on when it knows nothing at all. Named rather
 * than written twice: it is the default of `contextErrorFallback` AND the
 * answer for a non-`ApiError` throw, and a module whose whole purpose is
 * removing duplicated operator copy should not hold a duplicate of its own.
 */
const GENERIC = 'Could not load context.';

/**
 * The last resort, reached when the response carried no `errorCode` (a non-JSON
 * body) or one this console has never seen — a newer control plane, or a direct
 * registry call. Never blank, and never a claim about trust: a status alone
 * establishes nothing about whether a context was substituted.
 *
 * **Keyed on the error, not on a bare status, and that is load-bearing.** Every
 * arm below except 404 names an upstream as the cause, and `fetcher.ts` spells
 * out at length that a status alone cannot tell an upstream's envelope from one
 * this console minted — `middleware.ts`'s own 503 when `ACDP_UI_CONSOLE_PASSWORD`
 * is unset, the proxy route's own 403 and 502, Next's 500 for an unset
 * `*_BASE_URL`. Keyed on the number, a console-side 503 told the operator "the
 * registry is unavailable or rate limiting right now — wait and retry": blaming
 * a service that was never contacted, and prescribing an action that can never
 * resolve it. That is the same could-not-establish over-claim this module exists
 * to remove, one layer out — so it is gated on the `x-acdp-ui-proxy` stamp the
 * console already carries rather than guessed from the status.
 *
 * 404 stays ungated deliberately: not-found is not a blame claim, and it is the
 * status demo mode throws (with `fromUpstream: false`) for a context it has no
 * body for.
 */
export function contextErrorFallback(error: ApiError): string {
  const { status } = error;
  if (status === 404) return CONTEXT_ERROR_MESSAGES.get('CONTEXT_NOT_FOUND')!;
  if (!error.fromUpstream) {
    // The bytes never left this console. Say so, rather than inventing an
    // upstream to blame — the operator's fix is here, not over there.
    return 'This console could not complete the request — it looks misconfigured or signed out. Check the deployment configuration, or sign in again.';
  }
  if (status === 403) return 'Not authorized to read this context.';
  // 429 is the registry answering this console directly; 503 is the control
  // plane's own translation of an upstream 429 when the code is missing.
  if (status === 429 || status === 503)
    return 'The registry is unavailable or rate limiting right now — wait and retry.';
  if (status >= 500) return 'The registry or control plane did not return this context.';
  return GENERIC;
}

/**
 * The single definition of what an operator is told about a failed context
 * fetch. Both surfaces call this, so neither can drift from the other, and the
 * two bare string literals that used to be duplicated across two files — where
 * a typo in one would have been silent — now exist once.
 *
 * Takes `unknown` rather than `ApiError` on purpose: React Query hands back
 * whatever the `queryFn` threw, and pushing the `instanceof` narrowing into
 * each call site is how the duplication started.
 */
export function contextErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC;
  if (error.errorCode) {
    const mapped = CONTEXT_ERROR_MESSAGES.get(error.errorCode);
    if (mapped) return mapped;
  }
  return contextErrorFallback(error);
}
