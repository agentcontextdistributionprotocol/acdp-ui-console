// ══════════════════════════════════════════════════════════════════════
// Typed API surface. Every function branches on demoMode: demo returns mock
// data with a small simulated delay; real mode goes through the proxy.
// ══════════════════════════════════════════════════════════════════════

import { ApiError, fetchJson, fetchText } from '@/lib/api/fetcher';
import {
  COMPLETED_RUN_ID,
  FAILED_RUN_ID,
  LIVE_RUN_ID,
  MOCK_AGENTS,
  MOCK_CAPABILITIES,
  MOCK_CONTEXTS,
  MOCK_CONTEXT_EVENTS,
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
  demoDashboardForWindow,
} from '@/lib/data/mock-data';
import { KEY_REVOCATION_TYPE_ALIASES, isKeyRevocationFacet } from '@/lib/utils/revocation';
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
  SearchHit,
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
// Every service's /healthz body shapes its own envelope differently
// (registry-rs: {status, storage, version}; control-plane/playground: {ok,
// service, version}) but all three key the version string the same way, so
// reading just that one field tolerates the rest of the shape varying.
function extractHealthVersion(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const version = (body as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

export async function pingHealth(service: ProxyService, demoMode: boolean): Promise<HealthResult> {
  if (demoMode) return delay({ ok: true, latencyMs: 4 + Math.floor(Math.random() * 12) }, 80);
  const start = performance.now();
  try {
    const body = await fetchJson<unknown>(service, '/healthz');
    return { ok: true, latencyMs: Math.round(performance.now() - start), version: extractHealthVersion(body) };
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
  // Per-window demo payload: `{...MOCK_DASHBOARD, window}` returned identical
  // figures for every window and an always-non-zero `keyRevocation`, which left
  // the "revocation not reported" degrade path unreachable outside a test.
  if (demoMode) return delay(demoDashboardForWindow(window));
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
    if (search.type) {
      // Same union as the real branch — see `isKeyRevocationFacet`. Without it
      // demo mode would silently disagree with real mode on the one facet this
      // fan-out exists for.
      const wanted = isKeyRevocationFacet(search.type) ? KEY_REVOCATION_TYPE_ALIASES : [search.type];
      hits = hits.filter((h) => wanted.includes(h.type));
    }
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
    // The union facet is unpaginated in real mode (merged result sets have no
    // coherent keyset cursor), so demo must suppress the cursor too — otherwise
    // "Load more" appears here and nowhere else, and the demo teaches the
    // opposite of the shipped behavior.
    // BOTH merge axes, exactly as the real branch computes them — the type
    // spellings and `authority === 'all'`. An earlier cut checked only the type
    // axis, so demo mode offered a "Load more" on a federated search that
    // production does not, and answered a zero-match federated search with the
    // flat "No contexts found" this phase exists to remove.
    const unioned = isKeyRevocationFacet(search.type) || authority === 'all';
    const next_cursor = !unioned && nextStart < hits.length ? String(nextStart) : undefined;
    return delay({
      matches: page,
      total_estimate: hits.length,
      ...(unioned ? { merged: true } : {}),
      ...(next_cursor ? { next_cursor } : {}),
    });
  }
  const queryFor = (type: string | undefined) => {
    const params = new URLSearchParams();
    if (search.q) params.set('q', search.q);
    if (type) params.set('type', type);
    if (search.domain) params.set('domain', search.domain);
    if (search.tags) params.set('tags', search.tags);
    if (search.agentId) params.set('agent_id', search.agentId);
    if (search.status) params.set('status', search.status);
    if (search.visibility && search.visibility !== 'all') params.set('visibility', search.visibility);
    if (search.cursor) params.set('cursor', search.cursor);
    params.set('limit', String(limit));
    return params.toString();
  };

  // Registry search matches `type` exactly, and RFC-ACDP-0014 §10 gives the
  // revocation type two equivalent spellings — so this ONE facet is queried
  // under both and merged. Every other facet value keeps exactly its previous
  // request count and its upstream `next_cursor`.
  const types = isKeyRevocationFacet(search.type) ? KEY_REVOCATION_TYPE_ALIASES : [search.type];
  const authorities = authority === 'all' ? REGISTRY_AUTHORITIES : [authority];

  if (authorities.length === 1 && types.length === 1) {
    return fetchJson<SearchResponse>(authToService(authorities[0]), `/contexts/search?${queryFor(types[0])}`);
  }

  // Either fan-out merges result sets that cannot be keyset-paginated
  // coherently, so no `next_cursor` is returned — the rule and its reason
  // predate this function's second axis (it was the `authority === 'all'`
  // branch). A cursor from one of several merged queries would silently skip
  // or repeat rows, which is a correctness bug; a capped list is a visible,
  // honest limit. A single down registry must still not blank the view.
  const plan = authorities.flatMap((a) => types.map((t) => ({ authority: a, type: t })));
  const settled = await Promise.allSettled(
    plan.map((p) => fetchJson<SearchResponse>(authToService(p.authority), `/contexts/search?${queryFor(p.type)}`)),
  );

  // Deduped by ctx_id WITHIN a registry (the two type spellings can only ever
  // name the same context if a registry serves both), never across registries:
  // the same ctx_id served by two authorities is a real federation observation
  // the combined view has always shown, and collapsing it here would hide it.
  // A merge that lost EVERY upstream is a failure, not an empty result. Without
  // this, selecting the revocation facet against a down registry degraded from
  // the `ErrorPanel` every other facet raises into an amber "did not respond"
  // plus "No matches in this view" — a security investigation against a dead
  // registry, rendered as a search that found nothing.
  if (settled.length > 0 && settled.every((r) => r.status === 'rejected')) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  const seen = new Set<string>();
  const matches: SearchHit[] = [];
  // `total_estimate` must come from the UPSTREAM estimates, not from
  // `matches.length`. The merged page is capped at `limit` per query and
  // carries no cursor, so reporting the page size as the total told the
  // operator "20 contexts" for a query that read only the first page of each —
  // and suppressed the "N of ~M" hedge that would have said otherwise.
  let estimate = 0;
  let sawEstimate = false;
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    if (typeof r.value.total_estimate === 'number') {
      estimate += r.value.total_estimate;
      sawEstimate = true;
    }
    for (const hit of r.value.matches ?? []) {
      const key = `${plan[i].authority}::${hit.ctx_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(hit);
    }
  });
  const partial = settled.some((r) => r.status === 'rejected');
  return {
    matches,
    total_estimate: sawEstimate ? Math.max(estimate, matches.length) : matches.length,
    merged: true,
    ...(partial ? { partial: true } : {}),
  };
}

export async function getContext(ctxId: string, demoMode: boolean): Promise<FullContext> {
  if (demoMode) {
    const ctx = MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId);
    // A search hit with no backing body is a defined demo state, not a bug:
    // `MOCK_SEARCH_HITS` carries one synthetic interim-form revocation hit so
    // the two-spelling facet fan-out is reachable without a backend, and that
    // hit deliberately has no signed body (see the fixture's comment). Raised
    // as the same structured 404 a registry would return for an unknown id, so
    // it lands in the detail pane's existing error state instead of a bare
    // `Error` whose message the UI would have had to string-match.
    //
    // It must NOT be answered with a fabricated body: the detail pane runs real
    // signature and content-hash verification, so an invented body would render
    // failed trust chips for a fixture — a worse lie than an honest absence.
    if (!ctx) {
      throw new ApiError(
        404,
        JSON.stringify({ errorCode: 'CONTEXT_NOT_FOUND', message: `Unknown context: ${ctxId}` }),
        'control-plane',
        `/contexts/${encodeURIComponent(ctxId)}`,
      );
    }
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
