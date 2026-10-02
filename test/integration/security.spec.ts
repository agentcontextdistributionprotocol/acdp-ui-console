import { test, expect } from '@playwright/test';

// CONTROL_PLANE_API_KEY in playwright.config.ts is the CP's admin token
// (docker-compose.full.yml's CONTROL_PLANE_ADMIN_TOKEN default), so the
// admin-gated revocation feed must render its real (possibly empty) listing
// rather than the 403 panel.

test.describe('Security (real backend)', () => {
  test('revocation feed authenticates as admin against the real control plane', async ({ page }) => {
    await page.goto('/security');

    await expect(page.getByText(/admin-gated/i)).not.toBeVisible();
    await expect(page.getByText('Could not load the revocation feed')).not.toBeVisible();
    // No revocation scenario was seeded, so the honest real answer is the
    // feed's own empty state — proof the admin-scoped request succeeded and
    // returned real (empty) data, not a forbidden/error short-circuit.
    await expect(page.getByText('No revocations recorded')).toBeVisible();
  });

  test('reaches both registries JWKS endpoints and renders their real (empty) response', async ({ page }) => {
    await page.goto('/security');

    await expect(page.getByText('Registry A signing keys')).toBeVisible();
    await expect(page.getByText('Registry B signing keys')).toBeVisible();
    await expect(page.getByText('Could not load JWKS.')).not.toBeVisible();
    // NOT asserted absent: both registries in acdp-playground's default
    // `make up-full` stack sign auth JWTs with HS256 (a symmetric secret,
    // ACDP_REGISTRY_AUTH__JWT_SECRET) rather than EdDSA — config/registry-
    // {a,b}.toml's own comment says JWKS needs the asymmetric mode — so
    // `GET /.well-known/jwks.json` genuinely, correctly returns `{"keys":[]}`
    // on both (confirmed directly against the real registries). The real,
    // honest render here is the card's own empty state on both cards.
    await expect(page.getByText('No published keys')).toHaveCount(2);
  });

  test('renders the witness alert worklist against the real control plane', async ({ page }) => {
    await page.goto('/security');
    // This worklist (`/registries/log-witness/alerts`) is control-plane's own
    // durable alert store, independent of the observed-registries table the
    // per-registry witness cards below it depend on (which — see
    // registries.spec.ts — stays empty in this stack because webhook
    // forwarding is off by default). It always renders its header and either
    // real rows or its own real empty state, proving the admin-scoped round
    // trip succeeded.
    await expect(page.getByText('Witness alert worklist')).toBeVisible();
    await expect(page.getByText('Could not load the witness alert worklist')).not.toBeVisible();
    await expect(page.getByText('No alert is recorded at all')).toBeVisible();
  });
});
