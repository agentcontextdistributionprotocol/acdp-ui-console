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
  MOCK_LINEAGE,
  MOCK_METRICS,
  MOCK_METRICS_TEXT,
  MOCK_REGISTRIES,
  MOCK_RUNS,
  MOCK_RUN_EVENTS,
  MOCK_SCENARIOS,
  MOCK_SEARCH_HITS,
  MOCK_WEBHOOKS,
} from '@/lib/data/mock-data';
import type {
  CpContextEvent,
  CpDashboardOverview,
  CpLineageDag,
  CpRun,
  EventFilter,
  FullContext,
  HealthResult,
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
  ScenarioDef,
  SearchResponse,
  StepEvent,
  Webhook,
} from '@/lib/types';

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const authToService = (a: RegistryAuthority): ProxyService => (a === 'a' ? 'registry-a' : 'registry-b');

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
): Promise<{ data: CpContextEvent[]; total: number }> {
  if (demoMode) {
    let events = [...MOCK_CONTEXT_EVENTS];
    if (filter.runId) events = events.filter((e) => e.runId === filter.runId);
    if (filter.eventType) events = events.filter((e) => e.eventType === filter.eventType);
    if (filter.agentId) events = events.filter((e) => e.agentId.includes(filter.agentId!));
    if (filter.registryAuthority)
      events = events.filter((e) => e.registryAuthority.includes(filter.registryAuthority!));
    return delay({ data: events, total: events.length });
  }
  const params = new URLSearchParams();
  if (filter.runId) params.set('runId', filter.runId);
  if (filter.eventType) params.set('eventType', filter.eventType);
  if (filter.agentId) params.set('agentId', filter.agentId);
  if (filter.registryAuthority) params.set('registryAuthority', filter.registryAuthority);
  if (filter.afterTs) params.set('afterTs', filter.afterTs);
  if (filter.beforeTs) params.set('beforeTs', filter.beforeTs);
  params.set('limit', String(filter.limit ?? 200));
  return fetchJson<{ data: CpContextEvent[]; total: number }>('control-plane', `/events?${params.toString()}`);
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
export async function searchContexts(
  authority: RegistryAuthority | 'both',
  q: string,
  visibility: string | undefined,
  demoMode: boolean,
): Promise<SearchResponse> {
  if (demoMode) {
    let hits = MOCK_SEARCH_HITS;
    if (q) {
      const lower = q.toLowerCase();
      hits = hits.filter(
        (h) => h.title?.toLowerCase().includes(lower) || h.summary?.toLowerCase().includes(lower),
      );
    }
    if (visibility && visibility !== 'all') hits = hits.filter((h) => h.visibility === visibility);
    return delay({ matches: hits, total_estimate: hits.length });
  }
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (visibility && visibility !== 'all') params.set('visibility', visibility);
  if (authority === 'both') {
    // A single down registry must not blank the combined view.
    const settled = await Promise.allSettled([
      fetchJson<SearchResponse>('registry-a', `/contexts/search?${params.toString()}`),
      fetchJson<SearchResponse>('registry-b', `/contexts/search?${params.toString()}`),
    ]);
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

export async function getRegistryCapabilities(
  authority: RegistryAuthority,
  demoMode: boolean,
): Promise<RegistryCapabilities> {
  if (demoMode) return delay(MOCK_CAPABILITIES[authority]);
  return fetchJson<RegistryCapabilities>(authToService(authority), '/.well-known/acdp.json');
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
