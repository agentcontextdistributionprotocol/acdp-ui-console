import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  passphraseMatches,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the operator passphrase for a session cookie. Not covered by
 * `middleware.ts` (only /api/proxy and /api/stream are gated) — this route
 * IS the gate's entry point, so it can't be gated by itself.
 */
export async function POST(request: NextRequest) {
  const password = process.env.ACDP_UI_CONSOLE_PASSWORD;
  if (!password) {
    // No passphrase configured anywhere to check against — misconfigured,
    // not "wrong passphrase". Same 503-for-missing-config convention as
    // middleware.ts.
    return NextResponse.json(
      { error: 'Console authentication is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let passphrase: unknown;
  try {
    const body: unknown = await request.json();
    passphrase = (body as { passphrase?: unknown } | null)?.passphrase;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Never echo the submitted or configured passphrase back in any response.
  if (typeof passphrase !== 'string' || passphrase.length === 0 || !(await passphraseMatches(passphrase, password))) {
    return NextResponse.json({ error: 'Incorrect passphrase.' }, { status: 401 });
  }

  const token = await createSessionToken(password);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Secure only when the request itself is HTTPS, so local
    // http://localhost:3000 keeps working.
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
