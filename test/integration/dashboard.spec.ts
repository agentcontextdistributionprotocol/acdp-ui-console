import { test, expect } from '@playwright/test';

// Drives the real app (production build, demo mode off) against the real
// acdp-playground stack seeded by global-setup.ts, and asserts genuine
// backend data renders — not just a 200 status and not mocked data.

test.describe('Dashboard (real backend)', () => {
  test('renders real run/context counts and a populated Recent Runs table', async ({ page }) => {
    await page.goto('/dashboard');

    // Never allow the error branch: a live proxy failure would render one of
    // these two literals from app/dashboard/page.tsx instead of the KPI grid.
    await expect(page.getByText('Could not load the dashboard')).not.toBeVisible();
    await expect(page.getByText('Dashboard data unavailable.')).not.toBeVisible();

    await expect(page.getByText('Total Runs')).toBeVisible();

    // global-setup seeded 3 real runs (s1/s5/s22) through the real playground;
    // the dashboard's default 24h window must reflect at least that many.
    const totalRunsCard = page.locator('.kpi-card', { hasText: 'Total Runs' });
    const totalRunsValue = await totalRunsCard.locator('.kpi-value').textContent();
    const totalRuns = Number((totalRunsValue ?? '').replace(/[^\d.]/g, ''));
    expect(totalRuns).toBeGreaterThanOrEqual(3);

    // NOT asserted > 0: both registry configs in acdp-playground's default
    // `make up-full` stack ship `[webhook] enabled = false` (SSRF policy
    // refuses a bare http:// webhook URL — see config/registry-{a,b}.toml's
    // own comment), so no registry ever forwards a context_published event to
    // the control plane's /ingest/acdp, and `totalContexts`/`GET /registries`
    // stay genuinely at zero even though a run's own result.contexts lists a
    // real published ctx_id (confirmed directly via
    // `GET /dashboard/overview`). That is correct, documented behavior of
    // this stack, not a rendering defect — so this suite only asserts the
    // figure is a well-formed non-negative number, not stuck loading.
    const contextsCard = page.locator('.kpi-card', { hasText: 'Contexts Published' });
    const contextsValue = await contextsCard.locator('.kpi-value').textContent();
    const totalContexts = Number((contextsValue ?? '').replace(/[^\d.]/g, ''));
    expect(Number.isFinite(totalContexts) && totalContexts >= 0).toBe(true);

    // Recent Runs must show real rows, not the empty state — this figure
    // comes from the playground's run-lifecycle notifications (start/complete
    // to the control plane), a separate, always-on path from the webhook
    // forwarding above, and does carry the 3 seeded runs.
    await expect(page.getByText('No runs yet')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Runs' })).toBeVisible();
    // >= 3, not === 3: a long-lived stack accumulates runs across repeated
    // suite invocations (global-setup seeds 3 more every run), same reasoning
    // as the Total Runs assertion above.
    const recentRunRows = page.locator('.data-table tbody tr');
    await expect(async () => {
      expect(await recentRunRows.count()).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 15_000 });

    // The Key Revocation card always renders (app/dashboard/page.tsx never
    // hides it) — it is the clearest proof the page reached its final render
    // rather than being stuck on the loading skeleton.
    await expect(page.getByText('Key Revocation')).toBeVisible();
  });

  test('Live Events panel connects to the real SSE relay', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Live Events')).toBeVisible();
    // '● live' only renders once useGlobalEvents' EventSource actually opens
    // against /api/stream/events — a relay/proxy failure leaves it '○ idle'.
    await expect(page.getByText('● live')).toBeVisible({ timeout: 15_000 });
  });
});
