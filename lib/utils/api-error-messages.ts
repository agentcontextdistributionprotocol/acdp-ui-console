import { ApiError } from '@/lib/api/fetcher';
import type { ProxyService } from '@/lib/types';

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
 * The control plane's labelled 4xx vocabulary (acdp-control-plane #182; the
 * table in its `docs/API.md`). SCREAMING_SNAKE and looked up exactly, so it
 * cannot collide with the registry's lowercase vocabulary below.
 *
 * Only codes whose meaning the bare status arm cannot convey are here. The
 * generic `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` are deliberately absent:
 * the status arms already say that, with provenance. `ADMIN_REQUIRED` is the
 * one 403 that is now distinguishable from a validation failure, so it names the
 * fix. Applied by `operatorErrorMessage` AFTER a caller's own `codes`, so a
 * surface with sharper copy still wins.
 */
export const CONTROL_PLANE_ERROR_CODES: ReadonlyMap<string, string> = new Map([
  ['ADMIN_REQUIRED', 'This action needs an admin-scoped control-plane key, and the one this console holds is not.'],
  ['INVALID_PAYLOAD', 'The control plane rejected the request as malformed. Check the values entered and retry.'],
  ['PAYLOAD_TOO_LARGE', 'The control plane refused the request because it is too large.'],
  ['RATE_LIMITED', 'The control plane is rate limiting this console. Wait a moment and retry.'],
  ['RUN_NOT_FOUND', 'The control plane has no run with that id.'],
  ['POLICY_DENIED', 'A control-plane policy denied this request.'],
  ['REGISTRY_NOT_ENROLLED', 'That registry is not enrolled with this control plane.'],
  ['REGISTRY_DISABLED', 'That registry is enrolled but currently disabled on this control plane.'],
]);

/**
 * The registry's own RFC-ACDP-0007 §5 vocabulary, for the surfaces that reach a
 * registry **directly** rather than through the control plane.
 *
 * Lowercase snake_case, because that is what `wire_code()` emits
 * (`acdp-registry-rs/crates/acdp-registry-types/src/error.rs:152-200`); the
 * control-plane map above is SCREAMING_SNAKE. Both are looked up with no
 * normalisation, so the two namespaces cannot collide and one map could hold
 * both — they are kept apart because they are two upstreams' contracts, and a
 * surface that can only reach one of them should not be able to render copy
 * from the other's vocabulary.
 *
 * Only the codes a **read** path can produce are here. The publish-side codes
 * (`duplicate_publish`, `immutable_field`, `superseded_target`,
 * `schema_violation`, …) are real and are deliberately absent: this console has
 * no publish surface, so an entry for one would be copy that cannot be reached
 * and cannot be tested — a vacuous mock in prose form.
 */
export const REGISTRY_ERROR_CODES: ReadonlyMap<string, string> = new Map([
  [
    // 404, from the single-record reads (`GET /contexts/{ctx_id}`,
    // `/lineages/{id}/current`). NOT from `GET /lineages/{id}`, which answers an
    // unpublished id with `200 []` (`acdp-registry-core/src/handlers/context.rs`
    // — `Ok(Json(items))` on an empty vec), so that route reaches this entry
    // only for a tenancy or caller failure upstream of the lookup.
    //
    // Says "the registry this console asked", not "this deployment": every path
    // that can reach this message queries ONE authority — `authToService` takes
    // a single `RegistryAuthority`, and both surfaces that render it put that
    // choice behind a Registry A / Registry B picker. A deployment-wide claim
    // would be false AND would suppress the likeliest fix, which is to flip the
    // picker. (An earlier draft said exactly that; the gate caught it. It is
    // this module's own defect class — claiming more than was established —
    // committed inside the map that exists to remove it.)
    'not_found',
    'Nothing is published under that id on the registry this console asked — and it asks one registry at ' +
      "a time. Check the spelling, try the other registry, or open a context from a run's lineage graph.",
  ],
  [
    // 403. Distinct from the shared 403 arm because the registries take no
    // credential from this console at all (`integrations.ts` returns auth
    // material for `control-plane` only), so "not authorized by registry A"
    // invites an operator to go looking for a console-side key that does not
    // exist. The fix is on the registry.
    'not_authorized',
    'The registry refused this read. Registry visibility and tenancy are enforced by the registry itself — ' +
      'this console sends it no credential — so the grant has to be made there.',
  ],
  [
    // Both 400. Split, because they are the registry's own two spellings and
    // RFC-ACDP-0007 keeps them apart: one is a cursor that never parsed, the
    // other a cursor that parsed and aged out. The recovery is the same and
    // saying so is the entire value — nothing on screen said it, and a bare
    // "registry A answered 400" reads like an operator mistake.
    //
    // These two fire on ONE path: `/contexts`' "Load more"
    // (`app/contexts/page.tsx:62` keysets on `next_cursor`, and
    // `client.ts:632` puts it on a direct-to-registry `/contexts/search`).
    // `/lineages/{id}` takes no cursor parameter at all, so a chain lookup can
    // never reach them — which is why `contextErrorMessage` consults this map
    // too. Mapping them only on the lineage surface would have been copy no
    // real request could produce.
    'invalid_cursor',
    'The page marker this console sent was not one the registry recognises. Search again from the start — ' +
      'nothing is wrong with the query itself.',
  ],
  [
    'cursor_expired',
    'The page marker this console sent has expired. Search again from the start — nothing is wrong with the ' +
      'query itself, and no results were lost.',
  ],
  [
    // 429. The shared arm already says "unavailable or rate limiting"; this
    // says which, and that the read is retryable rather than broken.
    'rate_limited',
    'The registry is rate limiting this console. Wait and retry — nothing about this request was rejected on ' +
      'its merits.',
  ],
  [
    // 502. The registry is fine; a registry it federates to is not. Without
    // this the operator reads "registry A did not answer successfully (502)"
    // and starts debugging registry A.
    'cross_registry_resolution_failed',
    'The registry could not reach the other registry this record points at, so the answer is incomplete. ' +
      'The registry this console queried is healthy — the federated hop is not.',
  ],
  [
    // 400 vs 502, and the split is the same could-check / could-not-check
    // distinction this whole module exists to preserve — the registry's own
    // mirror of `CONTEXT_ID_MISMATCH` vs `CONTEXT_BINDING_UNVERIFIABLE`
    // (`error.rs:157-158`, statuses at `:214` and `:241`). `_failed` is
    // permanent and about the material; `_unreachable` is transient and about
    // the network. Neither is "the signature is bad", and saying so is the
    // point: no verdict was reached either way.
    'key_resolution_failed',
    "A signing key referenced by this record could not be resolved — the reference itself is unusable. No " +
      'signature has been judged either way; the check could not run.',
  ],
  [
    'key_resolution_unreachable',
    'The service holding a signing key referenced by this record did not answer, so the check could not run. ' +
      'No signature has been judged either way. This one is transient — retry.',
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
 * The one sentence for "the bytes never left this console".
 *
 * Named rather than written twice: `contextErrorFallback` and the generic
 * `operatorErrorMessage` below must not be able to disagree about it, and it is
 * the clause where the over-claim risk lives — a status alone cannot tell an
 * upstream's envelope from one this console minted, so every surface that
 * reaches this state has to say the same careful thing.
 *
 * Already noun-free in its original form, which is evidence the seam between
 * "what the operator was trying to do" and "who failed" is in the right place.
 */
const CONSOLE_FAULT =
  'This console could not complete the request — it looks misconfigured or signed out. ' +
  'Check the deployment configuration, or sign in again.';

/**
 * `CONTROL_PLANE_API_KEY` is injected server-side by the proxy and never
 * reaches the browser, so an operator refused by the control plane has no way
 * to discover that the key exists at all. Naming the variable is the only
 * actionable thing this console can say.
 *
 * **Two sentences, because 401 and 403 have different remedies** and splicing
 * one onto both prescribes an action that cannot resolve half the cases — the
 * fault this module exists to remove, committed by the module itself. A 401 is
 * an authentication failure: the key is missing, wrong, or rotated, and
 * granting it admin scope fixes nothing. A 403 is an authorisation failure: the
 * key authenticated fine and lacks the scope. An earlier cut used the
 * admin-scope wording for both, and closing the gap by rewriting the docstring
 * rather than the string would have left the inaccuracy in the operator's face.
 */
const CP_KEY_PREAMBLE =
  'The control-plane key is configured server-side (CONTROL_PLANE_API_KEY) — ask whoever deployed ' +
  'this console to ';

/** For a 401: the key did not authenticate. */
export const CONTROL_PLANE_KEY_REJECTED = `${CP_KEY_PREAMBLE}check that it is set and current.`;

/**
 * For a 403: the key authenticated but lacks the scope.
 *
 * Exported ahead of a consumer on purpose: three admin-gated surfaces
 * (`app/security/page.tsx` and two in `components/registries/enrollments.tsx`)
 * each carry their own hand-written near-copy of this sentence, and the phase
 * that consolidates them onto this constant is the point of the export.
 */
export const ADMIN_KEY_REQUIRED = `${CP_KEY_PREAMBLE}grant it admin scope.`;

/**
 * What an operator is told when an admin-gated control-plane route answers 403.
 *
 * **It does not diagnose, and the first version of it did.** That version said
 * flatly that the key lacked admin scope, which is only one of the control
 * plane's reasons for a 403 on these routes — and on the enrollment form it was
 * reachable by typing the value the field's own placeholder suggested:
 *
 *  - `registries.controller.ts:174` runs `assertNotReservedTenant(body.tenantId)`
 *    **after** the admin check at `:168` has already passed, so naming the
 *    reserved tenant `default` yields a 403 from a key that is admin-scoped.
 *  - `auth.guard.ts:170` refuses a `default` assertion in `X-Tenant-Id` — and
 *    that header IS relayed (it is in the proxy's `FORWARD_HEADERS`).
 *  - `auth.guard.ts:179` refuses a header naming a tenant other than the key's.
 *  - `auth.guard.ts:184` refuses an unbound key outright under
 *    `AUTH_REQUIRE_TENANT`. This one hits every admin route, the revocation
 *    feed included.
 *
 * None of the four carries an `errorCode` — that is filed as
 * acdp-control-plane#179 — so this console genuinely cannot tell them apart.
 * The honest answer is therefore to name the likeliest cause as likely, say so,
 * and hand the operator the control plane's own sentence. Which makes the
 * disclosure load-bearing rather than decorative: every site rendering this
 * string MUST also render `errorDiagnostic`, and the tests assert that.
 */
export const ADMIN_ROUTE_FORBIDDEN =
  'The control plane refused it. This console cannot tell which of its reasons applies, because it ' +
  'sends no code for any of them — so the reason it gave is in the detail below. The likeliest is an ' +
  `under-scoped key: ${ADMIN_KEY_REQUIRED} The others are about tenancy: a request may not name the ` +
  'reserved tenant `default`, and under AUTH_REQUIRE_TENANT a key that is not bound to a tenant is ' +
  'refused outright. Read the detail before changing any key.';

/**
 * Is this the control plane refusing an admin-gated route — as opposed to this
 * console refusing to proxy the request in the first place?
 *
 * Three surfaces need this and each carried its own copy of `error instanceof
 * ApiError && error.status === 403`. That predicate is missing a term: a 403
 * this console minted is **unstamped**, and the proxy route mints one for any
 * path outside its allow-list (`app/api/proxy/[service]/[...path]/route.ts`),
 * as does `middleware.ts` on an Origin mismatch. Neither is an admin-scope
 * problem, and telling an operator to go get the deployment key re-scoped for
 * a request that never left the browser sends them to fix the wrong thing —
 * the defect class this module exists to remove.
 *
 * Deliberately NOT an `ApiError.isForbidden` getter beside `isNotFound`. That
 * getter would be a bare status test on the transport class, which is the right
 * shape for `isNotFound` and the wrong one here: the provenance gate is what
 * makes this predicate correct, and a status-only sibling sitting next to it
 * would be the more inviting of the two at exactly the call sites that must not
 * use it. The getter is worth adding on its own merits; it is a different
 * change, and it is filed.
 */
export function isUpstreamForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.fromUpstream;
}

/**
 * How each service is named to an operator.
 *
 * A `Record`, not a `Map`, and the contrast with `CONTEXT_ERROR_MESSAGES` above
 * is the point: that one is keyed by a wire value from an upstream, which is
 * attacker-influenced and needs prototype-safe lookup. `ProxyService` is a
 * closed union from our own code, so a `Record` gets exhaustiveness checked at
 * compile time and a service added later fails `tsc` until it is labelled.
 */
const SERVICE_LABEL: Record<ProxyService, string> = {
  playground: 'the playground',
  'control-plane': 'the control plane',
  'registry-a': 'registry A',
  'registry-b': 'registry B',
};

export interface ErrorCopyOptions {
  /** Domain codes, consulted before the status arms. Wire-keyed, so a `Map`. */
  readonly codes?: ReadonlyMap<string, string>;
  /** Domain-specific 404 sentence. Without it, 404 falls to the generic arm. */
  readonly notFound?: string;
}

/**
 * What an operator is told when a request failed, for any surface.
 *
 * The sentence splits at its natural seam:
 *
 *  - the **lead** — what the operator was trying to do — is per-surface
 *    knowledge and stays at the call site (`'Could not load the agent
 *    inventory'`). It is a plain string rather than a `{ noun, verb }` pair on
 *    purpose: a closed verb enum needs extending for every new surface, and the
 *    assembled sentence becomes invisible at the call site — whereas a lead is
 *    greppable, which this module's own acceptance criteria depend on.
 *  - the **cause clause** — who failed and what can be done about it — is
 *    shared knowledge, and is where every over-claim in this class lives. It
 *    lives here, gated on provenance and keyed on the error rather than on a
 *    bare status.
 *
 * `unknown`, not `ApiError`: `ApiError` is constructed at exactly two places in
 * `fetcher.ts`, and everything else propagates raw — a `TypeError` from `fetch`
 * itself never reaches the `!response.ok` branch, `response.json()` throws a
 * `SyntaxError` on a malformed 2xx, `parsePrometheus` throws its own. Non-
 * `ApiError` throws are common, not theoretical.
 *
 * **Provenance is checked before 404, unlike `contextErrorFallback`.** That
 * function puts 404 first for a context-specific reason it documents: demo mode
 * throws an unstamped 404 for a context it has no body for. Generically, an
 * unstamped 404 is Next's own answer for a route that does not exist in this
 * deployment — a deployment fault, not an upstream's not-found. Domains that
 * want the context-style wording back pass `opts.notFound`. This is the one
 * place the generalisation is not mechanical.
 */
export function operatorErrorMessage(
  error: unknown,
  lead: string,
  opts?: ErrorCopyOptions,
): string {
  if (!(error instanceof ApiError)) return `${lead}.`;

  // A code is a statement from the service about WHAT went wrong; a status only
  // says THAT it did. So codes win — over the status arms AND over the
  // provenance arm below.
  //
  // Beating provenance is the part that is easy to get backwards, and demo mode
  // is why it matters: it is the product default, and it throws code-bearing
  // errors that are UNSTAMPED by construction (`client.ts` raises
  // `CONTEXT_NOT_FOUND` and `REGISTRY_NOT_FOUND` with `fromUpstream` defaulting
  // to false, because no request was made). Check provenance first and every
  // such surface renders "this console looks misconfigured or signed out" in
  // the mode that is supposed to work with zero backends. A code the console
  // itself minted is still a statement about what went wrong.
  //
  // Joined with ". " rather than " — ": a `codes` value is a full sentence, and
  // splicing one after an em dash yields a capital mid-sentence and a nested
  // dash ("… inventory — That page expired — search again."). The status arms
  // below are lowercase continuations, so they keep the dash.
  if (error.errorCode && opts?.codes) {
    const mapped = opts.codes.get(error.errorCode);
    if (mapped) return `${lead}. ${mapped}`;
  }
  if (error.errorCode && error.service === 'control-plane') {
    const mapped = CONTROL_PLANE_ERROR_CODES.get(error.errorCode);
    if (mapped) return `${lead}. ${mapped}`;
  }

  if (!error.fromUpstream) return `${lead}. ${CONSOLE_FAULT}`;

  const { status } = error;
  const svc = SERVICE_LABEL[error.service];

  if (status === 401) {
    // Only the control plane carries an injected credential: `integrations.ts`
    // returns auth material for that service alone, and the proxy injects a
    // bearer only when that config is present — the browser's own cookie and
    // `authorization` are stripped by the header allow-list.
    //
    // So the two branches are not the same sentence with a hint bolted on, and
    // an earlier version of this code got that wrong: it told an operator that
    // `registry A rejected this console's credentials`, which is false in both
    // halves — nothing was presented, so nothing was rejected — and it implied
    // a fix (repair the console's registry credential) that does not exist in
    // this product. That is this module's own documented defect class: blaming
    // a service for refusing something it was never offered.
    if (error.service === 'control-plane') {
      return `${lead} — the control plane rejected this console's credentials. ${CONTROL_PLANE_KEY_REJECTED}`;
    }
    return `${lead} — ${svc} requires credentials this console does not send.`;
  }
  if (status === 403) return `${lead} — not authorized by ${svc}.`;
  if (status === 404) return `${lead} — ${opts?.notFound ?? `${svc} has no record of it.`}`;
  if (status === 429 || status === 503)
    return `${lead} — ${svc} is unavailable or rate limiting right now. Wait and retry.`;
  if (status >= 500) return `${lead} — ${svc} did not answer successfully (${status}).`;
  return `${lead} — ${svc} answered ${status}.`;
}

/**
 * The upstream's own bytes, in full, for a collapsed disclosure.
 *
 * `undefined` when there is nothing worth showing, so a caller can pass the
 * result straight into an optional prop.
 *
 * **Untruncated, deliberately.** The status/service/path prefix is the
 * genuinely diagnostic part — an HTML body from a WAF tells you nothing the
 * status and path do not — but losing the upstream's own message trades one
 * problem for another, which is the whole objection to `String(error)` being
 * deleted without a replacement. The visual cost is bounded by the disclosure's
 * own `max-height` plus `overflow: auto`, not by a character cap, because a cap
 * costs the operator the tail of a body that may be the part that matters. The
 * one place a cap earns its keep is a `console.warn` companion, which has no
 * scroll container.
 */
export function errorDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const head = `${error.status} from ${error.service} ${error.path}`;
  // `ApiError`'s constructor substitutes a placeholder message for an empty
  // body, so an empty body here is merely useless rather than noisy — omit the
  // separator entirely rather than rendering a dangling em dash.
  return error.body ? `${head} — ${error.body}` : head;
}

/**
 * A render-crash boundary's disclosure — #116.
 *
 * `app/error.tsx`, `app/global-error.tsx` and `ErrorBoundary` used to render
 * `error.message` directly, which for an `ApiError` IS the raw upstream body
 * (`fetcher.ts`'s constructor: `super(body || ...)`) — the exact string this
 * module exists to keep out of a primary sentence. But `errorDiagnostic` alone
 * is the wrong replacement here: it returns `undefined` for anything that
 * isn't an `ApiError`, and the reachable crash case at a render boundary is
 * ordinarily a plain `TypeError` from React itself — using `errorDiagnostic`
 * alone would delete that message entirely rather than demote it.
 *
 * So this composes both: an `ApiError` gets the same upstream-bytes string
 * `errorDiagnostic` gives every other surface (one diagnostic vocabulary, not
 * two), anything else that is at least an `Error` gets its own `name` and
 * `message` (`TypeError: Cannot read properties of undefined`), and Next's own
 * `digest` — present only in production, where the original message is
 * stripped server-side — is appended when given, to either case or to neither.
 * `undefined` only for a throw that is both a non-`Error` and digest-less (a
 * bare string/object thrown, with no digest to show in its place) — the one
 * case with truly nothing to disclose.
 */
export function crashDiagnostic(error: unknown, digest?: string): string | undefined {
  const base = errorDiagnostic(error) ?? (error instanceof Error ? `${error.name}: ${error.message}` : undefined);
  const digestLine = digest ? `Digest: ${digest}` : undefined;
  if (base && digestLine) return `${base}\n\n${digestLine}`;
  return base ?? digestLine;
}

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
    return CONSOLE_FAULT;
  }
  // #91's other half. Until the redirect learned to read the provenance stamp,
  // a stamped 401 navigated away before any surface could render it, so this
  // arm was unreachable and the status fell through to GENERIC. Now that an
  // upstream 401 stays on the page, it needs to say the one actionable thing:
  // the key is server-side and invisible, so the operator cannot discover it.
  //
  // Gated on the service for the same reason the generic function is, even
  // though both of today's callers fetch from the control plane: this console
  // sends a registry no credentials at all, so a registry 401 here must not
  // become "rejected this console's credentials". `/contexts` already talks to
  // registries for search, so the day a registry error reaches this function is
  // not far off, and an ungated arm would reintroduce that claim silently.
  if (status === 401) {
    if (error.service === 'control-plane')
      return `The control plane rejected this console's credentials. ${CONTROL_PLANE_KEY_REJECTED}`;
    return `${SERVICE_LABEL[error.service]} requires credentials this console does not send.`;
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
    // The registry's own vocabulary, second. Both context surfaces can reach a
    // registry DIRECTLY — `searchContexts` calls `authToService(authority)`
    // (`client.ts:645`) rather than going through the control plane — so a
    // registry code arrives here as readily as a control-plane one.
    //
    // This lookup is what makes the two cursor entries real rather than
    // decorative. `/contexts`' "Load more" is the ONLY path in this console
    // that sends a cursor, so before this line an expired cursor fell all the
    // way through to `GENERIC` — `Could not load context.` — on the one surface
    // that could produce it, while the strings naming the recovery sat in a map
    // wired to a route with no cursor parameter. The gate caught that; it is
    // the "copy no real request can exercise" class the test-hygiene work is
    // about, and the fix is a consumer, not a deletion.
    //
    // Control-plane codes win because they are the more specific claim when
    // both could apply: `CONTEXT_BINDING_UNVERIFIABLE` describes what the
    // federation proxy established about a body, which no registry-side code
    // can restate. The two vocabularies do not collide today (SCREAMING_SNAKE
    // vs lowercase snake_case) and `api-error-messages.test.ts` asserts the
    // key sets are disjoint, so the ordering is a tie-break that never fires
    // rather than a precedence anyone has to reason about.
    const fromRegistry = REGISTRY_ERROR_CODES.get(error.errorCode);
    if (fromRegistry) return fromRegistry;
  }
  return contextErrorFallback(error);
}
