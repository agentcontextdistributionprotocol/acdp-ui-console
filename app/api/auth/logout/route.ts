import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Clears the operator session cookie. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
