import { test, expect } from '@playwright/test';

// The control plane's "observed" registries table (`GET /registries`) is
// populated only by webhook-forwarded events — and both registry configs in
// acdp-playground's default `make up-full` stack ship `[webhook] enabled =
// false` (config/registry-{a,b}.toml: the registry's SSRF policy refuses a
// bare http:// webhook URL, "a known follow-up"). So no registry ever
// forwards anything to the control plane's /ingest/acdp in this stack, and
// `GET /registries` genuinely, correctly returns `{"data":[],"total":0}`
// (confirmed directly against the real control plane) regardless of how many
// scenarios ran. The honest real render here is the page's own empty state —
// asserting population would assert a config this stack doesn't ship.

test.describe('Registries (real backend)', () => {
  test('renders the real (empty) observed-registries state, not an error', async ({ page }) => {
    await page.goto('/registries');

    await expect(page.getByText('Could not load the observed registries')).not.toBeVisible();
    await expect(page.getByText('No registries observed yet')).toBeVisible();
  });

  test('renders the enrollment management section from the real control plane', async ({ page }) => {
    await page.goto('/registries');
    await expect(page.getByText(/enrollment/i).first()).toBeVisible();
  });
});
