// ══════════════════════════════════════════════════════════════════════
// ACDP UI Console — shared TypeScript contracts
// Playground responses are snake_case; control-plane responses are camelCase.
// ══════════════════════════════════════════════════════════════════════

// ── Playground types ──────────────────────────────────────────────────
export type RegistryMode = 'single' | 'dual' | 'cross_org';
export type ScenarioFramework = 'langchain' | 'crewai' | 'langgraph' | 'mixed';

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  registry_mode: RegistryMode;
  agent_count: number;
  framework: ScenarioFramework;
  default_inputs: Record<string, unknown>;
}

export type StepEventType =
  | 'agent.started'
  | 'llm.thinking'
  | 'acdp.publish'
  | 'acdp.retrieve'
  | 'acdp.search'
  | 'acdp.verify'
  | 'auth.token'
  | 'auth.revoke'
  | 'policy.check'
  | 'scenario.note'
  | 'run.started'
  | 'run.complete'
  | 'run.error'
  | 'webhook.received';

export interface StepEvent {
  type: StepEventType;
  run_id: string;
  ts: string;
  agent_id?: string;
  ctx_id?: string;
  title?: string;
  derived_from?: string[];
  preview?: string;
  contexts_produced?: number;
  lineage_graph?: LineageGraph;
  error?: string;
  scenario_id?: string;
  framework?: string;
  registry_authority?: string;
  tenant_id?: string;
  event_id?: string;
}

export interface PlaygroundRunResponse {
  run_id: string;
  scenario_id: string;
  status: 'running' | 'complete' | 'failed';
  stream_url: string;
  started_at: string;
}

export interface LineageNode {
  ctx_id: string;
  agent_id: string;
  title: string;
  context_type: string;
  registry_authority: string;
  step: number;
}

export interface LineageEdge {
  src: string;
  dst: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface RunResult {
  run_id: string;
  scenario_id: string;
  status: 'complete' | 'failed';
  contexts: string[];
  lineage_graph?: LineageGraph;
  summary: Record<string, unknown>;
  error?: string;
}

export interface PlaygroundRunStatus {
  run_id: string;
  status: string;
  result?: RunResult;
}

// ── Control plane types ───────────────────────────────────────────────
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface CpRun {
  runId: string;
  tenantId: string;
  scenarioId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string | null;
  contextsCount: number;
  registries: string[];
  inputs?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  updatedAt?: string;
}

export interface CpContextEvent {
  id: string;
  eventType: string;
  eventTs: string;
  runId?: string | null;
  ctxId?: string | null;
  lineageId?: string | null;
  agentId: string;
  contextType?: string | null;
  visibility?: string | null;
  version?: number | null;
  derivedFrom?: string[];
  registryAuthority: string;
  scenarioId?: string | null;
}

export interface CpLineageDag {
  runId: string;
  nodes: Array<{
    ctxId: string | null;
    agentId: string;
    contextType: string | null;
    visibility: string | null;
    registryAuthority: string;
    step: number;
  }>;
  edges: Array<{ from: string; to: string }>;
}

export interface CpDashboardOverview {
  window: string;
  totalRuns: number;
  totalContexts: number;
  totalAgents: number;
  totalRegistries: number;
  recentRuns: CpRun[];
  byScenario: Array<{ scenario_id: string; run_count: number }>;
  byRegistry: Array<{ registry_authority: string; event_count: number }>;
}

export interface KnownAgent {
  agentDid: string;
  firstSeen: string;
  lastSeen: string;
  registryAuthority?: string | null;
  contextCount: number;
}

export interface KnownRegistry {
  authority: string;
  baseUrl?: string | null;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Registry types ────────────────────────────────────────────────────
export interface ContextBody {
  ctx_id: string;
  lineage_id: string;
  origin_registry: string;
  created_at: string;
  content_hash: string;
  version: number;
  agent_id: string;
  title: string;
  type: string;
  visibility: string;
  derived_from: string[];
  summary?: string;
  tags?: string[];
  domain?: string;
}

export interface FullContext {
  body: ContextBody;
  registry_state: { status: string };
}

export interface SearchHit {
  ctx_id: string;
  title?: string;
  agent_id?: string;
  context_type?: string;
  visibility?: string;
  summary?: string;
  registry_authority?: string;
  version?: number;
}

export interface SearchResponse {
  matches: SearchHit[];
  total_estimate?: number;
  next_cursor?: string;
}

export interface RegistryCapabilities {
  acdp_version: string;
  registry_did: string;
  authority: string;
  supported_signature_algorithms: string[];
  profiles: string[];
  anonymous_public_reads: boolean;
  limits: {
    max_payload_bytes: number;
    max_search_limit: number;
    max_embedded_bytes: number;
  };
}

// ── Misc ──────────────────────────────────────────────────────────────
export type RegistryAuthority = 'a' | 'b';

export interface HealthResult {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface PrometheusMetric {
  name: string;
  type: string;
  value: number;
  help?: string;
}

export interface ListRunsQuery {
  status?: RunStatus;
  scenarioId?: string;
  limit?: number;
  offset?: number;
}

export interface EventFilter {
  runId?: string;
  eventType?: string;
  agentId?: string;
  registryAuthority?: string;
  afterTs?: string;
  beforeTs?: string;
  limit?: number;
}

export interface ServiceConnection {
  label: string;
  service: ProxyService;
  port: string;
}

export type ProxyService = 'playground' | 'control-plane' | 'registry-a' | 'registry-b';
