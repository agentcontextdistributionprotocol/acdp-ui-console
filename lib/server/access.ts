import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { ProxyService } from '@/lib/types';
import type { RouteAccess, RouteLimit } from '@/lib/server/proxy-allowlist';
import { getClientIp, UNKNOWN_CLIENT_IP } from '@/lib/server/client-ip';
import { isPublicMode } from '@/lib/server/public-mode';
import {
  consoleRateLimiter,
  INSTANCE_KEY,
  rateLimitKey,
  type FixedWindowRateLimiter,
  type RateLimitCheck,
} from '@/lib/server/rate-limit';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/server/session';
import type { ControlPlaneCredential } from '@/lib/server/integrations';

/**
 * The access decision for one proxy or stream request, made in the Node route
 * handler after the route's own traversal guards and allow-list match, so it
 * classifies exactly the decoded path the upstream URL is built from.
 *
 * `middleware.ts` gates first, but edge middleware and this handler read the
 * environment separately, so this re-checks the session itself (defence in
 * depth): a skew between the two can never open anything.
 *
 * - Flag off: every route needs the operator session, as before; no rate
 *   limits. (Development with no password keeps its fail-open.)
 * - Flag on: `public` routes are open to anyone, `admin` routes need the
 *   session (anonymous → 403, never 401, so the browser's 401 → /login
 *   redirect does not bounce public visitors). Every request, operator or
 *   not, spends per-IP rate-limit tokens; an anonymous control-plane request
 *   also spends the per-IP and per-instance `cp-read` budget.
 *
 * Every refusal here is minted by the console, so none carries the
 * `x-acdp-ui-proxy` stamp.
 */

export interface AccessRequest {
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
}

export interface AccessTarget {
  service: ProxyService;
  method: string;
  path: string;
  access: RouteAccess;
  limit: RouteLimit;
}

export type AccessDecision =
  | {
      ok: true;
      /** A signed-in operator (or the development fail-open). */
      operator: boolean;
      publicMode: boolean;
      clientIp: string;
    }
  | { ok: false; response: Response };

export const OPERATOR_SESSION_REQUIRED = 'CONSOLE_OPERATOR_SESSION_REQUIRED';
export const RATE_LIMITED = 'CONSOLE_RATE_LIMITED';
export const AUTH_NOT_CONFIGURED = 'CONSOLE_AUTH_NOT_CONFIGURED';

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function rateLimitedResponse(retryAfterSeconds: number, limit: number): Response {
  return json(
    429,
    {
      error: `Too many requests from your address. Try again in ${retryAfterSeconds} s.`,
      errorCode: RATE_LIMITED,
      retryAfterSeconds,
      limit,
    },
    { 'retry-after': String(retryAfterSeconds) },
  );
}

export async function decideAccess(
  request: AccessRequest,
  target: AccessTarget,
  deps: { limiter?: FixedWindowRateLimiter; env?: Record<string, string | undefined> } = {},
): Promise<AccessDecision> {
  const env = deps.env ?? process.env;
  const limiter = deps.limiter ?? consoleRateLimiter;
  const publicMode = isPublicMode(env);
  const password = env.ACDP_UI_CONSOLE_PASSWORD;
  const production = env.NODE_ENV === 'production';
  const clientIp = getClientIp(request.headers, env);
  const refuse = (status: number, reason: string, body: Record<string, unknown>, headers?: Record<string, string>) => {
    logRefusal(status, reason, target, clientIp, password);
    return { ok: false as const, response: json(status, body, headers) };
  };

  let operator: boolean;
  if (!password) {
    if (!production) {
      // Development fail-open, exactly as `middleware.ts` (which logs it).
      return { ok: true, operator: true, publicMode, clientIp };
    }
    // Production with no passphrase: nobody can sign in, so nothing that
    // needs the operator can run. With the flag on, public routes still work.
    if (!publicMode || target.access === 'admin') {
      return refuse(503, 'auth-not-configured', {
        error: 'ACDP_UI_CONSOLE_PASSWORD is not configured on this deployment.',
        errorCode: AUTH_NOT_CONFIGURED,
      });
    }
    operator = false;
  } else {
    operator = await verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, password);
  }

  if (!publicMode) {
    if (!operator) return refuse(401, 'no-session', { error: 'Unauthorized: sign in at /login required.' });
    return { ok: true, operator, publicMode, clientIp };
  }

  if (target.access === 'admin' && !operator) {
    return refuse(403, 'admin-route', {
      error: 'Operator sign-in required: this is an operator-only action.',
      errorCode: OPERATOR_SESSION_REQUIRED,
    });
  }

  const key = rateLimitKey(clientIp);
  const checks: RateLimitCheck[] = [{ policy: 'read', key }];
  if (target.limit === 'launch') checks.push({ policy: 'launch', key });
  if (!operator && target.service === 'control-plane') {
    checks.push({ policy: 'cp-read-ip', key }, { policy: 'cp-read', key: INSTANCE_KEY });
  }
  const result = limiter.consume(checks);
  if (!result.allowed) {
    logRefusal(429, `rate-limited:${result.policy}`, target, clientIp, password);
    return { ok: false, response: rateLimitedResponse(result.retryAfterSeconds, result.limit) };
  }
  return { ok: true, operator, publicMode, clientIp };
}

/**
 * The control-plane credential for a request: the admin key for the operator
 * (and in flag-off mode, where every caller is the operator), the read key for
 * an anonymous public-mode visitor. Until the read key is registered with the
 * control plane it may be unset; then the admin key is used and the fallback
 * is logged, so the console keeps working before and after that rollout.
 */
export function controlPlaneCredential(operator: boolean, env: Record<string, string | undefined> = process.env): ControlPlaneCredential {
  if (operator) return 'admin';
  if (env.CONTROL_PLANE_READ_API_KEY) return 'read';
  logCredentialFallback('unset');
  return 'admin';
}

const FALLBACK_LOG_INTERVAL_MS = 10 * 60_000;
const lastFallbackLog = new Map<string, number>();

/**
 * Logs (at most once per reason per 10 minutes) that an anonymous control-plane
 * request used the admin key: `unset` (no CONTROL_PLANE_READ_API_KEY) or
 * `rejected` (the control plane answered 401 to the read key).
 */
export function logCredentialFallback(reason: 'unset' | 'rejected', now: number = Date.now()): void {
  const last = lastFallbackLog.get(reason);
  if (last !== undefined && now - last < FALLBACK_LOG_INTERVAL_MS) return;
  lastFallbackLog.set(reason, now);
  console.warn(
    reason === 'unset'
      ? '[ACDP UI] CONTROL_PLANE_READ_API_KEY is not set; anonymous control-plane reads fell back to CONTROL_PLANE_API_KEY.'
      : '[ACDP UI] The control plane rejected CONTROL_PLANE_READ_API_KEY (401); anonymous control-plane reads fell back to CONTROL_PLANE_API_KEY. Register the read key in the control plane AUTH_API_KEYS.',
  );
}

/** Test hook: forget the fallback-log throttle. */
export function resetCredentialFallbackLog(): void {
  lastFallbackLog.clear();
}

let ephemeralTagKey: Buffer | undefined;

/**
 * A short, stable tag for a client IP in logs: HMAC-SHA256 under a key
 * HKDF-derived from the console password (a random per-process key when there
 * is none), truncated. Never a plain hash, which a log reader could reverse by
 * hashing the IPv4 space.
 */
export function ipTag(ip: string, password: string | undefined): string {
  if (ip === UNKNOWN_CLIENT_IP) return UNKNOWN_CLIENT_IP;
  const key = password
    ? Buffer.from(hkdfSync('sha256', password, 'acdp-ui-console-iptag-v1', 'acdp-ui-console-iptag', 32))
    : (ephemeralTagKey ??= randomBytes(32));
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 12);
}

function logRefusal(status: number, reason: string, target: AccessTarget, ip: string, password: string | undefined): void {
  console.info(
    `[ACDP UI] ${status} ${reason} service=${target.service} method=${target.method} path=${target.path} ip=${ipTag(ip, password)}`,
  );
}
