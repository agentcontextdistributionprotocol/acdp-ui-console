import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Real-backend integration suite. Runs the actual Next.js app — built and
// started exactly as the deployed image is (`next build && next start`, so
// NEXT_PUBLIC_ACDP_UI_DEMO_MODE=false is genuinely baked in, not a dev-mode
// approximation) — against a real acdp-playground `make up-full` stack, and
// asserts that real backend data renders on real pages. See
// test/integration/README.md for the one-time setup this requires.
const PORT = process.env.ACDP_UI_INTEGRATION_PORT ?? '3100';
const BASE_URL = `http://localhost:${PORT}`;

// Matches acdp-playground/docker-compose.full.yml's defaults exactly, so a
// stack booted with no .env overrides just works. Override via env if a
// developer's stack uses different values.
const PLAYGROUND_URL = process.env.PLAYGROUND_URL ?? 'http://localhost:8000';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3001';
const REGISTRY_A_URL = process.env.REGISTRY_A_URL ?? 'http://localhost:8100';
const REGISTRY_B_URL = process.env.REGISTRY_B_URL ?? 'http://localhost:8200';
// `playground-cp-admin` is docker-compose.full.yml's CONTROL_PLANE_ADMIN_TOKEN
// default, which is ALSO listed in the CP's AUTH_API_KEYS — so this one token
// authenticates every proxied control-plane call, admin routes included
// (the revocation feed, enrollment admin actions), giving the suite the
// fullest real surface to assert against instead of exercising the 403 path.
const CONTROL_PLANE_API_KEY = process.env.CONTROL_PLANE_API_KEY ?? 'playground-cp-admin';
export const ACDP_UI_CONSOLE_PASSWORD =
  process.env.ACDP_UI_CONSOLE_PASSWORD ?? 'acdp-ui-console-integration-test-passphrase';

export default defineConfig({
  testDir: './test/integration',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: require.resolve('./test/integration/global-setup.ts'),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    storageState: path.join(__dirname, 'test/integration/.auth/session.json'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Faithful to the real deployment (Dockerfile / docker-compose.full.yml's
    // ui-console service): a production build with demo mode inlined off,
    // not `next dev`'s always-fail-open auth gate.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_ACDP_UI_DEMO_MODE: 'false',
      PLAYGROUND_BASE_URL: PLAYGROUND_URL,
      CONTROL_PLANE_BASE_URL: CONTROL_PLANE_URL,
      REGISTRY_A_BASE_URL: REGISTRY_A_URL,
      REGISTRY_B_BASE_URL: REGISTRY_B_URL,
      CONTROL_PLANE_API_KEY,
      ACDP_UI_CONSOLE_PASSWORD,
    },
  },
});
