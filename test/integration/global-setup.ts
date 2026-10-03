import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ACDP_UI_CONSOLE_PASSWORD } from '../../playwright.config';

const PLAYGROUND_URL = process.env.PLAYGROUND_URL ?? 'http://localhost:8000';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3001';
const REGISTRY_A_URL = process.env.REGISTRY_A_URL ?? 'http://localhost:8100';
const REGISTRY_B_URL = process.env.REGISTRY_B_URL ?? 'http://localhost:8200';

const AUTH_FILE = path.join(__dirname, '.auth', 'session.json');

// Scenarios chosen to give the three spec files (dashboard/registries/
// security) real, non-empty data on every surface they assert against:
// s1 (plain publish → dashboard KPI/recent-runs), s5 (cross-registry → both
// registry-a AND registry-b get traffic, so both RegistryCards + both JWKS
// cards have something to show), s22 (receipts → receipt coverage bars +
// trust signals feed the control-plane audit that the Security page reads).
const SEED_SCENARIOS = ['s1_single_publish', 's5_cross_registry', 's22_receipts'];

async function requireReachable(name: string, url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      throw new Error(`${name} answered ${res.status} at ${url}`);
    }
  } catch (err) {
    throw new Error(
      `acdp-ui-console integration suite: ${name} is not reachable at ${url}.\n` +
        `This suite drives the real app against a real backend stack — it does not mock anything.\n` +
        `Start it from the sibling repo first:\n` +
        `  cd ../acdp-playground && LLM_PROVIDER=mock make up-full\n` +
        `(LLM_PROVIDER=mock avoids real LLM billing; this suite only needs real protocol\n` +
        `shapes flowing through the real registries/control-plane, not real model output.)\n` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function seedRealData(): Promise<void> {
  for (const scenarioId of SEED_SCENARIOS) {
    const startRes = await fetch(`${PLAYGROUND_URL}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    if (!startRes.ok) {
      throw new Error(
        `seed: failed to start scenario ${scenarioId}: ${startRes.status} ${await startRes.text()}`
      );
    }
    const { run_id: runId } = (await startRes.json()) as { run_id: string };

    const deadline = Date.now() + 60_000;
    for (;;) {
      const pollRes = await fetch(`${PLAYGROUND_URL}/runs/${runId}`);
      if (!pollRes.ok) {
        throw new Error(`seed: failed to poll run ${runId} for ${scenarioId}: ${pollRes.status}`);
      }
      const body = (await pollRes.json()) as { status: string };
      if (body.status !== 'running') {
        if (body.status !== 'complete') {
          throw new Error(`seed: scenario ${scenarioId} (run ${runId}) ended as ${body.status}, expected complete`);
        }
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(`seed: scenario ${scenarioId} (run ${runId}) did not finish within 60s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function saveAuthenticatedSession(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto('/login');
    await page.locator('input[type="password"]').fill(ACDP_UI_CONSOLE_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Successful login navigates away from /login (app/page.tsx server-redirects
    // '/' to '/dashboard' — see CLAUDE.md's Naming rules).
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    await context.storageState({ path: AUTH_FILE });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await Promise.all([
    requireReachable('playground', `${PLAYGROUND_URL}/scenarios`),
    requireReachable('control-plane', `${CONTROL_PLANE_URL}/healthz`),
    requireReachable('registry-a', `${REGISTRY_A_URL}/healthz`),
    requireReachable('registry-b', `${REGISTRY_B_URL}/healthz`),
  ]);

  await seedRealData();

  const { baseURL } = config.projects[0].use;
  await saveAuthenticatedSession(baseURL as string);
}
