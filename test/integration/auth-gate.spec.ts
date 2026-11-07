import { test, expect, type APIResponse } from '@playwright/test';
import { ACDP_UI_CONSOLE_PASSWORD } from '../../playwright.config';

// The passphrase gate (middleware.ts) against a real production build, from
// the console's side. acdp-playground's own live suite
// (tests/live/test_live_console_auth.py) already covers: default passphrase
// signs in and proxies one playground GET, a gated route with no session is
// 401, and a wrong passphrase gets no cookie. These specs cover what it does
// not: the control-plane leg (the one the proxy attaches the bearer to), the
// SSE relay, forged/tampered cookies, the CSRF Origin backstop, the
// allow-list, the cookie's own attributes, and the browser flow (401 →
// /login, sign out).
//
// Every request here starts with NO session: the suite-wide storageState
// would otherwise authenticate them.
test.use({ storageState: { cookies: [], origins: [] } });

const SESSION_COOKIE = 'acdp_ui_session';

// A console-minted refusal (middleware 401/403, the route's own 403) never
// carries the stamp; only a re-streamed upstream answer does. Asserting its
// absence proves the refusal happened at the console boundary and the
// request never reached a backend with the injected bearer.
function expectConsoleRefusal(res: APIResponse, status: number) {
  expect(res.status()).toBe(status);
  expect(res.headers()['x-acdp-ui-proxy']).toBeUndefined();
}

async function signIn(request: import('@playwright/test').APIRequestContext, baseURL: string) {
  const res = await request.post('/api/auth/login', {
    headers: { origin: baseURL },
    data: { passphrase: ACDP_UI_CONSOLE_PASSWORD },
  });
  expect(res.status()).toBe(200);
  return res;
}

test.describe('Auth gate (real production build)', () => {
  test('control-plane proxy and both SSE relays refuse a request with no session', async ({ request }) => {
    expectConsoleRefusal(await request.get('/api/proxy/control-plane/runs'), 401);
    expectConsoleRefusal(await request.get('/api/proxy/control-plane/auth/revocations'), 401);
    expectConsoleRefusal(await request.get('/api/stream/events'), 401);
    expectConsoleRefusal(await request.get('/api/stream/runs/any-run-id'), 401);
  });

  test('page routes are NOT gated (every page is client-rendered with no server data)', async ({ request }) => {
    for (const route of ['/login', '/dashboard', '/security']) {
      const res = await request.get(route);
      expect(res.status(), route).toBe(200);
    }
  });

  test('a forged or tampered session cookie is refused', async ({ request, baseURL }) => {
    const login = await signIn(request, baseURL!);
    const setCookie = login.headers()['set-cookie'] ?? '';
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)?.[1];
    expect(token, 'login must set the session cookie').toBeTruthy();

    const [payload, sig] = token!.split('.');
    // Same signature, a payload pushed far into the future.
    const forgedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * 365 * 864e5 })).toString('base64url');
    // Same payload, one signature character flipped.
    const flippedSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');

    for (const bad of [`${forgedPayload}.${sig}`, `${payload}.${flippedSig}`, 'not-a-token', `${payload}.`]) {
      const res = await request.get('/api/proxy/control-plane/runs', {
        headers: { cookie: `${SESSION_COOKIE}=${bad}` },
      });
      expectConsoleRefusal(res, 401);
    }
  });

  test('login sets an HttpOnly, SameSite=Lax cookie and never echoes the passphrase', async ({ request, baseURL }) => {
    const login = await signIn(request, baseURL!);
    const setCookie = login.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    // http://localhost: Secure would make the cookie unusable, so it must be off here.
    expect(setCookie).not.toMatch(/;\s*Secure/i);
    expect(await login.text()).not.toContain(ACDP_UI_CONSOLE_PASSWORD);

    const wrong = await request.post('/api/auth/login', {
      headers: { origin: baseURL! },
      data: { passphrase: `${ACDP_UI_CONSOLE_PASSWORD}-wrong` },
    });
    expect(wrong.status()).toBe(401);
    expect(await wrong.text()).not.toContain(ACDP_UI_CONSOLE_PASSWORD);
  });

  test('with a valid session: cross-origin writes and off-allow-list routes are refused before any upstream', async ({
    request,
    baseURL,
  }) => {
    await signIn(request, baseURL!);

    // Sanity: the session itself works and reaches the real control plane.
    const ok = await request.get('/api/proxy/control-plane/runs');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['x-acdp-ui-proxy']).toBe('control-plane');

    // CSRF backstop: a mutating request whose Origin is another site.
    expectConsoleRefusal(
      await request.post('/api/proxy/playground/runs', {
        headers: { origin: 'https://evil.example' },
        data: { scenario_id: 's1_single_publish' },
      }),
      403,
    );
    expectConsoleRefusal(
      await request.post('/api/proxy/control-plane/registries/enroll', {
        headers: { origin: 'https://evil.example' },
        data: {},
      }),
      403,
    );

    // Allow-list: real control-plane routes the console never needs, reached
    // with the admin bearer if the allow-list ever let them through.
    expectConsoleRefusal(await request.post('/api/proxy/control-plane/auth/token', { headers: { origin: baseURL! }, data: {} }), 403);
    // Traversal: a literal '../' is normalized away by the client before it
    // is sent, so only the percent-encoded spelling actually reaches the route.
    expectConsoleRefusal(await request.get('/api/proxy/control-plane/runs/x%2F..%2F..%2Fauth%2Frevocations'), 403);
    // Unknown service name.
    const unknown = await request.get('/api/proxy/not-a-service/healthz');
    expect(unknown.status()).toBeGreaterThanOrEqual(400);
    expect(unknown.headers()['x-acdp-ui-proxy']).toBeUndefined();
  });
});

test.describe('Auth flow in the browser (real production build)', () => {
  test('a session-less page bounces to /login, signs in, and signing out locks the proxy again', async ({
    page,
    context,
  }) => {
    await page.goto('/dashboard');
    // The dashboard's first proxied call 401s; lib/api/fetcher.ts sends the
    // browser to /login rather than rendering a false all-clear.
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    await page.locator('input[type="password"]').fill(`${ACDP_UI_CONSOLE_PASSWORD}-wrong`);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/incorrect passphrase/i)).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(false);

    await page.locator('input[type="password"]').fill(ACDP_UI_CONSOLE_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });

    const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    // HttpOnly means page script can never read it.
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
    expect((await page.request.get('/api/proxy/control-plane/runs')).status()).toBe(200);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE && c.value !== '')).toBe(false);
    expectConsoleRefusal(await page.request.get('/api/proxy/control-plane/runs'), 401);
  });
});
