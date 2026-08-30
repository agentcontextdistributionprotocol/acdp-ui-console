import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/server/session';

// Gates exactly the two server routes that attach the server-side
// CONTROL_PLANE_API_KEY bearer (or, for the playground stream, carry no
// token today but are gated anyway for uniformity) — never page routes.
// Every page is 'use client' with zero server-rendered data, so 100% of the
// privileged surface flows through these two route trees. See
// plans/wave4-ui-fixes.md Phase UI-6 ("Approach — finalized per Fable's
// one-way-door analysis") for the full rationale and rejected alternatives.
export const config = {
  matcher: ['/api/proxy/:path*', '/api/stream/:path*'],
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// `request.nextUrl.host` must NOT be used for this comparison: in both
// `next start` and the standalone server produced by this repo's own
// Dockerfile (`output: 'standalone'` — the GHCR image this repo actually
// publishes), Next synthesizes `nextUrl` from `localhost:$PORT` and never
// reflects the real `Host`/`X-Forwarded-Host` the request came in on. That
// makes the Origin check either a no-op (any Origin whose host happens to be
// `localhost:$PORT` passes) or a false-positive-403 machine (a legitimate
// same-origin request on a real hostname never matches `localhost:$PORT`).
//
// `X-Forwarded-Host` wins over `Host` when both are present: this image is
// meant to run behind a reverse proxy (nginx/Caddy/Traefik/an ALB — see
// README's Docker section), and proxies commonly rewrite the `Host` header
// on the upstream leg to their own backend address while relaying the
// original client-facing hostname — the one the browser's `Origin` will
// actually carry — in `X-Forwarded-Host`. Only the first entry of a
// comma-separated list is used (that's the hop closest to the client, i.e.
// the one the browser actually addressed; every subsequent hop is added by
// intermediate proxies further downstream, which are less relevant here).
// A deployment that puts an untrusted proxy in front of this app already
// has a bigger problem than this belt-and-suspenders CSRF check — the same
// caveat applies to any framework's use of `X-Forwarded-*`.
function resolveRequestHost(request: NextRequest): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) return forwardedHost.split(',')[0].trim();
  return request.headers.get('host');
}

export async function middleware(request: NextRequest) {
  const password = process.env.ACDP_UI_CONSOLE_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      // Misconfigured, not "unauthenticated" — there is no passphrase to
      // check a session against, so 401 (which implies "sign in and you'll
      // get through") would be misleading. Fail closed at REQUEST time
      // (never a boot-time throw), so a production deployment that never
      // calls /api/proxy or /api/stream — e.g. a pure demo deployment —
      // isn't forced to configure a password it doesn't need; the unused
      // privileged surface stays sealed either way.
      return jsonError(503, 'ACDP_UI_CONSOLE_PASSWORD is not configured on this deployment.');
    }
    // Fail-open in development: on localhost, anyone who can reach the
    // console can reach the backends directly, so a dev password protects
    // nothing while breaking this repo's zero-setup demo promise. The
    // warning is emitted per-request (not just once at boot) so it stays
    // visible in dev server logs however the dev server was started.
    console.warn(
      '[ACDP UI] ACDP_UI_CONSOLE_PASSWORD is not set — /api/proxy and /api/stream are UNAUTHENTICATED (development fail-open). Set it before deploying.',
    );
    return NextResponse.next();
  }

  // CSRF backstop for state-changing methods: if the browser sent an
  // Origin, it must match this request's own host. `SameSite=Lax` already
  // withholds the cookie from most cross-site requests; this is a
  // belt-and-suspenders check appropriate for a single-operator tool.
  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    const origin = request.headers.get('origin');
    if (origin) {
      let originHost: string | null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== resolveRequestHost(request)) {
        return jsonError(403, 'Forbidden: Origin does not match this host.');
      }
    }
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token, password))) {
    return jsonError(401, 'Unauthorized: sign in at /login required.');
  }

  return NextResponse.next();
}
