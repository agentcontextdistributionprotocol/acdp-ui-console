import { test, expect, type APIRequestContext } from '@playwright/test';

// Real control-plane and registry data rendered on the pages the original
// three specs never open: the run list, the run inspector, registry context
// search, and the trust page. Each test first reads the real record through
// the console's own proxy (the same session the page uses), then asserts the
// page renders THAT record — not merely "no error", which an empty or stuck
// page would also satisfy.

const SEEDED = ['s1_single_publish', 's5_cross_registry', 's22_receipts'] as const;

interface CpRun {
  runId: string;
  scenarioId: string;
  status: string;
  result?: { contexts?: string[] } | null;
}

async function seededRuns(request: APIRequestContext): Promise<Record<string, CpRun>> {
  const res = await request.get('/api/proxy/control-plane/runs?limit=100');
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: CpRun[] };
  // Newest first, so a long-lived stack resolves to this suite run's seed.
  const out: Record<string, CpRun> = {};
  for (const run of data) if (!out[run.scenarioId]) out[run.scenarioId] = run;
  for (const id of SEEDED) expect(out[id], `control plane has a run for seeded ${id}`).toBeTruthy();
  return out;
}

test.describe('Live pages render real backend records', () => {
  test('/runs lists every seeded run by its real run id', async ({ page }) => {
    const runs = await seededRuns(page.request);
    await page.goto('/runs');
    await expect(page.getByText('Could not load the run list')).not.toBeVisible();
    for (const id of SEEDED) {
      await expect(page.getByRole('button', { name: `Open run ${runs[id].runId}` })).toBeVisible();
    }
  });

  test('opening a seeded run from /runs shows its persisted, terminal record', async ({ page }) => {
    const run = (await seededRuns(page.request)).s1_single_publish;
    expect(run.status).toBe('completed');

    await page.goto('/runs');
    await page.getByRole('button', { name: `Open run ${run.runId}` }).click();
    await page.waitForURL(`**/runs/${run.runId}`);

    await expect(page.getByText(/Could not load this run/)).not.toBeVisible();
    // RunSummary's subtitle: `<runId> · <registries> · <scenarioId>`.
    await expect(page.getByText(new RegExp(`${run.runId}.*s1_single_publish`))).toBeVisible();
    // StatusBadge renders the control plane's `completed` as `complete`.
    await expect(page.locator('.badge').filter({ hasText: /^\W*complete$/ }).first()).toBeVisible();
    // A terminal run hydrates from the control plane rather than tailing a
    // stream that no longer exists, so its feed reads as ended, never live.
    await expect(page.locator('.badge').filter({ hasText: /^\W*ended$/ })).toBeVisible();
    await expect(page.locator('.badge').filter({ hasText: /running|live/ })).toHaveCount(0);

    // #197: what the page may say about the run's contexts depends on what the
    // control plane OBSERVED. With registry webhooks off (this stack's
    // default) its lineage is empty while the run itself reported a publish;
    // the page must then say so, never "0 contexts" or "No lineage yet".
    const reported = run.result?.contexts ?? [];
    const lineage = await page.request.get(`/api/proxy/control-plane/runs/${run.runId}/lineage`);
    expect(lineage.status()).toBe(200);
    const observed = ((await lineage.json()) as { nodes: unknown[] }).nodes.length;
    if (observed === 0 && reported.length > 0) {
      const label = `${reported.length} context${reported.length === 1 ? '' : 's'} reported by the run; none observed via registry events`;
      await expect(page.getByText(label)).toHaveCount(2);
      await expect(page.getByText(/^0 contexts$/)).toHaveCount(0);
      await expect(page.getByText('No lineage yet')).toHaveCount(0);
    } else {
      await expect(page.getByText(`${observed} context${observed === 1 ? '' : 's'}`, { exact: true })).toBeVisible();
    }
  });

  test('a nonexistent run id renders the not-found copy, not a crash or a blank page', async ({ page }) => {
    await page.goto('/runs/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/Could not load this run\. The control plane has no run with that id\./)).toBeVisible();
  });

  test('/contexts renders the real registry-a search results, including the seeded s1 publish', async ({ page }) => {
    const run = (await seededRuns(page.request)).s1_single_publish;
    const ctxId = run.result?.contexts?.[0];
    expect(ctxId, 's1 run result names its published ctx_id').toBeTruthy();

    // Ground truth straight from the registry, through the proxy.
    const search = await page.request.get('/api/proxy/registry-a/contexts/search?limit=100');
    expect(search.status()).toBe(200);
    const { matches } = (await search.json()) as { matches: { ctx_id: string; title?: string }[] };
    const hit = matches.find((m) => m.ctx_id === ctxId);
    expect(hit, 'registry-a search index contains the s1 context').toBeTruthy();

    // What the control plane's federation proxy says about this body decides
    // what the modal may honestly say. In acdp-playground's default stack the
    // registries forward no webhooks, so the control plane observes neither
    // and answers 404 REGISTRY_NOT_FOUND ("no context was looked up"); with
    // webhooks on it returns the body. Both are legitimate; claiming "no body
    // was returned" for the first is not.
    const cp = await page.request.get(`/api/proxy/control-plane/contexts/${encodeURIComponent(ctxId!)}`);

    await page.goto('/contexts');
    await expect(page.getByText('No contexts found')).not.toBeVisible();
    const card = page.getByRole('button', { name: `Inspect context ${hit!.title || hit!.ctx_id}` }).first();
    await expect(card).toBeVisible();
    await card.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Loading…')).toHaveCount(0);

    if (cp.status() === 200) {
      await expect(dialog.getByText('No context body available')).toHaveCount(0);
      await expect(dialog.getByText(ctxId!).first()).toBeVisible();
    } else {
      expect(cp.status()).toBe(404);
      expect(((await cp.json()) as { errorCode?: string }).errorCode).toBe('REGISTRY_NOT_FOUND');
      await expect(dialog.getByText('No context body available')).toBeVisible();
      await expect(dialog.getByText(/never looked up/)).toBeVisible();
      await expect(dialog.getByText(/No context body was returned for this id/)).toHaveCount(0);
    }
  });

  test('/trust reaches its final render against the real control plane', async ({ page }) => {
    await page.goto('/trust');
    await expect(page.getByText('Could not load trust signals')).not.toBeVisible();
    await expect(page.getByText('Trust data unavailable.')).not.toBeVisible();
    await expect(page.getByText('Receipt Coverage', { exact: true })).toBeVisible();
    await expect(page.getByText('Producer DID Methods', { exact: true })).toBeVisible();
    await expect(page.getByText('Trust violations', { exact: true })).toBeVisible();
  });
});
