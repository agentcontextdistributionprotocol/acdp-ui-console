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
// A second server from the same build, with ACDP_UI_PUBLIC_MODE on, for the
// anonymous-visitor specs (test/integration/public/**).
export const PUBLIC_PORT = String(Number(PORT) + 1);
export const PUBLIC_BASE_URL = `http://localhost:${PUBLIC_PORT}`;

// Matches acdp-playground/docker-compose.full.yml's defaults exactly, so a
// stack booted with no .env overrides just works. Override via env if a
// developer's stack uses different values.
export const PLAYGROUND_URL = process.env.PLAYGROUND_URL ?? 'http://localhost:8000';
export const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3001';
export const REGISTRY_A_URL = process.env.REGISTRY_A_URL ?? 'http://localhost:8100';
export const REGISTRY_B_URL = process.env.REGISTRY_B_URL ?? 'http://localhost:8200';
// The playground's shared key. Boot the stack with the same value and
// PLAYGROUND_REQUIRE_API_KEY=true so the key and X-ACDP-Client-IP are really
// exercised (see test/integration/README.md). A test-only constant, not a secret.
export const PLAYGROUND_API_KEY = process.env.PLAYGROUND_API_KEY ?? 'acdp-ui-console-integration-playground-key';
// docker-compose.full.yml's non-admin CP key (in AUTH_API_KEYS, not in
// AUTH_ADMIN_API_KEYS): what the public server uses for anonymous CP reads.
export const CONTROL_PLANE_READ_API_KEY = process.env.CONTROL_PLANE_READ_API_KEY ?? 'playground-cp-api-key';
// `playground-cp-admin` is docker-compose.full.yml's CONTROL_PLANE_ADMIN_TOKEN
// default, which is ALSO listed in the CP's AUTH_API_KEYS — so this one token
// authenticates every proxied control-plane call, admin routes included
// (the revocation feed, enrollment admin actions), giving the suite the
// fullest real surface to assert against instead of exercising the 403 path.
export const CONTROL_PLANE_API_KEY = process.env.CONTROL_PLANE_API_KEY ?? 'playground-cp-admin';
export const ACDP_UI_CONSOLE_PASSWORD =
  process.env.ACDP_UI_CONSOLE_PASSWORD ?? 'acdp-ui-console-integration-test-passphrase';

// One per run, from 198.18.0.0/15 (RFC 2544 benchmarking range).
export const RUN_CLIENT_IP =
  process.env.ACDP_UI_INTEGRATION_CLIENT_IP ??
  `198.${18 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
// Playwright re-evaluates this file in every worker; pin the first value so
// the servers and every worker agree.
process.env.ACDP_UI_INTEGRATION_CLIENT_IP = RUN_CLIENT_IP;

const SHARED_SERVER_ENV = {
  NEXT_PUBLIC_ACDP_UI_DEMO_MODE: 'false',
  PLAYGROUND_BASE_URL: PLAYGROUND_URL,
  CONTROL_PLANE_BASE_URL: CONTROL_PLANE_URL,
  PLAYGROUND_API_KEY,
};

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
  projects: [
    // Password-gated server (ACDP_UI_PUBLIC_MODE off): every existing spec.
    {
      name: 'chromium',
      testIgnore: '**/public/**',
      use: { ...devices['Desktop Chrome'] },
    },
    // Public server: an anonymous visitor (no session cookie). Each run sends
    // a random documentation-range client IP, so the console's and the
    // playground's per-IP buckets never carry over between runs.
    {
      name: 'public',
      testMatch: 'public/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PUBLIC_BASE_URL,
        storageState: { cookies: [], origins: [] },
        extraHTTPHeaders: { 'x-real-ip': RUN_CLIENT_IP },
      },
    },
  ],
  // Playwright starts these in order, each once the previous answers, so the
  // second server reuses the build the first one made. Registry URLs are not
  // set: registry reads go through the playground's passthrough.
  webServer: [
    {
      // Faithful to the real deployment (Dockerfile / docker-compose.full.yml's
      // ui-console service): a production build with demo mode inlined off,
      // not `next dev`'s always-fail-open auth gate.
      command: `npm run build && npx next start -p ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...SHARED_SERVER_ENV, CONTROL_PLANE_API_KEY, ACDP_UI_CONSOLE_PASSWORD },
    },
    {
      command: `npx next start -p ${PUBLIC_PORT}`,
      url: `${PUBLIC_BASE_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...SHARED_SERVER_ENV,
        CONTROL_PLANE_API_KEY,
        CONTROL_PLANE_READ_API_KEY,
        ACDP_UI_CONSOLE_PASSWORD,
        ACDP_UI_PUBLIC_MODE: 'on',
        ACDP_UI_CLIENT_IP_HEADER: 'x-real-ip',
      },
    },
  ],
});
