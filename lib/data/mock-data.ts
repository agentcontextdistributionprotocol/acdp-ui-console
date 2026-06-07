// ══════════════════════════════════════════════════════════════════════
// Rich mock dataset powering demo mode. Mirrors the real backend shapes so
// the entire console works with zero services running.
// ══════════════════════════════════════════════════════════════════════

import type {
  CpContextEvent,
  CpDashboardOverview,
  CpRun,
  FullContext,
  KnownAgent,
  KnownRegistry,
  LineageGraph,
  PrometheusMetric,
  RegistryCapabilities,
  ScenarioDef,
  SearchHit,
  StepEvent,
  Webhook,
} from '@/lib/types';

const now = Date.now();
function iso(secondsAgo: number): string {
  return new Date(now - secondsAgo * 1000).toISOString();
}

export const LIVE_RUN_ID = 'run-7f3c9a1b';
export const COMPLETED_RUN_ID = 'run-a1b2c3d4';
export const FAILED_RUN_ID = 'run-9d8e7f6a';

const AUTH_A = 'registry-a.playground.local';
const AUTH_B = 'registry-b.playground.local';
const DID_A = 'did:web:registry-a.local:agents:cross-a';
const DID_B = 'did:web:registry-b.local:agents:cross-b';
const DID_SOLO = 'did:web:registry-a.local:agents:solo';

// ── Scenarios (mirrors playground catalog, S1–S20) ────────────────────
export const MOCK_SCENARIOS: ScenarioDef[] = [
  {
    id: 's1_single_publish',
    name: 'Single Publish',
    description: 'One agent publishes one context. Smallest possible round-trip through the SDK + registry.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'quarterly cash flow' },
  },
  {
    id: 's2_producer_consumer',
    name: 'Producer / Consumer',
    description: 'Agent A publishes a context; agent B retrieves it and publishes a derivative.',
    registry_mode: 'single',
    agent_count: 2,
    framework: 'langchain',
    default_inputs: { topic: 'supply chain risk' },
  },
  {
    id: 's3_fanout',
    name: 'Fan-out',
    description: 'One producer publishes; N consumers each retrieve and derive independently (1 → N).',
    registry_mode: 'single',
    agent_count: 4,
    framework: 'langgraph',
    default_inputs: { topic: 'market sentiment', consumers: 3 },
  },
  {
    id: 's4_chain',
    name: 'Multi-agent Chain',
    description: 'A linear chain A → B → C where each agent derives from the previous step.',
    registry_mode: 'single',
    agent_count: 3,
    framework: 'crewai',
    default_inputs: { topic: 'energy transition' },
  },
  {
    id: 's5_cross_registry',
    name: 'Cross-Registry Chain',
    description: 'Agent A publishes to registry-a; agent B retrieves cross-registry and publishes a derivative to registry-b.',
    registry_mode: 'dual',
    agent_count: 2,
    framework: 'langchain',
    default_inputs: { topic: 'Arctic shipping routes' },
  },
  {
    id: 's6_restricted',
    name: 'Restricted Visibility',
    description: 'Publishes a restricted context and verifies an unauthorized reader is denied.',
    registry_mode: 'single',
    agent_count: 2,
    framework: 'langchain',
    default_inputs: { topic: 'M&A due diligence' },
  },
  {
    id: 's7_supersession',
    name: 'Supersession',
    description: 'Publishes v1, then v2 on the same lineage. The latest version becomes current.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'pricing model' },
  },
  {
    id: 's8_cross_org',
    name: 'Cross-Org Federation',
    description: 'Two organizations exchange contexts across federated registries with authority checks.',
    registry_mode: 'cross_org',
    agent_count: 2,
    framework: 'mixed',
    default_inputs: { topic: 'joint venture terms' },
  },
  {
    id: 's9_p256_publish',
    name: 'P-256 Publish',
    description: 'Publishes a context signed with an ECDSA P-256 key instead of ed25519.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'compliance attestation' },
  },
  {
    id: 's10_tenant_isolation',
    name: 'Tenant Isolation',
    description: "Two tenant-bound agents. tenant-b cannot read tenant-a's restricted contexts.",
    registry_mode: 'single',
    agent_count: 2,
    framework: 'langchain',
    default_inputs: { topic: 'customer PII summary' },
  },
  {
    id: 's11_revocation',
    name: 'Token Revocation',
    description: 'Publishes with a valid token, revokes it, then verifies subsequent requests are rejected.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'incident report' },
  },
  {
    id: 's12_key_rotation',
    name: 'Key Rotation',
    description: 'Rotates an agent signing key and confirms old + new signatures verify per policy.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'audit log' },
  },
  {
    id: 's13_policy_deny',
    name: 'Policy Deny',
    description: 'Triggers a policy rule that denies a publish attempt and surfaces the decision.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'restricted dataset' },
  },
  {
    id: 's14_domain_pack',
    name: 'Domain Pack Gating',
    description: 'Context-type gating via a domain pack — only declared types are accepted.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'clinical note', domain: 'healthcare' },
  },
  {
    id: 's15_supersession_lineage',
    name: 'Supersession + Lineage',
    description: 'v1 published, v2 supersedes with expected_lineage_id guard. Lineage query confirms v2 is current.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'forecast model' },
  },
  {
    id: 's16_dataref_ssrf',
    name: 'SSRF Guard (data_refs)',
    description: 'Exercises the consumer-side SSRF protection when resolving external data_refs URIs.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'external dataset', data_ref: 'http://169.254.169.254/' },
  },
  {
    id: 's17_supersession_authz',
    name: 'Supersession Authz',
    description: 'Only the original author (or delegate) may supersede a context; others are denied.',
    registry_mode: 'single',
    agent_count: 2,
    framework: 'langchain',
    default_inputs: { topic: 'policy document' },
  },
  {
    id: 's18_idempotency',
    name: 'Idempotency',
    description: 'Repeated publishes with the same idempotency key return the same context, not duplicates.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'daily snapshot' },
  },
  {
    id: 's19_cp_did_web_p256',
    name: 'CP DID:web + P-256',
    description: 'Control-plane resolves a did:web identity using a P-256 verification method end-to-end.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'identity proof' },
  },
  {
    id: 's20_reserved_tenant',
    name: 'Reserved Tenant',
    description: 'Validates handling of reserved tenant identifiers and namespace collisions.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'tenant onboarding' },
  },
];

export const SCENARIO_COUNT = MOCK_SCENARIOS.length;

// ── Lineage graphs ────────────────────────────────────────────────────
const LIVE_LINEAGE: LineageGraph = {
  nodes: [
    {
      ctx_id: `acdp://${AUTH_A}/f4a2c9e1-1d2b-4a3c-9e8f-001`,
      agent_id: DID_A,
      title: 'Cross-registry source — Arctic shipping routes',
      context_type: 'data_snapshot',
      registry_authority: AUTH_A,
      step: 1,
    },
    {
      ctx_id: `acdp://${AUTH_B}/9c11a7f2-7b6c-4d5e-8a9b-002`,
      agent_id: DID_B,
      title: 'Cross-registry derivative — Arctic investment analysis',
      context_type: 'analysis',
      registry_authority: AUTH_B,
      step: 2,
    },
  ],
  edges: [
    {
      src: `acdp://${AUTH_A}/f4a2c9e1-1d2b-4a3c-9e8f-001`,
      dst: `acdp://${AUTH_B}/9c11a7f2-7b6c-4d5e-8a9b-002`,
    },
  ],
};

const FANOUT_LINEAGE: LineageGraph = {
  nodes: [
    { ctx_id: `acdp://${AUTH_A}/src-100`, agent_id: DID_SOLO, title: 'Market sentiment source', context_type: 'data_snapshot', registry_authority: AUTH_A, step: 1 },
    { ctx_id: `acdp://${AUTH_A}/d-101`, agent_id: 'did:web:registry-a.local:agents:c1', title: 'Equities take', context_type: 'analysis', registry_authority: AUTH_A, step: 2 },
    { ctx_id: `acdp://${AUTH_A}/d-102`, agent_id: 'did:web:registry-a.local:agents:c2', title: 'FX take', context_type: 'analysis', registry_authority: AUTH_A, step: 2 },
    { ctx_id: `acdp://${AUTH_A}/d-103`, agent_id: 'did:web:registry-a.local:agents:c3', title: 'Commodities take', context_type: 'analysis', registry_authority: AUTH_A, step: 2 },
  ],
  edges: [
    { src: `acdp://${AUTH_A}/src-100`, dst: `acdp://${AUTH_A}/d-101` },
    { src: `acdp://${AUTH_A}/src-100`, dst: `acdp://${AUTH_A}/d-102` },
    { src: `acdp://${AUTH_A}/src-100`, dst: `acdp://${AUTH_A}/d-103` },
  ],
};

export const MOCK_LINEAGE: Record<string, LineageGraph> = {
  [LIVE_RUN_ID]: LIVE_LINEAGE,
  [COMPLETED_RUN_ID]: {
    nodes: [
      { ctx_id: `acdp://${AUTH_A}/2e78f01a-solo`, agent_id: DID_SOLO, title: 'Quarterly cash flow snapshot', context_type: 'data_snapshot', registry_authority: AUTH_A, step: 1 },
    ],
    edges: [],
  },
  'run-fan-3': FANOUT_LINEAGE,
};

// ── Step events (per run, used for live replay + history) ─────────────
export const MOCK_RUN_EVENTS: Record<string, StepEvent[]> = {
  [LIVE_RUN_ID]: [
    { type: 'run.started', run_id: LIVE_RUN_ID, ts: iso(24), scenario_id: 's5_cross_registry', title: 's5_cross_registry · run-7f3c9a1b' },
    { type: 'agent.started', run_id: LIVE_RUN_ID, ts: iso(23), agent_id: DID_A, title: DID_A },
    { type: 'llm.thinking', run_id: LIVE_RUN_ID, ts: iso(21), agent_id: DID_A, preview: 'Geopolitical risks in Arctic shipping routes…', title: 'gpt-4o-mini' },
    {
      type: 'acdp.publish',
      run_id: LIVE_RUN_ID,
      ts: iso(16),
      agent_id: DID_A,
      ctx_id: LIVE_LINEAGE.nodes[0].ctx_id,
      title: 'Cross-registry source — Arctic shipping routes',
      registry_authority: AUTH_A,
      contexts_produced: 1,
    },
    { type: 'agent.started', run_id: LIVE_RUN_ID, ts: iso(15), agent_id: DID_B, title: DID_B },
    {
      type: 'acdp.retrieve',
      run_id: LIVE_RUN_ID,
      ts: iso(13),
      agent_id: DID_B,
      ctx_id: LIVE_LINEAGE.nodes[0].ctx_id,
      title: 'Cross-registry resolve from registry-a',
      registry_authority: AUTH_A,
    },
    { type: 'llm.thinking', run_id: LIVE_RUN_ID, ts: iso(10), agent_id: DID_B, preview: 'Analyzing investment implications…' },
    {
      type: 'acdp.publish',
      run_id: LIVE_RUN_ID,
      ts: iso(3),
      agent_id: DID_B,
      ctx_id: LIVE_LINEAGE.nodes[1].ctx_id,
      title: 'Cross-registry derivative — Arctic investment analysis',
      registry_authority: AUTH_B,
      derived_from: [LIVE_LINEAGE.nodes[0].ctx_id],
      contexts_produced: 1,
    },
    {
      type: 'run.complete',
      run_id: LIVE_RUN_ID,
      ts: iso(0),
      scenario_id: 's5_cross_registry',
      title: 'Run complete · 2 contexts',
      lineage_graph: LIVE_LINEAGE,
      contexts_produced: 2,
    },
  ],
  [COMPLETED_RUN_ID]: [
    { type: 'run.started', run_id: COMPLETED_RUN_ID, ts: iso(280), scenario_id: 's1_single_publish' },
    { type: 'agent.started', run_id: COMPLETED_RUN_ID, ts: iso(279), agent_id: DID_SOLO },
    { type: 'llm.thinking', run_id: COMPLETED_RUN_ID, ts: iso(277), agent_id: DID_SOLO, preview: 'Summarizing quarterly cash flow…' },
    { type: 'acdp.publish', run_id: COMPLETED_RUN_ID, ts: iso(272), agent_id: DID_SOLO, ctx_id: `acdp://${AUTH_A}/2e78f01a-solo`, title: 'Quarterly cash flow snapshot', registry_authority: AUTH_A, contexts_produced: 1 },
    { type: 'run.complete', run_id: COMPLETED_RUN_ID, ts: iso(271), scenario_id: 's1_single_publish', contexts_produced: 1 },
  ],
  [FAILED_RUN_ID]: [
    { type: 'run.started', run_id: FAILED_RUN_ID, ts: iso(1320), scenario_id: 's15_supersession_lineage' },
    { type: 'agent.started', run_id: FAILED_RUN_ID, ts: iso(1319), agent_id: DID_SOLO },
    { type: 'acdp.publish', run_id: FAILED_RUN_ID, ts: iso(1315), agent_id: DID_SOLO, ctx_id: `acdp://${AUTH_A}/v1-super`, title: 'Forecast model v1', registry_authority: AUTH_A, contexts_produced: 1 },
    { type: 'acdp.verify', run_id: FAILED_RUN_ID, ts: iso(1312), agent_id: DID_SOLO, title: 'expected_lineage_id guard' },
    { type: 'run.error', run_id: FAILED_RUN_ID, ts: iso(1310), scenario_id: 's15_supersession_lineage', error: 'Supersession rejected: expected_lineage_id mismatch (409 Conflict)' },
  ],
};

// ── Runs ──────────────────────────────────────────────────────────────
export const MOCK_RUNS: CpRun[] = [
  {
    runId: LIVE_RUN_ID,
    tenantId: 'default',
    scenarioId: 's5_cross_registry',
    status: 'running',
    startedAt: iso(24),
    completedAt: null,
    contextsCount: 1,
    registries: [AUTH_A, AUTH_B],
    inputs: { topic: 'Arctic shipping routes' },
  },
  {
    runId: COMPLETED_RUN_ID,
    tenantId: 'default',
    scenarioId: 's1_single_publish',
    status: 'completed',
    startedAt: iso(280),
    completedAt: iso(271),
    contextsCount: 1,
    registries: [AUTH_A],
    inputs: { topic: 'quarterly cash flow' },
  },
  {
    runId: 'run-c4d5e6f7',
    tenantId: 'default',
    scenarioId: 's10_tenant_isolation',
    status: 'completed',
    startedAt: iso(720),
    completedAt: iso(710),
    contextsCount: 1,
    registries: [AUTH_A],
    inputs: { topic: 'customer PII summary' },
  },
  {
    runId: FAILED_RUN_ID,
    tenantId: 'default',
    scenarioId: 's15_supersession_lineage',
    status: 'failed',
    startedAt: iso(1320),
    completedAt: iso(1310),
    contextsCount: 1,
    registries: [AUTH_A],
    inputs: { topic: 'forecast model' },
  },
  {
    runId: 'run-fan-3',
    tenantId: 'default',
    scenarioId: 's3_fanout',
    status: 'completed',
    startedAt: iso(3600),
    completedAt: iso(3580),
    contextsCount: 4,
    registries: [AUTH_A],
    inputs: { topic: 'market sentiment', consumers: 3 },
  },
  {
    runId: 'run-cross-org-1',
    tenantId: 'default',
    scenarioId: 's8_cross_org',
    status: 'completed',
    startedAt: iso(7200),
    completedAt: iso(7170),
    contextsCount: 2,
    registries: [AUTH_A, AUTH_B],
    inputs: { topic: 'joint venture terms' },
  },
];

// ── Context events (global firehose / history) ────────────────────────
export const MOCK_CONTEXT_EVENTS: CpContextEvent[] = [
  { id: 'ev-1', eventType: 'context_published', eventTs: iso(8), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_A, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's5_cross_registry' },
  { id: 'ev-2', eventType: 'context_retrieved', eventTs: iso(11), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_B, registryAuthority: AUTH_B, scenarioId: 's5_cross_registry' },
  { id: 'ev-3', eventType: 'context_published', eventTs: iso(3), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[1].ctx_id, agentId: DID_B, contextType: 'analysis', visibility: 'public', version: 1, derivedFrom: [LIVE_LINEAGE.nodes[0].ctx_id], registryAuthority: AUTH_B, scenarioId: 's5_cross_registry' },
  { id: 'ev-4', eventType: 'context_published', eventTs: iso(272), runId: COMPLETED_RUN_ID, ctxId: `acdp://${AUTH_A}/2e78f01a-solo`, agentId: DID_SOLO, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's1_single_publish' },
  { id: 'ev-5', eventType: 'search_executed', eventTs: iso(300), runId: COMPLETED_RUN_ID, agentId: DID_SOLO, registryAuthority: AUTH_A, scenarioId: 's1_single_publish' },
  { id: 'ev-6', eventType: 'context_published', eventTs: iso(710), runId: 'run-c4d5e6f7', ctxId: `acdp://${AUTH_A}/tenant-a-001`, agentId: 'did:web:registry-a.local:agents:tenant-a', contextType: 'data_snapshot', visibility: 'restricted', version: 1, registryAuthority: AUTH_A, scenarioId: 's10_tenant_isolation' },
];

// ── Dashboard overview ────────────────────────────────────────────────
export const MOCK_DASHBOARD: CpDashboardOverview = {
  window: '24h',
  totalRuns: 47,
  totalContexts: 312,
  totalAgents: 12,
  recentRuns: MOCK_RUNS.slice(0, 5),
  byScenario: [
    { scenario_id: 's1_single_publish', run_count: 14 },
    { scenario_id: 's5_cross_registry', run_count: 9 },
    { scenario_id: 's3_fanout', run_count: 7 },
    { scenario_id: 's10_tenant_isolation', run_count: 6 },
    { scenario_id: 's15_supersession_lineage', run_count: 5 },
    { scenario_id: 's8_cross_org', run_count: 4 },
    { scenario_id: 's2_producer_consumer', run_count: 2 },
  ],
  byRegistry: [
    { registry_authority: AUTH_A, event_count: 187 },
    { registry_authority: AUTH_B, event_count: 125 },
  ],
};

// ── Agents ────────────────────────────────────────────────────────────
export const MOCK_AGENTS: KnownAgent[] = [
  { agentDid: DID_A, registryAuthority: AUTH_A, contextCount: 12, firstSeen: iso(172800), lastSeen: iso(8) },
  { agentDid: DID_B, registryAuthority: AUTH_B, contextCount: 8, firstSeen: iso(172800), lastSeen: iso(21) },
  { agentDid: DID_SOLO, registryAuthority: AUTH_A, contextCount: 47, firstSeen: iso(432000), lastSeen: iso(240) },
];

// ── Registries ────────────────────────────────────────────────────────
export const MOCK_REGISTRIES: KnownRegistry[] = [
  { authority: AUTH_A, baseUrl: 'http://localhost:8100', eventCount: 187, firstSeen: iso(432000), lastSeen: iso(8) },
  { authority: AUTH_B, baseUrl: 'http://localhost:8200', eventCount: 125, firstSeen: iso(432000), lastSeen: iso(3) },
];

export const MOCK_CAPABILITIES: Record<'a' | 'b', RegistryCapabilities> = {
  a: {
    acdp_version: '0.1.0',
    registry_did: 'did:web:registry-a.playground.local',
    authority: AUTH_A,
    supported_signature_algorithms: ['ed25519', 'ecdsa-p256'],
    profiles: ['acdp-consumer', 'acdp-federated'],
    anonymous_public_reads: true,
    limits: { max_payload_bytes: 1_048_576, max_search_limit: 100, max_embedded_bytes: 65_536 },
  },
  b: {
    acdp_version: '0.1.0',
    registry_did: 'did:web:registry-b.playground.local',
    authority: AUTH_B,
    supported_signature_algorithms: ['ed25519', 'ecdsa-p256'],
    profiles: ['acdp-consumer', 'acdp-federated'],
    anonymous_public_reads: true,
    limits: { max_payload_bytes: 1_048_576, max_search_limit: 100, max_embedded_bytes: 65_536 },
  },
};

// ── Contexts (search + full bodies) ───────────────────────────────────
export const MOCK_CONTEXTS: FullContext[] = [
  {
    body: {
      ctx_id: LIVE_LINEAGE.nodes[0].ctx_id,
      lineage_id: 'lin-arctic-001',
      origin_registry: AUTH_A,
      created_at: iso(16),
      content_hash: 'sha256:f170150d8c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8',
      version: 1,
      agent_id: DID_A,
      title: 'Cross-registry source — Arctic shipping routes',
      type: 'data_snapshot',
      visibility: 'public',
      derived_from: [],
      summary: 'Geopolitical and logistical assessment of emerging Arctic shipping corridors.',
      tags: ['geopolitics', 'logistics'],
      domain: 'geopolitics',
    },
    registry_state: { status: 'active' },
  },
  {
    body: {
      ctx_id: LIVE_LINEAGE.nodes[1].ctx_id,
      lineage_id: 'lin-arctic-002',
      origin_registry: AUTH_B,
      created_at: iso(3),
      content_hash: 'sha256:9c11a7f2e1d2b4a3c9e8f001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
      version: 1,
      agent_id: DID_B,
      title: 'Cross-registry derivative — Arctic investment analysis',
      type: 'analysis',
      visibility: 'public',
      derived_from: [LIVE_LINEAGE.nodes[0].ctx_id],
      summary: 'Investment implications derived from the Arctic shipping snapshot.',
      tags: ['investment', 'analysis'],
      domain: 'finance',
    },
    registry_state: { status: 'active' },
  },
  {
    body: {
      ctx_id: `acdp://${AUTH_A}/2e78f01a-solo`,
      lineage_id: 'lin-cashflow-001',
      origin_registry: AUTH_A,
      created_at: iso(272),
      content_hash: 'sha256:2e78f01abc34d56e78f90a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
      version: 1,
      agent_id: DID_SOLO,
      title: 'Quarterly cash flow snapshot',
      type: 'data_snapshot',
      visibility: 'public',
      derived_from: [],
      summary: 'Snapshot of quarterly operating cash flow figures.',
      tags: ['finance'],
      domain: 'finance',
    },
    registry_state: { status: 'active' },
  },
];

export const MOCK_SEARCH_HITS: SearchHit[] = MOCK_CONTEXTS.map((c) => ({
  ctx_id: c.body.ctx_id,
  title: c.body.title,
  agent_id: c.body.agent_id,
  context_type: c.body.type,
  visibility: c.body.visibility,
  summary: c.body.summary,
  registry_authority: c.body.origin_registry,
  version: c.body.version,
}));

// ── Prometheus metrics ────────────────────────────────────────────────
export const MOCK_METRICS: PrometheusMetric[] = [
  { name: 'acdp_events_ingested_total', type: 'counter', value: 312, help: 'Total ACDP webhook events ingested' },
  { name: 'acdp_runs_total', type: 'counter', value: 47, help: 'Total runs recorded' },
  { name: 'acdp_webhook_deliveries_total', type: 'counter', value: 289, help: 'Outbound webhook deliveries' },
  { name: 'acdp_active_sse_connections', type: 'gauge', value: 3, help: 'Currently open SSE connections' },
  { name: 'acdp_db_pool_size', type: 'gauge', value: 5, help: 'Database connection pool size' },
  { name: 'acdp_context_published_total', type: 'counter', value: 312, help: 'Contexts observed as published' },
  { name: 'acdp_context_retrieved_total', type: 'counter', value: 198, help: 'Contexts observed as retrieved' },
];

export const MOCK_METRICS_TEXT = MOCK_METRICS.map(
  (m) => `# HELP ${m.name} ${m.help}\n# TYPE ${m.name} ${m.type}\n${m.name} ${m.value}`,
).join('\n');

// ── Webhooks ──────────────────────────────────────────────────────────
export const MOCK_WEBHOOKS: Webhook[] = [
  { id: 'wh-1', url: 'https://hooks.example.com/acdp/events', events: ['context_published'], active: true, createdAt: iso(86400), updatedAt: iso(3600) },
  { id: 'wh-2', url: 'https://siem.internal.local/ingest', events: [], active: true, createdAt: iso(172800), updatedAt: iso(7200) },
];

// ── SDK matrix (config page) ──────────────────────────────────────────
export const MOCK_SDK_MATRIX = [
  { component: 'acdp-rs library', version: '0.1.0', status: 'ok' },
  { component: 'acdp-py binding', version: '0.1.0', status: 'ok' },
  { component: 'acdp-node binding', version: '0.1.0', status: 'ok' },
  { component: 'Registry (Rust/axum)', version: '0.1.0', status: 'ok' },
  { component: 'Control Plane (NestJS)', version: '0.1.0', status: 'ok' },
  { component: 'Playground (FastAPI)', version: '0.1.0', status: 'ok' },
];
