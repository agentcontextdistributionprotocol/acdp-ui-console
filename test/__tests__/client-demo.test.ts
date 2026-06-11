import { describe, expect, it } from 'vitest';
import {
  searchContexts,
  listRevocations,
  listCpEvents,
  listCpRuns,
  getCpRunLineage,
  getRunLineageGraph,
  getCpMetrics,
  getPlaygroundRun,
  getContext,
  getCpRun,
  getLineage,
  getLineageCurrent,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listEnrollments,
  enrollRegistry,
  LIVE_RUN_ID,
  COMPLETED_RUN_ID,
  FAILED_RUN_ID,
} from '@/lib/api/client';
import {
  MOCK_CONTEXTS,
  MOCK_REVOCATIONS,
  MOCK_CONTEXT_EVENTS,
  MOCK_LINEAGE,
  MOCK_METRICS,
} from '@/lib/data/mock-data';

const DEMO = true;

// ── searchContexts (demo filtering + keyset pagination) ────────────────
describe('searchContexts (demo)', () => {
  it('returns a page plus a total estimate of the full filtered set', async () => {
    const res = await searchContexts('a', {}, DEMO);
    expect(res.matches.length).toBeGreaterThan(0);
    expect(res.total_estimate).toBeGreaterThanOrEqual(res.matches.length);
  });

  it('filters by case-insensitive query against title/summary', async () => {
    const res = await searchContexts('a', { q: 'ARCTIC', limit: 50 }, DEMO);
    expect(res.matches.length).toBeGreaterThan(0);
    for (const m of res.matches) {
      const hay = `${m.title ?? ''} ${m.summary ?? ''}`.toLowerCase();
      expect(hay).toContain('arctic');
    }
  });

  it('returns an empty page for a query that matches nothing', async () => {
    const res = await searchContexts('a', { q: 'zzz-no-such-context' }, DEMO);
    expect(res.matches).toEqual([]);
    expect(res.next_cursor).toBeUndefined();
  });

  it('filters by visibility, ignoring the "all" sentinel', async () => {
    const all = await searchContexts('a', { visibility: 'all', limit: 50 }, DEMO);
    const pub = await searchContexts('a', { visibility: 'public', limit: 50 }, DEMO);
    expect(pub.matches.every((m) => m.visibility === 'public')).toBe(true);
    expect(pub.matches.length).toBeLessThanOrEqual(all.matches.length);
  });

  it('filters by domain (looked up from the full body, not the hit)', async () => {
    const domain = MOCK_CONTEXTS[0].body.domain!;
    const res = await searchContexts('a', { domain, limit: 50 }, DEMO);
    expect(res.matches.length).toBeGreaterThan(0);
    const bodyDomain = (ctxId: string) => MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId)?.body.domain;
    expect(res.matches.every((m) => bodyDomain(m.ctx_id) === domain)).toBe(true);
  });

  it('requires every comma-separated tag to be present (AND semantics)', async () => {
    const tags = MOCK_CONTEXTS[0].body.tags!;
    const res = await searchContexts('a', { tags: tags.join(','), limit: 50 }, DEMO);
    const bodyTags = (ctxId: string) => MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId)?.body.tags ?? [];
    for (const m of res.matches) {
      for (const t of tags) expect(bodyTags(m.ctx_id).map((x) => x.toLowerCase())).toContain(t.toLowerCase());
    }
  });

  it('paginates via an offset cursor and stops when exhausted', async () => {
    const page1 = await searchContexts('a', { limit: 1 }, DEMO);
    expect(page1.matches).toHaveLength(1);
    expect(page1.next_cursor).toBe('1');

    const page2 = await searchContexts('a', { limit: 1, cursor: '1' }, DEMO);
    expect(page2.matches[0].ctx_id).not.toBe(page1.matches[0].ctx_id);

    // Walk to the end: the final page must not advertise another cursor.
    let cursor: string | undefined = '0';
    let guard = 0;
    let last;
    do {
      last = await searchContexts('a', { limit: 2, cursor }, DEMO);
      cursor = last.next_cursor;
    } while (cursor && guard++ < 50);
    expect(last.next_cursor).toBeUndefined();
  });
});

// ── listRevocations (demo: newest-first, since/limit paging) ───────────
describe('listRevocations (demo)', () => {
  it('returns entries newest-first', async () => {
    const { entries } = await listRevocations({ limit: 50 }, DEMO);
    expect(entries.length).toBe(MOCK_REVOCATIONS.length);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].revoked_at_ms).toBeGreaterThanOrEqual(entries[i].revoked_at_ms);
    }
  });

  it('emits a cursor only when a full page leaves more behind', async () => {
    const first = await listRevocations({ limit: 1 }, DEMO);
    if (MOCK_REVOCATIONS.length > 1) {
      expect(first.next_cursor).toBeTypeOf('number');
      const next = await listRevocations({ limit: 50, since: first.next_cursor as number }, DEMO);
      // `since` pages forward through strictly older entries.
      expect(next.entries.every((e) => e.revoked_at_ms < (first.next_cursor as number))).toBe(true);
    }
  });

  it('returns a null cursor when the page drains the feed', async () => {
    const { next_cursor } = await listRevocations({ limit: 999 }, DEMO);
    expect(next_cursor).toBeNull();
  });
});

// ── listCpEvents (demo filtering) ──────────────────────────────────────
describe('listCpEvents (demo)', () => {
  it('returns all events with no filter', async () => {
    const { data, total } = await listCpEvents({}, DEMO);
    expect(data.length).toBe(MOCK_CONTEXT_EVENTS.length);
    expect(total).toBe(data.length);
  });

  it('filters by runId, eventType, and substring agentId', async () => {
    const byRun = await listCpEvents({ runId: LIVE_RUN_ID }, DEMO);
    expect(byRun.data.every((e) => e.runId === LIVE_RUN_ID)).toBe(true);

    const byType = await listCpEvents({ eventType: 'context_published' }, DEMO);
    expect(byType.data.every((e) => e.eventType === 'context_published')).toBe(true);

    const someAgent = MOCK_CONTEXT_EVENTS[0].agentId.slice(8, 16);
    const byAgent = await listCpEvents({ agentId: someAgent }, DEMO);
    expect(byAgent.data.every((e) => e.agentId.includes(someAgent))).toBe(true);
  });
});

// ── listCpRuns (demo filtering) ────────────────────────────────────────
describe('listCpRuns (demo)', () => {
  it('filters by status and scenarioId', async () => {
    const completed = await listCpRuns({ status: 'completed' }, DEMO);
    expect(completed.data.every((r) => r.status === 'completed')).toBe(true);
    expect(completed.total).toBe(completed.data.length);
  });
});

// ── Run lineage shaping ────────────────────────────────────────────────
describe('run lineage (demo)', () => {
  it('maps the cross-registry graph into the control-plane DAG shape', async () => {
    const dag = await getCpRunLineage(LIVE_RUN_ID, DEMO);
    const src = MOCK_LINEAGE[LIVE_RUN_ID];
    expect(dag.runId).toBe(LIVE_RUN_ID);
    expect(dag.nodes).toHaveLength(src.nodes.length);
    expect(dag.nodes[0].ctxId).toBe(src.nodes[0].ctx_id);
    expect(dag.edges).toHaveLength(src.edges.length);
    expect(dag.edges[0]).toEqual({ from: src.edges[0].src, to: src.edges[0].dst });
  });

  it('returns an empty DAG for an unknown run rather than throwing', async () => {
    const dag = await getCpRunLineage('run-does-not-exist', DEMO);
    expect(dag.nodes).toEqual([]);
    expect(dag.edges).toEqual([]);
  });

  it('getRunLineageGraph returns the playground-style graph in demo mode', async () => {
    const g = await getRunLineageGraph(LIVE_RUN_ID, DEMO);
    expect(g).toEqual(MOCK_LINEAGE[LIVE_RUN_ID]);
  });
});

// ── getPlaygroundRun status derivation ─────────────────────────────────
describe('getPlaygroundRun (demo)', () => {
  it('a running run has no result payload', async () => {
    const status = await getPlaygroundRun(LIVE_RUN_ID, DEMO);
    expect(status.status).toBe('running');
    expect(status.result).toBeUndefined();
  });

  it('a completed run carries its contexts + lineage graph', async () => {
    const status = await getPlaygroundRun(COMPLETED_RUN_ID, DEMO);
    expect(status.status).toBe('complete');
    expect(status.result?.status).toBe('complete');
  });

  it('a failed run surfaces failed status', async () => {
    const status = await getPlaygroundRun(FAILED_RUN_ID, DEMO);
    expect(status.status).toBe('failed');
    expect(status.result?.status).toBe('failed');
  });
});

// ── getContext / getCpRun throw on unknown ids ─────────────────────────
describe('demo lookups that should throw on miss', () => {
  it('getContext throws for an unknown ctx_id', async () => {
    await expect(getContext('acdp://nope/000', DEMO)).rejects.toThrow(/Unknown context/);
  });

  it('getCpRun throws for an unknown run', async () => {
    await expect(getCpRun('run-nope', DEMO)).rejects.toThrow(/Unknown run/);
  });

  it('getContext resolves a known ctx_id', async () => {
    const id = MOCK_CONTEXTS[0].body.ctx_id;
    expect((await getContext(id, DEMO)).body.ctx_id).toBe(id);
  });
});

// ── Lineage chains ─────────────────────────────────────────────────────
describe('lineage chains (demo)', () => {
  it('getLineage returns the full ordered chain', async () => {
    const chain = await getLineage('lin-cashflow-001', 'a', DEMO);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].body.version).toBe(1);
  });

  it('getLineageCurrent returns the newest version', async () => {
    const chain = await getLineage('lin-cashflow-001', 'a', DEMO);
    const current = await getLineageCurrent('lin-cashflow-001', 'a', DEMO);
    expect(current?.body.ctx_id).toBe(chain[chain.length - 1].body.ctx_id);
  });

  it('getLineage returns [] and getLineageCurrent null for an unknown lineage', async () => {
    expect(await getLineage('lin-nope', 'a', DEMO)).toEqual([]);
    expect(await getLineageCurrent('lin-nope', 'a', DEMO)).toBeNull();
  });
});

// ── getCpMetrics (demo) ────────────────────────────────────────────────
describe('getCpMetrics (demo)', () => {
  it('returns the canned metric list', async () => {
    expect(await getCpMetrics(DEMO)).toEqual(MOCK_METRICS);
  });
});

// ── Webhook CRUD against the in-memory demo store ──────────────────────
describe('webhook CRUD (demo)', () => {
  it('create → list → update → delete round-trips through the store', async () => {
    const before = await listWebhooks(DEMO);
    const created = await createWebhook({ url: 'https://x.test/hook', events: ['context_published'], secret: 's' }, DEMO);
    expect(created.id).toMatch(/^wh-/);
    expect(created.active).toBe(true);

    const afterCreate = await listWebhooks(DEMO);
    expect(afterCreate.length).toBe(before.length + 1);
    expect(afterCreate.find((w) => w.id === created.id)).toBeTruthy();

    const createdTs = created.updatedAt; // capture before update mutates the stored row
    const updated = await updateWebhook(created.id, { active: false }, DEMO);
    expect(updated.active).toBe(false);
    expect(updated.updatedAt >= createdTs).toBe(true);

    await deleteWebhook(created.id, DEMO);
    const afterDelete = await listWebhooks(DEMO);
    expect(afterDelete.find((w) => w.id === created.id)).toBeUndefined();
  });

  it('updateWebhook throws for an unknown id', async () => {
    await expect(updateWebhook('wh-nope', { active: true }, DEMO)).rejects.toThrow(/Unknown webhook/);
  });

  it('listWebhooks returns copies, not references into the store', async () => {
    const a = await listWebhooks(DEMO);
    a[0].url = 'mutated';
    const b = await listWebhooks(DEMO);
    expect(b[0].url).not.toBe('mutated');
  });
});

// ── Enrollment upsert against the in-memory demo store ─────────────────
describe('enrollRegistry (demo)', () => {
  it('inserts a brand-new authority with sensible defaults', async () => {
    const row = await enrollRegistry({ authority: 'registry-z.test' }, DEMO);
    expect(row.authority).toBe('registry-z.test');
    expect(row.tenantId).toBe('default');
    expect(row.enabled).toBe(true);
    const rows = await listEnrollments(DEMO);
    expect(rows.find((r) => r.authority === 'registry-z.test')).toBeTruthy();
  });

  it('upserts (patches) an existing authority instead of duplicating it', async () => {
    const existing = (await listEnrollments(DEMO))[0];
    const before = (await listEnrollments(DEMO)).length;
    const patched = await enrollRegistry({ authority: existing.authority, enabled: false }, DEMO);
    expect(patched.enabled).toBe(false);
    expect((await listEnrollments(DEMO)).length).toBe(before);
  });
});

// ── Sanity: the run-id constants are wired up ──────────────────────────
describe('exported run-id constants', () => {
  it('are distinct ids', () => {
    expect(new Set([LIVE_RUN_ID, COMPLETED_RUN_ID, FAILED_RUN_ID]).size).toBe(3);
  });
});
