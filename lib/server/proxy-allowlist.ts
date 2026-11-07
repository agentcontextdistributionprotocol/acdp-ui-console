import type { ProxyService } from '@/lib/types';

// The console has no user authentication of its own, so this route is the
// entire perimeter around a privileged upstream (control-plane requests carry
// the server-side bearer token below). It is deliberately NOT a generic
// reverse proxy: each service only forwards the exact (method, path) pairs
// `lib/api/client.ts` actually issues. Anything else — including paths that
// happen to exist upstream but the console never calls — is rejected before a
// request is ever sent out, so a leaked/guessed URL can't reach arbitrary
// upstream surface with the injected credential attached.
/**
 * Who may call a route when `ACDP_UI_PUBLIC_MODE` is on. `public`: anyone,
 * rate-limited per IP. `admin`: a signed-in operator only; an anonymous caller
 * gets 403 `CONSOLE_OPERATOR_SESSION_REQUIRED`. With the flag off every route
 * needs the operator session, as before. Required on every entry, so a new
 * route cannot be added without deciding.
 */
export type RouteAccess = 'public' | 'admin';

/** Which rate-limit policy (`lib/server/rate-limit.ts`) a request spends, besides `read`. */
export type RouteLimit = 'read' | 'launch';

export interface RouteMatcher {
  method: string;
  pattern: RegExp;
  access: RouteAccess;
  limit: RouteLimit;
}

const REGISTRY_ROUTES: readonly RouteMatcher[] = [
  { method: 'GET', pattern: /^\/healthz$/, access: 'public', limit: 'read' },
  { method: 'GET', pattern: /^\/contexts\/search$/, access: 'public', limit: 'read' },
  { method: 'GET', pattern: /^\/lineages\/[^/]+$/, access: 'public', limit: 'read' },
  { method: 'GET', pattern: /^\/lineages\/[^/]+\/current$/, access: 'public', limit: 'read' },
  { method: 'GET', pattern: /^\/\.well-known\/acdp\.json$/, access: 'public', limit: 'read' },
  { method: 'GET', pattern: /^\/\.well-known\/jwks\.json$/, access: 'public', limit: 'read' },
  // The registry's OWN did:web DID document (its receipt / checkpoint keys),
  // read by `getRegistryDidDocument` and accepted only by
  // `lib/verify/did-docs.ts`. A fixed literal on the configured registry base
  // URL — deliberately no route here (or on any service) takes a DID or host
  // to fetch, which would turn this proxy into an SSRF primitive. Producer and
  // witness DID documents on other hosts are therefore never fetched.
  { method: 'GET', pattern: /^\/\.well-known\/did\.json$/, access: 'public', limit: 'read' },
];

export const ALLOWED_ROUTES: Readonly<Record<ProxyService, readonly RouteMatcher[]>> = {
  playground: [
    { method: 'GET', pattern: /^\/healthz$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/scenarios$/, access: 'public', limit: 'read' },
    { method: 'POST', pattern: /^\/runs$/, access: 'public', limit: 'launch' },
    { method: 'GET', pattern: /^\/runs\/[^/]+$/, access: 'public', limit: 'read' },
  ],
  'control-plane': [
    { method: 'GET', pattern: /^\/healthz$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/dashboard\/overview$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/runs$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/runs\/[^/]+$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/runs\/[^/]+\/lineage$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/runs\/[^/]+\/events$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/events$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/agents$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/registries$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/registries\/enrollments$/, access: 'admin', limit: 'read' },
    { method: 'POST', pattern: /^\/registries\/enroll$/, access: 'admin', limit: 'read' },
    // Transparency-log witness state, read-only, in two shapes that look
    // alike and are not: per-authority state, and the collection-level alert
    // worklist. Neither pattern can admit the other's shape, because they
    // differ in the segment that is fixed:
    //
    //   /registries/:authority/log-witness   — `log-witness` is segment THREE
    //   /registries/log-witness/alerts       — `log-witness` is segment TWO
    //
    // so the per-authority pattern only matches a path ENDING in
    // `/log-witness`, which `.../alerts` does not, and the collection pattern
    // is a fixed three-segment literal with no variable part at all.
    //
    // `[^/]+` IS right for the authority: it is a DNS name, which contains
    // dots but never slashes — the opposite of the ctx_id case below. Both
    // patterns are `$`-anchored, which is what stops either from growing a
    // tail — including growing into the admin `:authority/log-witness/ack`
    // sibling, which is allow-listed separately below as a POST and must not
    // become reachable by GET.
    //
    // Upstream declares `log-witness/alerts` BEFORE `:authority/log-witness`
    // (`registries.controller.ts:51` and `:117`). ROUND 7's N11: an earlier
    // version of this comment said that ordering "is why Nest does not swallow
    // `log-witness` as an `:authority` there", and that causal claim is wrong.
    // The two routes are DISJOINT whatever order they are declared in:
    // `:authority/log-witness` requires the segment after the authority to be
    // the literal `log-witness`, and in `/registries/log-witness/alerts` that
    // segment is `alerts`. Declaration order decides nothing here, so an
    // upstream refactor that reorders them changes nothing — which is a
    // stronger statement than the one it replaces, and it is the one this file
    // should have been making. (Order-dependence between those two WOULD
    // matter for a hypothetical `GET :authority/log-witness/alerts`; upstream
    // serves no such route, which is the next paragraph's point.)
    // Our own matching is order-independent regardless (`some` at
    // `isAllowedRoute`) — but do not "simplify" these two into one pattern on
    // the strength of any of that. There is no per-authority `alerts` route upstream, so
    // widening the collection pattern's middle segment to `[^/]+` would admit
    // a shape the control plane does not serve; the route test asserts that
    // case by name, alongside three other widenings, and four adjacent shapes
    // around the per-authority pattern.
    // (`/registries/enrollments` needs no such guard — it is allow-listed on
    // its own line above, so neither pattern can admit or deny it.)
    { method: 'GET', pattern: /^\/registries\/[^/]+\/log-witness$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/registries\/log-witness\/alerts$/, access: 'public', limit: 'read' },
    // Acknowledging one authority's alert (#84). One of five patterns in this
    // file with a variable segment in the MIDDLE (`/lineages/[^/]+/current`,
    // `/runs/[^/]+/lineage`, `/runs/[^/]+/events`, the per-authority read
    // above, and this), so it carries the same over-reach risk and gets the
    // same treatment: `[^/]+` for a DNS authority, `$`-anchored, and the route
    // test asserts the adjacent shapes out — a multi-segment authority, a
    // tail, GET on this path, and each of the two literal segments widened to
    // `[^/]+` in turn.
    //
    // POST, and the ONLY write this console issues under `/registries/` other
    // than `enroll`. It carries no body: upstream takes no `@Body()` and
    // derives the acknowledger server-side from the caller's own token, so
    // there is nothing for a client to send and nothing for this route to
    // forward beyond the path itself.
    { method: 'POST', pattern: /^\/registries\/[^/]+\/log-witness\/ack$/, access: 'admin', limit: 'read' },
    { method: 'GET', pattern: /^\/metrics$/, access: 'admin', limit: 'read' },
    { method: 'GET', pattern: /^\/webhooks$/, access: 'admin', limit: 'read' },
    { method: 'POST', pattern: /^\/webhooks$/, access: 'admin', limit: 'read' },
    { method: 'PATCH', pattern: /^\/webhooks\/[^/]+$/, access: 'admin', limit: 'read' },
    { method: 'DELETE', pattern: /^\/webhooks\/[^/]+$/, access: 'admin', limit: 'read' },
    // ctx_id is an `acdp://authority/uuid` URI (see lib/api/client.ts's
    // getContext) — it contains slashes, so this must NOT be `[^/]+`.
    { method: 'GET', pattern: /^\/contexts\/.+$/, access: 'public', limit: 'read' },
    { method: 'GET', pattern: /^\/auth\/revocations$/, access: 'admin', limit: 'read' },
  ],
  'registry-a': REGISTRY_ROUTES,
  'registry-b': REGISTRY_ROUTES,
};

/**
 * The allow-list entry for this exact (service, method, decoded pathname), or
 * `undefined`. Call it only after the route's traversal guards, on the
 * Next-decoded path: access is classified on the same string the upstream
 * URL is built from, so an encoded variant cannot be classified one way and
 * fetched another.
 */
export function matchRoute(service: ProxyService, method: string, pathname: string): RouteMatcher | undefined {
  return ALLOWED_ROUTES[service].find((r) => r.method === method && r.pattern.test(pathname));
}
