import { NextRequest, NextResponse } from 'next/server';
import { isPublicMode } from '@/lib/server/public-mode';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * What the UI chrome needs to know about access, and nothing else: whether
 * this deployment runs in public mode, and whether the caller holds a valid
 * operator session. Not gated (it lives outside /api/proxy and /api/stream),
 * returns no secret, and is never cached.
 */
export async function GET(request: NextRequest) {
  const password = process.env.ACDP_UI_CONSOLE_PASSWORD;
  const signedIn = password
    ? await verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, password)
    : false;
  return NextResponse.json(
    { publicMode: isPublicMode(), signedIn },
    { headers: { 'cache-control': 'no-store' } },
  );
}
