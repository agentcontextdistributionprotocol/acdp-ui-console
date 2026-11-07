import { isIP } from 'node:net';

/**
 * The end user's IP address, taken only from a header a TRUSTED proxy writes.
 *
 * The value is load-bearing beyond this console: it is forwarded to the
 * playground as `X-ACDP-Client-IP`, which charges its durable per-IP limits
 * (Postgres LLM quotas, per-IP run limit) against it whenever the request
 * carries a valid `x-api-key` (acdp-playground `playground/security.py`). A
 * header the visitor can set would let them pick a fresh bucket per request,
 * so the trust rule is deliberately narrow:
 *
 * - On Vercel (`VERCEL=1`), Vercel's edge overwrites `x-real-ip` and
 *   `x-vercel-forwarded-for`, and appends the connecting address as the
 *   RIGHTMOST `x-forwarded-for` entry (the leftmost entries are whatever the
 *   client sent). Same precedence as macp-ui-console `lib/server/rate-limit.ts`.
 * - Anywhere else (Docker / self-hosted), only the one header named by
 *   `ACDP_UI_CLIENT_IP_HEADER`, which the operator's reverse proxy must
 *   overwrite. Unset, there is no trustworthy client IP: the result is
 *   `UNKNOWN_CLIENT_IP`, the console's own limits fall back to one shared
 *   bucket (fail closed), and nothing is forwarded upstream.
 */
export const UNKNOWN_CLIENT_IP = 'unknown';

/** The header the playground reads the end-user address from. */
export const CLIENT_IP_HEADER = 'x-acdp-client-ip';

interface HeaderSource {
  get(name: string): string | null;
}

type Env = Record<string, string | undefined>;

function literal(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  // Strip an IPv6 zone index (fe80::1%eth0); the playground parses with
  // ipaddress.ip_address, which rejects one.
  const unzoned = trimmed.includes('%') ? trimmed.slice(0, trimmed.indexOf('%')) : trimmed;
  return isIP(unzoned) ? unzoned : undefined;
}

function firstEntry(value: string | null): string | undefined {
  return value ? literal(value.split(',')[0]) : undefined;
}

function lastEntry(value: string | null): string | undefined {
  if (!value) return undefined;
  const parts = value.split(',');
  return literal(parts[parts.length - 1]);
}

export function getClientIp(headers: HeaderSource, env: Env = process.env): string {
  if (env.VERCEL === '1') {
    return (
      literal(headers.get('x-real-ip')) ??
      firstEntry(headers.get('x-vercel-forwarded-for')) ??
      lastEntry(headers.get('x-forwarded-for')) ??
      UNKNOWN_CLIENT_IP
    );
  }
  const named = env.ACDP_UI_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) {
    // An x-forwarded-for style list: the trusted proxy appends, so take the
    // rightmost entry, exactly as on Vercel. A single-value header (x-real-ip)
    // has one entry, so this is the same thing.
    return lastEntry(headers.get(named)) ?? UNKNOWN_CLIENT_IP;
  }
  return UNKNOWN_CLIENT_IP;
}

/**
 * The value to send upstream as `X-ACDP-Client-IP`: one IP literal, or
 * `undefined` (send no header) for the unknown bucket. Never an XFF chain.
 */
export function upstreamClientIp(ip: string): string | undefined {
  if (ip === UNKNOWN_CLIENT_IP) return undefined;
  return literal(ip);
}
