import { test, expect, type APIResponse, type Page } from '@playwright/test';

// The anonymous visitor on the ACDP_UI_PUBLIC_MODE=on server (playwright.config
// project `public`): no session cookie, a random per-run client IP in
// `x-real-ip` (ACDP_UI_CLIENT_IP_HEADER), and a real playground stack that
// enforces PLAYGROUND_API_KEY, so every successful playground call here
// proves the console sent the key.
//
// Serial and ordered: the console allows 5 launches per IP per 10 minutes,
// and the 429 test spends what the launch and quota tests leave.

test.describe.configure({ mode: 'serial' });

/** A console-minted answer never carries the provenance stamp. */
function expectConsoleAnswer(res: APIResponse, status: number) {
  expect(res.status()).toBe(status);
  expect(res.headers()['x-acdp-ui-proxy']).toBeUndefined();
}

async function launchFromUi(page: Page, scenarioName: RegExp): Promise<string> {
  await page.goto('/scenarios');
  const card = page.locator('.scenario-card').filter({ has: page.locator('.sc-name', { hasText: scenarioName }) }).first();
  await card.locator('.sc-run-btn').click();
  await page.getByRole('button', { name: /Run scenario/ }).click();
  await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 15_000 });
  return new URL(page.url()).pathname.split('/').pop()!;
}

const COMPLETE_BADGE = (page: Page) => page.locator('.badge').filter({ hasText: /^\W*complete$/ }).first();

test.describe('Public mode: anonymous visitor (real production build)', () => {
  test('reads the dashboard, runs and contexts without signing in, and is offered Sign in', async ({ page }) => {
    const session = await page.request.get('/api/auth/session');
    expect(await session.json()).toEqual({ publicMode: true, signedIn: false });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: /Sign in/ })).toBeVisible();

    // Real data through the anonymous proxy, then the page renders it.
    const runs = await page.request.get('/api/proxy/control-plane/runs?limit=5');
    expect(runs.status()).toBe(200);
    expect(runs.headers()['x-acdp-ui-proxy']).toBe('control-plane');
    const { data } = (await runs.json()) as { data: { runId: string }[] };
    expect(data.length).toBeGreaterThan(0);
    await page.goto('/runs');
    await expect(page.getByText('Could not load the run list')).not.toBeVisible();
    await expect(page.getByRole('button', { name: `Open run ${data[0].runId}` })).toBeVisible();

    // Registry reads go through the playground's key-gated passthrough.
    const search = await page.request.get('/api/proxy/registry-a/contexts/search?limit=5');
    expect(search.status()).toBe(200);
    expect(search.headers()['x-acdp-ui-proxy']).toBe('registry-a');
    await page.goto('/contexts');
    await expect(page.getByText('No contexts found')).not.toBeVisible();
  });

  test('launches s1 from the UI and sees it complete', async ({ page }) => {
    const runId = await launchFromUi(page, /^Single Publish$/);
    await expect(COMPLETE_BADGE(page)).toBeVisible({ timeout: 60_000 });
    // The control plane's own record agrees: this anonymous launch really ran.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/proxy/control-plane/runs/${runId}`);
          return res.ok() ? ((await res.json()) as { status?: string }).status : `http ${res.status()}`;
        },
        { timeout: 60_000 },
      )
      .toBe('completed');
    await expect(page.getByText(/Could not load this run/)).toHaveCount(0);
  });

  test('the LLM quota badge shows when the playground falls back to mock (ACDP_INTEGRATION_LLM_QUOTA=1)', async ({ page }) => {
    // Needs a real-provider stack with LLM_QUOTA_PER_IP_PER_DAY=1 (run via
    // /live-test): this IP's first real LLM call spends the quota, the rest
    // of its calls run on the mock.
    test.skip(process.env.ACDP_INTEGRATION_LLM_QUOTA !== '1', 'needs a real-provider stack with LLM_QUOTA_PER_IP_PER_DAY=1');
    const chip = page.getByText(/LLM quota reached: mock responses \((resets .+|quota store unavailable)\)/);
    for (let attempt = 0; attempt < 2; attempt++) {
      await launchFromUi(page, /^Single Publish$/);
      await expect(COMPLETE_BADGE(page)).toBeVisible({ timeout: 120_000 });
      if (await chip.count()) break;
    }
    await expect(chip).toBeVisible();
  });

  test('operator-only routes answer 403 CONSOLE_OPERATOR_SESSION_REQUIRED, and the page says to sign in', async ({ page, baseURL }) => {
    for (const path of ['/api/proxy/control-plane/metrics', '/api/proxy/control-plane/webhooks', '/api/proxy/control-plane/auth/revocations']) {
      const res = await page.request.get(path);
      expectConsoleAnswer(res, 403);
      expect(((await res.json()) as { errorCode?: string }).errorCode, path).toBe('CONSOLE_OPERATOR_SESSION_REQUIRED');
    }
    const enroll = await page.request.post('/api/proxy/control-plane/registries/enroll', {
      headers: { origin: baseURL! },
      data: { authority: 'x.example' },
    });
    expectConsoleAnswer(enroll, 403);

    // Off the allow-list entirely: refused, never forwarded.
    expectConsoleAnswer(await page.request.get('/api/proxy/control-plane/admin/x'), 403);

    await page.goto('/security');
    await expect(page.getByText('This action needs the operator sign-in. Sign in at /login.').first()).toBeVisible();
  });

  test('the launch limit answers 429 with Retry-After, and the launch modal says so in plain words', async ({ page, baseURL }) => {
    // An unknown scenario id spends a console launch token without starting a run.
    let limited: APIResponse | undefined;
    for (let i = 0; i < 8 && !limited; i++) {
      const res = await page.request.post('/api/proxy/playground/runs', {
        headers: { origin: baseURL! },
        data: { scenario_id: 'acdp-ui-console-integration-no-such-scenario' },
      });
      if (res.status() === 429 && res.headers()['x-acdp-ui-proxy'] === undefined) limited = res;
    }
    expect(limited, 'the console launch limiter answered 429 within 8 launches').toBeTruthy();
    expect(((await limited!.json()) as { errorCode?: string }).errorCode).toBe('CONSOLE_RATE_LIMITED');
    expect(Number(limited!.headers()['retry-after'])).toBeGreaterThan(0);

    await page.goto('/scenarios');
    await page.locator('.scenario-card .sc-run-btn').first().click();
    await page.getByRole('button', { name: /Run scenario/ }).click();
    await expect(
      page.getByText(/Too many requests from your network|Run launch limit reached|The playground is already running/),
    ).toBeVisible();
  });
});
