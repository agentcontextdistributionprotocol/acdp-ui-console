// ══════════════════════════════════════════════════════════════════════
// Typed API surface. Every function branches on demoMode: demo returns mock
// data with a small simulated delay; real mode goes through the proxy.
// ══════════════════════════════════════════════════════════════════════

import { fetchJson, fetchText } from '@/lib/api/fetcher';
import {
  COMPLETED_RUN_ID,
  FAILED_RUN_ID,
  LIVE_RUN_ID,
  MOCK_AGENTS,
  MOCK_CAPABILITIES,
  MOCK_CONTEXTS,
  MOCK_CONTEXT_EVENTS,
  MOCK_DASHBOARD,
  MOCK_JWKS,
  MOCK_LINEAGE,
  MOCK_LINEAGE_CHAINS,
  MOCK_METRICS,
  MOCK_METRICS_TEXT,
  MOCK_ENROLLMENTS,
  MOCK_REGISTRIES,
  MOCK_REVOCATIONS,
  MOCK_RUNS,
  MOCK_RUN_EVENTS,
  MOCK_SCENARIOS,
  MOCK_SEARCH_HITS,
  MOCK_WEBHOOKS,
} from '@/lib/data/mock-data';
import { REGISTRY_AUTHORITIES } from '@/lib/types';
import type {
  CpContextEvent,
  CpDashboardOverview,
  CpLineageDag,
  ContextSearchParams,
  CpRun,
  EnrollRegistryInput,
  EventFilter,
  FullContext,
  HealthResult,
  JwkSet,
  KnownAgent,
  KnownRegistry,
  LineageGraph,
  ListRunsQuery,
  PlaygroundRunResponse,
  PlaygroundRunStatus,
  PrometheusMetric,
  ProxyService,
  RegistryAuthority,
  RegistryCapabilities,
  RegistryEnrollment,
  RevocationFeed,
  ScenarioDef,
  SearchResponse,
  StepEvent,
  Webhook,
} from '@/lib/types';

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const AUTHORITY_TO_SERVICE: Record<RegistryAuthority, ProxyService> = {
  a: 'registry-a',
  b: 'registry-b',
};
const authToService = (a: RegistryAuthority): ProxyService => AUTHORITY_TO_SERVICE[a];

// ── Health ────────────────────────────────────────────────────────────
export async function pingHealth(service: ProxyService, demoMode: boolean): Promise<HealthResult> {
  if (demoMode) return delay({ ok: true, latencyMs: 4 + Math.floor(Math.random() * 12) }, 80);
  const path = service === 'control-plane' ? '/healthz' : '/healthz';
  const start = performance.now();
  try {
    await fetchJson<unknown>(service, path);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}

// ── Playground ────────────────────────────────────────────────────────
export async function listScenarios(demoMode: boolean): Promise<ScenarioDef[]> {
  if (demoMode) return delay(MOCK_SCENARIOS);
  const res = await fetchJson<{ scenarios: ScenarioDef[] }>('playground', '/scenarios');
  return res.scenarios ?? [];
}

export async function startRun(
  scenarioId: string,
  inputs: Record<string, unknown>,
  registryMode: string | undefined,
  demoMode: boolean,
): Promise<PlaygroundRunResponse> {
  if (demoMode) {
    return delay({
      run_id: LIVE_RUN_ID,
      scenario_id: scenarioId,
      status: 'running',
      stream_url: `/runs/${LIVE_RUN_ID}/events`,
      started_at: new Date().toISOString(),
    });
  }
  return fetchJson<PlaygroundRunResponse>('playground', '/runs', {
    method: 'POST',
    body: JSON.stringify({ scenario_id: scenarioId, inputs, registry_mode: registryMode }),
  });
}

export async function getPlaygroundRun(runId: string, demoMode: boolean): Promise<PlaygroundRunStatus> {
  if (demoMode) {
    const run = MOCK_RUNS.find((r) => r.runId === runId);
    const events = MOCK_RUN_EVENTS[runId];
    const lineage = MOCK_LINEAGE[runId];
    const status = run?.status === 'running' ? 'running' : run?.status === 'failed' ? 'failed' : 'complete';
    return delay({
      run_id: runId,
      status,
      result:
        status === 'running'
          ? undefined
          : {
              run_id: runId,
              scenario_id: run?.scenarioId ?? 'unknown',
              status: status === 'failed' ? 'failed' : 'complete',
              contexts: lineage?.nodes.map((n) => n.ctx_id) ?? [],
              lineage_graph: lineage,
              summary: { contexts: lineage?.nodes.length ?? 0 },
              error: events?.find((e) => e.type === 'run.error')?.error,
            },
    });
  }
  return fetchJson<PlaygroundRunStatus>('playground', `/runs/${encodeURIComponent(runId)}`);
}

/** Demo helper: the recorded event stream for a run (used by use-live-run). */
export function getMockRunEvents(runId: string): StepEvent[] {
  return MOCK_RUN_EVENTS[runId] ?? MOCK_RUN_EVENTS[LIVE_RUN_ID];
}

// ── Control plane ─────────────────────────────────────────────────────
export async function getCpDashboard(window: string, demoMode: boolean): Promise<CpDashboardOverview> {
  if (demoMode) return delay({ ...MOCK_DASHBOARD, window });
  return fetchJson<CpDashboardOverview>('control-plane', `/dashboard/overview?window=${encodeURIComponent(window)}`);
}

export async function listCpRuns(
  query: ListRunsQuery,
  demoMode: boolean,
): Promise<{ data: CpRun[]; total: number }> {
  if (demoMode) {
    let runs = [...MOCK_RUNS];
    if (query.status) runs = runs.filter((r) => r.status === query.status);
    if (query.scenarioId) runs = runs.filter((r) => r.scenarioId === query.scenarioId);
    return delay({ data: runs, total: runs.length });
  }
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.scenarioId) params.set('scenarioId', query.scenarioId);
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));
  return fetchJson<{ data: CpRun[]; total: number }>('control-plane', `/runs?${params.toString()}`);
}

export async function getCpRun(runId: string, demoMode: boolean): Promise<CpRun> {
  if (demoMode) {
    const run = MOCK_RUNS.find((r) => r.runId === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return delay(run);
  }
  return fetchJson<CpRun>('control-plane', `/runs/${encodeURIComponent(runId)}`);
}

export async function getCpRunLineage(runId: string, demoMode: boolean): Promise<CpLineageDag> {
  if (demoMode) {
    const g = MOCK_LINEAGE[runId] ?? { nodes: [], edges: [] };
    return delay({
      runId,
      nodes: g.nodes.map((n) => ({
        ctxId: n.ctx_id,
        agentId: n.agent_id,
        contextType: n.context_type,
        visibility: 'public',
        registryAuthority: n.registry_authority,
        step: n.step,
        status: n.status ?? null,
      })),
      edges: g.edges.map((e) => ({ from: e.src, to: e.dst })),
    });
  }
  return fetchJson<CpLineageDag>('control-plane', `/runs/${encodeURIComponent(runId)}/lineage`);
}

/** Lineage as the playground-style graph the workbench DAG renders. */
export async function getRunLineageGraph(runId: string, demoMode: boolean): Promise<LineageGraph> {
  if (demoMode) return delay(MOCK_LINEAGE[runId] ?? { nodes: [], edges: [] });
  const dag = await getCpRunLineage(runId, false);
  return {
    nodes: dag.nodes.map((n) => ({
      ctx_id: n.ctxId ?? '',
      agent_id: n.agentId,
      title: n.contextType ?? n.ctxId ?? `step ${n.step}`,
      context_type: n.contextType ?? 'context',
      registry_authority: n.registryAuthority,
      step: n.step,
      status: n.status ?? undefined,
    })),
    edges: dag.edges.map((e) => ({ src: e.from, dst: e.to })),
  };
}

export async function getCpRunEvents(runId: string, demoMode: boolean): Promise<{ data: CpContextEvent[] }> {
  if (demoMode) {
    return delay({ data: MOCK_CONTEXT_EVENTS.filter((e) => e.runId === runId) });
  }
  return fetchJson<{ data: CpContextEvent[] }>('control-plane', `/runs/${encodeURIComponent(runId)}/events`);
}

export async function listCpEvents(
  filter: EventFilter,
  demoMode: boolean,
): Promise<{ data: CpContextEvent[]; total: number; nextCursor?: string | null }> {
  const limit = filter.limit ?? 200;
  if (demoMode) {
    let events = [...MOCK_CONTEXT_EVENTS];
    if (filter.runId) events = events.filter((e) => e.runId === filter.runId);
    if (filter.eventType) events = events.filter((e) => e.eventType === filter.eventType);
    if (filter.agentId) events = events.filter((e) => e.agentId.includes(filter.agentId!));
    if (filter.registryAuthority)
      events = events.filter((e) => e.registryAuthority.includes(filter.registryAuthority!));
    // Newest-first keyset pagination mirroring the control plane: the cursor is
    // the oldest row's timestamp, replayed as `beforeTs` for the next (older) page.
    events.sort((a, b) => (a.eventTs < b.eventTs ? 1 : a.eventTs > b.eventTs ? -1 : 0));
    const total = events.length;
    if (filter.beforeTs) events = events.filter((e) => e.eventTs < filter.beforeTs!);
    const page = events.slice(0, limit);
    const nextCursor =
      page.length === limit && page.length < events.length ? page[page.length - 1].eventTs : null;
    return delay({ data: page, total, nextCursor });
  }
  const params = new URLSearchParams();
  if (filter.runId) params.set('runId', filter.runId);
  if (filter.eventType) params.set('eventType', filter.eventType);
  if (filter.agentId) params.set('agentId', filter.agentId);
  if (filter.registryAuthority) params.set('registryAuthority', filter.registryAuthority);
  if (filter.afterTs) params.set('afterTs', filter.afterTs);
  if (filter.beforeTs) params.set('beforeTs', filter.beforeTs);
  params.set('limit', String(limit));
  return fetchJson<{ data: CpContextEvent[]; total: number; nextCursor?: string | null }>(
    'control-plane',
    `/events?${params.toString()}`,
  );
}

export async function listAgents(demoMode: boolean): Promise<KnownAgent[]> {
  if (demoMode) return delay(MOCK_AGENTS);
  const res = await fetchJson<{ data: KnownAgent[] }>('control-plane', '/agents');
  return res.data ?? [];
}

export async function listRegistries(demoMode: boolean): Promise<KnownRegistry[]> {
  if (demoMode) return delay(MOCK_REGISTRIES);
  const res = await fetchJson<{ data: KnownRegistry[] }>('control-plane', '/registries');
  return res.data ?? [];
}

// ── Registry enrollments ──────────────────────────────────────────────
// Mutable in-memory store so demo-mode enroll/toggle reflects changes.
let demoEnrollments: RegistryEnrollment[] | null = null;
function demoEnrollmentStore(): RegistryEnrollment[] {
  if (!demoEnrollments) demoEnrollments = MOCK_ENROLLMENTS.map((e) => ({ ...e }));
  return demoEnrollments;
}

export async function listEnrollments(demoMode: boolean): Promise<RegistryEnrollment[]> {
  if (demoMode) return delay(demoEnrollmentStore().map((e) => ({ ...e })));
  const res = await fetchJson<{ data: RegistryEnrollment[]; total: number }>(
    'control-plane',
    '/registries/enrollments',
  );
  return res.data ?? [];
}

/** Enroll (or upsert) a registry authority. Admin-only on the control plane. */
export async function enrollRegistry(
  input: EnrollRegistryInput,
  demoMode: boolean,
): Promise<RegistryEnrollment> {
  if (demoMode) {
    const store = demoEnrollmentStore();
    const ts = new Date().toISOString();
    const existing = store.find((e) => e.authority === input.authority);
    if (existing) {
      Object.assign(existing, {
        tenantId: input.tenantId ?? existing.tenantId,
        baseUrl: input.baseUrl ?? existing.baseUrl,
        registryDid: input.registryDid ?? existing.registryDid,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: ts,
      });
      return delay({ ...existing });
    }
    const row: RegistryEnrollment = {
      authority: input.authority,
      tenantId: input.tenantId ?? 'default',
      baseUrl: input.baseUrl ?? null,
      registryDid: input.registryDid ?? null,
      enabled: input.enabled ?? true,
      createdAt: ts,
      updatedAt: ts,
    };
    store.unshift(row);
    return delay({ ...row });
  }
  return fetchJson<RegistryEnrollment>('control-plane', '/registries/enroll', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getCpMetrics(demoMode: boolean): Promise<PrometheusMetric[]> {
  if (demoMode) return delay(MOCK_METRICS);
  const text = await fetchText('control-plane', '/metrics');
  return parsePrometheus(text);
}

export interface WebhookInput {
  url: string;
  events: string[];
  secret: string;
}

// Mutable in-memory store so demo-mode CRUD actually reflects changes.
let demoWebhooks: Webhook[] | null = null;
function demoWebhookStore(): Webhook[] {
  if (!demoWebhooks) demoWebhooks = MOCK_WEBHOOKS.map((w) => ({ ...w }));
  return demoWebhooks;
}
let demoWebhookSeq = 100;

export async function listWebhooks(demoMode: boolean): Promise<Webhook[]> {
  if (demoMode) return delay(demoWebhookStore().map((w) => ({ ...w })));
  // Control plane returns a bare array (no { data } envelope).
  const data = await fetchJson<Webhook[]>('control-plane', '/webhooks');
  return data ?? [];
}

export async function createWebhook(input: WebhookInput, demoMode: boolean): Promise<Webhook> {
  if (demoMode) {
    const ts = new Date().toISOString();
    const wh: Webhook = {
      id: `wh-${++demoWebhookSeq}`,
      url: input.url,
      events: input.events,
      active: true,
      createdAt: ts,
      updatedAt: ts,
    };
    demoWebhookStore().unshift(wh);
    return delay(wh);
  }
  return fetchJson<Webhook>('control-plane', '/webhooks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWebhook(
  id: string,
  patch: Partial<WebhookInput & { active: boolean }>,
  demoMode: boolean,
): Promise<Webhook> {
  if (demoMode) {
    const store = demoWebhookStore();
    const wh = store.find((w) => w.id === id);
    if (!wh) throw new Error(`Unknown webhook: ${id}`);
    Object.assign(wh, patch, { updatedAt: new Date().toISOString() });
    return delay({ ...wh });
  }
  return fetchJson<Webhook>('control-plane', `/webhooks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteWebhook(id: string, demoMode: boolean): Promise<void> {
  if (demoMode) {
    demoWebhooks = demoWebhookStore().filter((w) => w.id !== id);
    await delay(null);
    return;
  }
  await fetchJson<void>('control-plane', `/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Registry ──────────────────────────────────────────────────────────
const DEFAULT_SEARCH_LIMIT = 20;

export async function searchContexts(
  authority: RegistryAuthority | 'all',
  search: ContextSearchParams,
  demoMode: boolean,
): Promise<SearchResponse> {
  const limit = search.limit ?? DEFAULT_SEARCH_LIMIT;
  if (demoMode) {
    let hits = MOCK_SEARCH_HITS;
    const q = search.q?.toLowerCase();
    if (q) {
      hits = hits.filter(
        (h) => h.title?.toLowerCase().includes(q) || h.summary?.toLowerCase().includes(q),
      );
    }
    if (search.visibility && search.visibility !== 'all')
      hits = hits.filter((h) => h.visibility === search.visibility);
    if (search.status) hits = hits.filter((h) => h.status === search.status);
    if (search.type) hits = hits.filter((h) => h.type === search.type);
    if (search.agentId) hits = hits.filter((h) => h.agent_id?.includes(search.agentId!));
    // domain/tags live on the full body, not the search hit — look them up.
    const bodyOf = (ctxId: string) => MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId)?.body;
    if (search.domain) hits = hits.filter((h) => bodyOf(h.ctx_id)?.domain === search.domain);
    if (search.tags) {
      const want = search.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      hits = hits.filter((h) => {
        const have = (bodyOf(h.ctx_id)?.tags ?? []).map((t) => t.toLowerCase());
        return want.every((w) => have.includes(w));
      });
    }
    // Simulate keyset pagination: the cursor is an offset into the filtered set.
    const start = search.cursor ? Number(search.cursor) || 0 : 0;
    const page = hits.slice(start, start + limit);
    const nextStart = start + limit;
    const next_cursor = nextStart < hits.length ? String(nextStart) : undefined;
    return delay({
      matches: page,
      total_estimate: hits.length,
      ...(next_cursor ? { next_cursor } : {}),
    });
  }
  const params = new URLSearchParams();
  if (search.q) params.set('q', search.q);
  if (search.type) params.set('type', search.type);
  if (search.domain) params.set('domain', search.domain);
  if (search.tags) params.set('tags', search.tags);
  if (search.agentId) params.set('agent_id', search.agentId);
  if (search.status) params.set('status', search.status);
  if (search.visibility && search.visibility !== 'all') params.set('visibility', search.visibility);
  if (search.cursor) params.set('cursor', search.cursor);
  params.set('limit', String(limit));
  if (authority === 'all') {
    // A single down registry must not blank the combined view. Merged results
    // can't be keyset-paginated coherently, so no next_cursor is returned.
    const settled = await Promise.allSettled(
      REGISTRY_AUTHORITIES.map((a) =>
        fetchJson<SearchResponse>(authToService(a), `/contexts/search?${params.toString()}`),
      ),
    );
    const matches = settled.flatMap((r) => (r.status === 'fulfilled' ? (r.value.matches ?? []) : []));
    const partial = settled.some((r) => r.status === 'rejected');
    return { matches, total_estimate: matches.length, ...(partial ? { partial: true } : {}) };
  }
  return fetchJson<SearchResponse>(authToService(authority), `/contexts/search?${params.toString()}`);
}

export async function getContext(ctxId: string, demoMode: boolean): Promise<FullContext> {
  if (demoMode) {
    const ctx = MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId);
    if (!ctx) throw new Error(`Unknown context: ${ctxId}`);
    return delay(ctx);
  }
  return fetchJson<FullContext>('control-plane', `/contexts/${encodeURIComponent(ctxId)}`);
}

/** Full version chain for a lineage_id (oldest → newest), from a registry. */
export async function getLineage(
  lineageId: string,
  authority: RegistryAuthority,
  demoMode: boolean,
): Promise<FullContext[]> {
  if (demoMode) return delay(MOCK_LINEAGE_CHAINS[lineageId] ?? []);
  return fetchJson<FullContext[]>(authToService(authority), `/lineages/${encodeURIComponent(lineageId)}`);
}

/** The current (non-superseded) context for a lineage_id. */
export async function getLineageCurrent(
  lineageId: string,
  authority: RegistryAuthority,
  demoMode: boolean,
): Promise<FullContext | null> {
  if (demoMode) {
    const chain = MOCK_LINEAGE_CHAINS[lineageId] ?? [];
    return delay(chain.length ? chain[chain.length - 1] : null);
  }
  return fetchJson<FullContext>(authToService(authority), `/lineages/${encodeURIComponent(lineageId)}/current`);
}

export async function getRegistryCapabilities(
  authority: RegistryAuthority,
  demoMode: boolean,
): Promise<RegistryCapabilities> {
  if (demoMode) return delay(MOCK_CAPABILITIES[authority]);
  return fetchJson<RegistryCapabilities>(authToService(authority), '/.well-known/acdp.json');
}

// ── Security: revocations + signing keys ──────────────────────────────
export async function listRevocations(
  params: { since?: number; limit?: number },
  demoMode: boolean,
): Promise<RevocationFeed> {
  const limit = params.limit ?? 50;
  if (demoMode) {
    const since = params.since ?? 0;
    // Feed is newest-first; cursor pages forward through older entries.
    const sorted = [...MOCK_REVOCATIONS].sort((a, b) => b.revoked_at_ms - a.revoked_at_ms);
    const rest = since ? sorted.filter((e) => e.revoked_at_ms < since) : sorted;
    const page = rest.slice(0, limit);
    const next_cursor = page.length === limit && page.length < rest.length ? page[page.length - 1].revoked_at_ms : null;
    return delay({ entries: page, next_cursor });
  }
  const sp = new URLSearchParams();
  sp.set('since', String(params.since ?? 0));
  sp.set('limit', String(limit));
  return fetchJson<RevocationFeed>('control-plane', `/auth/revocations?${sp.toString()}`);
}

/** A registry's published signing keys (RFC 7517 JWK Set). */
export async function getRegistryJwks(authority: RegistryAuthority, demoMode: boolean): Promise<JwkSet> {
  if (demoMode) return delay(MOCK_JWKS[authority]);
  return fetchJson<JwkSet>(authToService(authority), '/.well-known/jwks.json');
}

// ── Helpers ───────────────────────────────────────────────────────────
function parsePrometheus(text: string): PrometheusMetric[] {
  const types = new Map<string, string>();
  const helps = new Map<string, string>();
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# TYPE ')) {
      const parts = trimmed.split(/\s+/); // ['#', 'TYPE', <name>, <type>]
      types.set(parts[2], parts[3]);
    } else if (trimmed.startsWith('# HELP ')) {
      const parts = trimmed.split(/\s+/);
      const name = parts[2];
      helps.set(name, parts.slice(3).join(' '));
    } else if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+-]+)/);
      if (match) {
        const name = match[1];
        const n = Number(match[3]);
        if (Number.isFinite(n)) {
          // Aggregate across label series so multi-series metrics aren't dropped.
          values.set(name, (values.get(name) ?? 0) + n);
        }
      }
    }
  }
  return [...values.entries()].map(([name, value]) => ({
    name,
    value,
    type: types.get(name) ?? 'untyped',
    help: helps.get(name),
  }));
}

export { LIVE_RUN_ID, COMPLETED_RUN_ID, FAILED_RUN_ID, MOCK_METRICS_TEXT };
