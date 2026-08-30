// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { SESSION_COOKIE_NAME } from '@/lib/server/session';

const PASSWORD = 'correct-horse-battery-staple';

function loginRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/auth/login', () => {
  it('sets an HttpOnly SameSite=Lax cookie and returns 200 for the correct passphrase', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const res = await login(loginRequest({ passphrase: PASSWORD }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('returns 401 and sets no cookie for an incorrect passphrase', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const res = await login(loginRequest({ passphrase: 'wrong' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 503 when ACDP_UI_CONSOLE_PASSWORD is unset in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', '');
    const res = await login(loginRequest({ passphrase: 'anything' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('never echoes the passphrase in the response body, success or failure', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const okRes = await login(loginRequest({ passphrase: PASSWORD }));
    const okBody = await okRes.text();
    expect(okBody).not.toContain(PASSWORD);

    const failRes = await login(loginRequest({ passphrase: 'wrong-but-secret-guess' }));
    const failBody = await failRes.text();
    expect(failBody).not.toContain(PASSWORD);
    expect(failBody).not.toContain('wrong-but-secret-guess');
  });

  it('rejects a non-string passphrase with 401, not a 500', async () => {
    vi.stubEnv('ACDP_UI_CONSOLE_PASSWORD', PASSWORD);
    const res = await login(loginRequest({ passphrase: 12345 }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await logout();
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
