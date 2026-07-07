// ══════════════════════════════════════════════════════════════════════
// Rich mock dataset powering demo mode. Mirrors the real backend shapes so
// the entire console works with zero services running.
// ══════════════════════════════════════════════════════════════════════

import type {
  CapabilityAuthority,
  CpContextEvent,
  CpDashboardOverview,
  CpRun,
  FullContext,
  JwkSet,
  KnownAgent,
  KnownRegistry,
  LineageGraph,
  PrometheusMetric,
  RegistryAuthority,
  RegistryCapabilities,
  RegistryEnrollment,
  RevocationEntry,
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
const AUTH_C = 'registry-c.playground.local'; // ACDP 0.2 receipts-profile registry
const DID_A = 'did:web:registry-a.local:agents:cross-a';
const DID_B = 'did:web:registry-b.local:agents:cross-b';
const DID_SOLO = 'did:web:registry-a.local:agents:solo';
const DID_KEY = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'; // ephemeral agent

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
  // ── ACDP 0.2 trust & hardening scenarios (S22–S26) ──────────────────
  {
    id: 's22_receipts',
    name: 'Registry Receipts',
    description: 'did:key publish → receipts registry → Require-policy receipt verify (RFC-ACDP-0010 happy path).',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'attested disclosure' },
  },
  {
    id: 's23_receipt_tamper',
    name: 'Receipt Tamper (fail-closed)',
    description: 'Six adversarial receipts (missing, mutated, rebound, mismatched, forged) — all must fail closed, fully offline.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'tamper matrix' },
  },
  {
    id: 's24_historical_key',
    name: 'Historical Key Verification',
    description: 'Key rotation: a pre-rotation context stays HistoricallyAuthorized via the receipt-pinned publish key.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'rotated signing key' },
  },
  {
    id: 's25_did_key',
    name: 'did:key Ephemeral Agents',
    description: 'Three ephemeral did:key agents publish + verify offline; a rotated key is a new identity that cannot supersede.',
    registry_mode: 'single',
    agent_count: 3,
    framework: 'langchain',
    default_inputs: { topic: 'ephemeral identities' },
  },
  {
    id: 's26_divergence',
    name: 'Divergence Diagnostics',
    description: 'A non-reproducing content_hash is localized via canonical preimage diff; the registry rejects it as hash_mismatch.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'canonicalization drift' },
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
    // Retracted after publication (RFC-ACDP-0013) — renders dashed/danger in the DAG.
    { ctx_id: `acdp://${AUTH_A}/d-102`, agent_id: 'did:web:registry-a.local:agents:c2', title: 'FX take', context_type: 'analysis', registry_authority: AUTH_A, step: 2, status: 'retracted' },
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
    // Still running — the audit sweep hasn't produced a verdict yet.
    trust: null,
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
    trust: { audited: 1, verified: 1, verifiedHistorical: 0, structural: 0, noReceipt: 0, errors: 0, flagged: [] },
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
    // Receipt shape verified, but the registry isn't on the receipts profile so
    // there's no crypto receipt to verify — structural-only.
    trust: { audited: 1, verified: 0, verifiedHistorical: 0, structural: 1, noReceipt: 0, errors: 0, flagged: [] },
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
    // Environmental: the registry was unreachable during the sweep — not a flag.
    trust: { audited: 1, verified: 0, verifiedHistorical: 0, structural: 0, noReceipt: 0, errors: 1, flagged: [] },
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
    trust: { audited: 4, verified: 2, verifiedHistorical: 0, structural: 0, noReceipt: 2, errors: 0, flagged: [] },
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
    // One context's receipt content_hash diverges from the served body — a real
    // trust violation surfaced by the audit.
    trust: {
      audited: 2,
      verified: 1,
      verifiedHistorical: 0,
      structural: 0,
      noReceipt: 0,
      errors: 0,
      flagged: [
        {
          eventId: 'ev-cross-org-2',
          ctxId: `acdp://${AUTH_B}/joint-venture-002`,
          status: 'discrepancy',
          discrepancies: [
            'content_hash_mismatch: receipt sha256:bb22c8a3… ≠ served body sha256:9c11a7f2…',
          ],
        },
      ],
    },
  },
  {
    runId: 'run-historical-1',
    tenantId: 'default',
    scenarioId: 's24_historical_key',
    status: 'completed',
    startedAt: iso(150),
    completedAt: iso(138),
    contextsCount: 1,
    registries: [AUTH_C],
    inputs: { topic: 'rotated signing key' },
    // The producer rotated its key after publishing; the pre-rotation context
    // still verifies against the retired key pinned by the receipt (RFC-ACDP-0010
    // §9 historically authorized) — cryptographically valid, just not current.
    trust: { audited: 1, verified: 0, verifiedHistorical: 1, structural: 0, noReceipt: 0, errors: 0, flagged: [] },
  },
];

// ── Context events (global firehose / history) ────────────────────────
export const MOCK_CONTEXT_EVENTS: CpContextEvent[] = [
  { id: 'ev-1', eventType: 'context_published', eventTs: iso(8), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_A, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's5_cross_registry', keyFingerprint: 'sha256:1f4a90c2e7b3', receiptPresent: true },
  { id: 'ev-2', eventType: 'context_retrieved', eventTs: iso(11), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_B, registryAuthority: AUTH_B, scenarioId: 's5_cross_registry' },
  { id: 'ev-3', eventType: 'context_published', eventTs: iso(3), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[1].ctx_id, agentId: DID_B, contextType: 'analysis', visibility: 'public', version: 1, derivedFrom: [LIVE_LINEAGE.nodes[0].ctx_id], registryAuthority: AUTH_B, scenarioId: 's5_cross_registry', keyFingerprint: 'sha256:a07c5d1b9e22', receiptPresent: false },
  { id: 'ev-4', eventType: 'context_published', eventTs: iso(272), runId: COMPLETED_RUN_ID, ctxId: `acdp://${AUTH_A}/2e78f01a-solo`, agentId: DID_SOLO, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's1_single_publish', keyFingerprint: 'sha256:3c8e2f04a1d6', receiptPresent: true },
  { id: 'ev-5', eventType: 'search_executed', eventTs: iso(300), runId: COMPLETED_RUN_ID, agentId: DID_SOLO, registryAuthority: AUTH_A, scenarioId: 's1_single_publish' },
  { id: 'ev-6', eventType: 'context_published', eventTs: iso(710), runId: 'run-c4d5e6f7', ctxId: `acdp://${AUTH_A}/tenant-a-001`, agentId: 'did:web:registry-a.local:agents:tenant-a', contextType: 'data_snapshot', visibility: 'restricted', version: 1, registryAuthority: AUTH_A, scenarioId: 's10_tenant_isolation' },
  { id: 'ev-7', eventType: 'context_published', eventTs: iso(140), runId: 'run-receipts-1', ctxId: `acdp://${AUTH_C}/attested-001`, agentId: DID_KEY, contextType: 'attestation', visibility: 'public', version: 1, registryAuthority: AUTH_C, scenarioId: 's22_receipts', keyFingerprint: 'sha256:bd61f88a4c70', receiptPresent: true },
  // ── RFC-ACDP-0013 lifecycle events (ACDP 0.3) ─────────────────────────
  // Registry-initiated hold + restore on the attested context (a pair).
  { id: 'ev-8', eventType: 'context_retracted', eventTs: iso(110), runId: null, ctxId: `acdp://${AUTH_C}/attested-001`, agentId: `did:web:${AUTH_C}`, contextType: 'attestation', version: 1, registryAuthority: AUTH_C },
  { id: 'ev-9', eventType: 'context_republished', eventTs: iso(80), runId: null, ctxId: `acdp://${AUTH_C}/attested-001`, agentId: `did:web:${AUTH_C}`, contextType: 'attestation', version: 1, registryAuthority: AUTH_C },
  // Producer-initiated retraction of the non-head cashflow v1.
  { id: 'ev-10', eventType: 'context_retracted', eventTs: iso(3600), runId: null, ctxId: `acdp://${AUTH_A}/2e78f01a-solo`, agentId: DID_SOLO, contextType: 'data_snapshot', version: 1, registryAuthority: AUTH_A },
  // Retraction of the fan-out FX derivative (renders retracted in the run DAG).
  { id: 'ev-11', eventType: 'context_retracted', eventTs: iso(3500), runId: 'run-fan-3', ctxId: `acdp://${AUTH_A}/d-102`, agentId: 'did:web:registry-a.local:agents:c2', contextType: 'analysis', version: 1, registryAuthority: AUTH_A, scenarioId: 's3_fanout' },
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
  receiptCoverage: [
    { registry_authority: AUTH_C, publish_count: 54, receipt_count: 54 },
    { registry_authority: AUTH_A, publish_count: 187, receipt_count: 142 },
    { registry_authority: AUTH_B, publish_count: 125, receipt_count: 71 },
  ],
  didMethods: [
    { method: 'did:web', publish_count: 248 },
    { method: 'did:key', publish_count: 58 },
    { method: 'other', publish_count: 6 },
  ],
};

// ── Agents ────────────────────────────────────────────────────────────
export const MOCK_AGENTS: KnownAgent[] = [
  { agentDid: DID_A, registryAuthority: AUTH_A, contextCount: 12, firstSeen: iso(172800), lastSeen: iso(8) },
  { agentDid: DID_B, registryAuthority: AUTH_B, contextCount: 8, firstSeen: iso(172800), lastSeen: iso(21) },
  { agentDid: DID_SOLO, registryAuthority: AUTH_A, contextCount: 47, firstSeen: iso(432000), lastSeen: iso(240) },
  { agentDid: DID_KEY, registryAuthority: AUTH_C, contextCount: 1, firstSeen: iso(140), lastSeen: iso(140) },
];

// ── Registries ────────────────────────────────────────────────────────
export const MOCK_REGISTRIES: KnownRegistry[] = [
  { authority: AUTH_A, baseUrl: 'http://localhost:8100', eventCount: 187, firstSeen: iso(432000), lastSeen: iso(8) },
  { authority: AUTH_B, baseUrl: 'http://localhost:8200', eventCount: 125, firstSeen: iso(432000), lastSeen: iso(3) },
  { authority: AUTH_C, baseUrl: 'http://localhost:8300', eventCount: 54, firstSeen: iso(86400 * 4), lastSeen: iso(140) },
];

export const MOCK_ENROLLMENTS: RegistryEnrollment[] = [
  {
    authority: AUTH_A,
    tenantId: 'default',
    baseUrl: 'http://localhost:8100',
    registryDid: `did:web:${AUTH_A}`,
    enabled: true,
    createdAt: iso(86400 * 30),
    updatedAt: iso(3600),
  },
  {
    authority: AUTH_B,
    tenantId: 'default',
    baseUrl: 'http://localhost:8200',
    registryDid: `did:web:${AUTH_B}`,
    enabled: true,
    createdAt: iso(86400 * 30),
    updatedAt: iso(7200),
  },
];

export const MOCK_CAPABILITIES: Record<CapabilityAuthority, RegistryCapabilities> = {
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
  // The receipts registry advertises the full ACDP 0.3.0 trust-profile stack
  // (RFC-ACDP-0011 head receipts, RFC-ACDP-0012 transparency log,
  // RFC-ACDP-0013 lifecycle) on top of the 0.2.0 receipts profile.
  c: {
    acdp_version: '0.3.0',
    registry_did: 'did:web:registry-c.playground.local',
    authority: AUTH_C,
    supported_signature_algorithms: ['ed25519', 'ecdsa-p256'],
    profiles: [
      'acdp-registry-core',
      'acdp-registry-receipts',
      'acdp-registry-head-receipts',
      'acdp-registry-transparency-log',
      'acdp-registry-lifecycle',
    ],
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
      description:
        'Composite snapshot fusing AIS vessel traffic, ice-coverage telemetry, and port throughput for the 2024 navigation season.',
      tags: ['geopolitics', 'logistics'],
      domain: 'geopolitics',
      acdp_version: '0.1.0',
      signature: {
        algorithm: 'ed25519',
        key_id: `${DID_A}#key-1`,
        value: 'z3MqA8m1c0Vd7xkR2pYbnLwQf6sТ4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oP9qR0',
      },
      supersedes: null,
      contributors: [DID_A],
      data_refs: [
        { type: 'data_snapshot', location: 's3://acdp-demo/arctic/ais-2024.parquet', encoding: 'application/parquet' },
      ],
      data_period: { start: iso(86400 * 120), end: iso(16) },
      expires_at: iso(-86400 * 30),
      schema_uri: 'https://schemas.acdp.dev/data_snapshot/v1.json',
    },
    registry_state: { status: 'active' },
    // RFC-ACDP-0010 receipt — bindings all match the served body (clean verify).
    registry_receipt: {
      registry_did: `did:web:${AUTH_C}`,
      ctx_id: LIVE_LINEAGE.nodes[0].ctx_id,
      lineage_id: 'lin-arctic-001',
      origin_registry: AUTH_A,
      created_at: iso(16),
      content_hash: 'sha256:f170150d8c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8',
      key_fingerprint: 'sha256:1f4a90c2e7b3d5089a6c4e21f7b0d9c8a3e5f6071b2c4d8e9f0a1b2c3d4e5f6a7',
      signature: {
        algorithm: 'ed25519',
        key_id: `did:web:${AUTH_C}#receipt-key-1`,
        value: 'zRcptA8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oP9qR0',
      },
    },
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
      description: 'Risk-weighted investment thesis across shipping, insurance, and port-infrastructure equities.',
      tags: ['investment', 'analysis'],
      domain: 'finance',
      acdp_version: '0.1.0',
      signature: {
        algorithm: 'ecdsa-p256',
        key_id: `${DID_B}#key-2`,
        value: 'zP256bQc1dWe8ylS3qZcoMxRg7tU5vK0iH1fY2bC3dE4fG5hI6jK7lM8nO9pQ0rS1',
      },
      supersedes: null,
      contributors: [DID_B, DID_A],
      audience: [DID_A],
      data_refs: [
        { type: 'report', location: 'https://reports.acdp-demo/arctic-investment.pdf', encoding: 'application/pdf' },
      ],
      schema_uri: 'https://schemas.acdp.dev/analysis/v1.json',
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
      description: 'Operating, investing, and financing cash flows for the trailing quarter.',
      tags: ['finance'],
      domain: 'finance',
      acdp_version: '0.1.0',
      signature: {
        algorithm: 'ed25519',
        key_id: `${DID_SOLO}#key-1`,
        value: 'zCa5hF1ow2sN3apShOt4qWeRtYuIoP5aSdFgHjKlZxCvBnM6qWeRtYuIoP7aSdFg',
      },
      supersedes: null,
      contributors: [DID_SOLO],
      data_refs: [
        { type: 'data_snapshot', location: 's3://acdp-demo/finance/cashflow-q.json', encoding: 'application/json' },
      ],
      data_period: { start: iso(86400 * 90), end: iso(272) },
    },
    // Retracted by its producer after v2 shipped (RFC-ACDP-0013): a non-head
    // version, so the lineage's "current" pointer (v2) is unaffected.
    registry_state: {
      status: 'retracted',
      lifecycle_events: [
        {
          event_id: 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          ctx_id: `acdp://${AUTH_A}/2e78f01a-solo`,
          event_type: 'retracted',
          occurred_at: iso(3600),
          actor: DID_SOLO,
          reason: 'Reconciliation error: intercompany transfers were double-counted. Superseded by the revised v2 snapshot.',
          signature: {
            algorithm: 'ed25519',
            key_id: `${DID_SOLO}#key-1`,
            value: 'zLcEvtRetrA8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8o',
          },
        },
      ],
    },
  },
  {
    body: {
      ctx_id: `acdp://${AUTH_C}/attested-001`,
      lineage_id: 'lin-attested-001',
      origin_registry: AUTH_C,
      created_at: iso(140),
      content_hash: 'sha256:bd61f88a4c70e2139f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
      version: 1,
      agent_id: DID_KEY,
      title: 'Attested disclosure — did:key ephemeral agent',
      type: 'attestation',
      visibility: 'public',
      derived_from: [],
      summary: 'Offline-verifiable disclosure published by an ephemeral did:key agent to the receipts registry.',
      description: 'Demonstrates the RFC-ACDP-0010 receipts profile: the producer key is embedded in the did:key identifier and pinned by the registry receipt.',
      tags: ['attestation', 'did:key'],
      domain: 'compliance',
      acdp_version: '0.2.0',
      signature: {
        algorithm: 'ed25519',
        key_id: `${DID_KEY}#key-1`,
        value: 'zDidKeyA8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oP9',
      },
      supersedes: null,
      contributors: [DID_KEY],
    },
    // Retracted-then-republished pair (RFC-ACDP-0013): the registry held the
    // context pending review, then restored it — final status is active again.
    registry_state: {
      status: 'active',
      lifecycle_events: [
        {
          event_id: 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
          ctx_id: `acdp://${AUTH_C}/attested-001`,
          event_type: 'retracted',
          occurred_at: iso(110),
          actor: `did:web:${AUTH_C}`,
          reason: 'Held pending compliance review of the attested claims.',
          signature: {
            algorithm: 'ed25519',
            key_id: `did:web:${AUTH_C}#receipt-key-1`,
            value: 'zLcEvtHoldC8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8',
          },
        },
        {
          event_id: 'c3d4e5f6-7a8b-4c9d-a0e1-2b3c4d5e6f7a',
          ctx_id: `acdp://${AUTH_C}/attested-001`,
          event_type: 'republished',
          occurred_at: iso(80),
          actor: `did:web:${AUTH_C}`,
          reason: 'Compliance review cleared; attestation restored.',
          signature: {
            algorithm: 'ed25519',
            key_id: `did:web:${AUTH_C}#receipt-key-1`,
            value: 'zLcEvtRepubD8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN',
          },
        },
      ],
    },
    registry_receipt: {
      registry_did: `did:web:${AUTH_C}`,
      ctx_id: `acdp://${AUTH_C}/attested-001`,
      lineage_id: 'lin-attested-001',
      origin_registry: AUTH_C,
      created_at: iso(140),
      content_hash: 'sha256:bd61f88a4c70e2139f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
      key_fingerprint: 'sha256:bd61f88a4c70e2139f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
      signature: {
        algorithm: 'ed25519',
        key_id: `did:web:${AUTH_C}#receipt-key-1`,
        value: 'zRcptKeyB8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oP',
      },
    },
    // RFC-ACDP-0011 serve-time head attestation: this v1 IS the lineage head,
    // so all bindings match the served body.
    lineage_head_receipt: {
      receipt_version: 'acdp-lhr/1',
      registry_did: `did:web:${AUTH_C}`,
      lineage_id: 'lin-attested-001',
      head_ctx_id: `acdp://${AUTH_C}/attested-001`,
      head_version: 1,
      head_status: 'active',
      as_of: iso(45),
      signature: {
        algorithm: 'ed25519',
        key_id: `did:web:${AUTH_C}#receipt-key-1`,
        value: 'zLhrKeyE8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oPq',
      },
    },
    // RFC-ACDP-0012 inclusion proof: leaf 41 of the 54-leaf receipts log,
    // proof and checkpoint agree on tree_size/log_id.
    log_inclusion: {
      log_id: `did:web:${AUTH_C}/log/receipts`,
      leaf_index: 41,
      tree_size: 54,
      inclusion_path: [
        'sha256:3a91c47bd025e86f3a91c47bd025e86f3a91c47bd025e86f3a91c47bd025e86f',
        'sha256:7be24d90fa6c1e537be24d90fa6c1e537be24d90fa6c1e537be24d90fa6c1e53',
        'sha256:c58f01a3d7492b6ec58f01a3d7492b6ec58f01a3d7492b6ec58f01a3d7492b6e',
        'sha256:e1462fb98c05d37ae1462fb98c05d37ae1462fb98c05d37ae1462fb98c05d37a',
        'sha256:0d73a5c4e982f61b0d73a5c4e982f61b0d73a5c4e982f61b0d73a5c4e982f61b',
        'sha256:92b6e08fd41c375a92b6e08fd41c375a92b6e08fd41c375a92b6e08fd41c375a',
      ],
      log_checkpoint: {
        checkpoint_version: 'acdp-log/1',
        log_id: `did:web:${AUTH_C}/log/receipts`,
        tree_size: 54,
        root_hash: 'sha256:d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63',
        timestamp: iso(45),
        signature: {
          algorithm: 'ed25519',
          key_id: `did:web:${AUTH_C}#receipt-key-1`,
          value: 'zCkptKeyF8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oP',
        },
      },
      // RFC-ACDP-0015 §6.1: two independent witnesses cosigned this exact
      // checkpoint tuple (log_id / tree_size / root_hash copied verbatim), so
      // the surface renders "2-witnessed" with all bindings green. Each witness
      // uses its OWN DID + key (a witness is not a registry) and its own
      // witness-clock observation time — a sibling of log_checkpoint, never
      // inside the closed, signed checkpoint.
      witness_signatures: [
        {
          cosignature_version: 'acdp-cosig/1',
          witness_id: 'did:web:witness-alpha.trust.example',
          witnessed_checkpoint: {
            log_id: `did:web:${AUTH_C}/log/receipts`,
            tree_size: 54,
            root_hash: 'sha256:d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63',
            timestamp: iso(45),
          },
          witnessed_at: iso(30),
          signature: {
            algorithm: 'ed25519',
            key_id: 'did:web:witness-alpha.trust.example#cosig-key-1',
            value: 'zWitAlpha7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oPqRsTuVwXy',
          },
        },
        {
          cosignature_version: 'acdp-cosig/1',
          witness_id: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
          witnessed_checkpoint: {
            log_id: `did:web:${AUTH_C}/log/receipts`,
            tree_size: 54,
            root_hash: 'sha256:d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63d94f0b7a12c85e63',
            timestamp: iso(45),
          },
          witnessed_at: iso(75),
          signature: {
            algorithm: 'ed25519',
            key_id: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
            value: 'zWitBeta9c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8oPqRsTu',
          },
        },
      ],
    },
  },
];

// ── Lineage chains (by lineage_id) ────────────────────────────────────
// A v2 that supersedes the cashflow snapshot, so the chain view has a real
// multi-version example to render.
const CASHFLOW_V1 = MOCK_CONTEXTS[2];
const CASHFLOW_V2: FullContext = {
  body: {
    ...CASHFLOW_V1.body,
    ctx_id: `acdp://${AUTH_A}/2e78f01a-solo-v2`,
    version: 2,
    supersedes: CASHFLOW_V1.body.ctx_id,
    created_at: iso(86400),
    title: 'Quarterly cash flow snapshot (revised)',
    summary: 'Revised quarterly operating cash flow figures after reconciliation.',
    content_hash: 'sha256:bb22c8a3f2e1d4b5a6c7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
  },
  registry_state: { status: 'active' },
};

/** Full version chain keyed by lineage_id, oldest → newest. */
export const MOCK_LINEAGE_CHAINS: Record<string, FullContext[]> = {
  [CASHFLOW_V1.body.lineage_id]: [CASHFLOW_V1, CASHFLOW_V2],
  [MOCK_CONTEXTS[0].body.lineage_id]: [MOCK_CONTEXTS[0]],
  [MOCK_CONTEXTS[1].body.lineage_id]: [MOCK_CONTEXTS[1]],
};

// ── Security: revocations + signing keys ──────────────────────────────
const nowSec = Math.floor(now / 1000);

export const MOCK_REVOCATIONS: RevocationEntry[] = [
  {
    jti: 'tok-9f2a1c4e-rotated',
    sub: DID_B,
    iss: `did:web:${AUTH_A}`,
    exp: nowSec + 3600,
    revoked_at_ms: now - 42 * 60 * 1000,
  },
  {
    jti: 'tok-3b7d8e90-compromised',
    sub: DID_SOLO,
    iss: `did:web:${AUTH_A}`,
    exp: nowSec + 1800,
    revoked_at_ms: now - 5 * 60 * 60 * 1000,
  },
  {
    jti: 'tok-c1a44f02-keyrotation',
    sub: DID_A,
    iss: `did:web:${AUTH_B}`,
    exp: nowSec + 7200,
    revoked_at_ms: now - 26 * 60 * 60 * 1000,
  },
];

export const MOCK_JWKS: Record<RegistryAuthority, JwkSet> = {
  a: {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'key-1',
        use: 'sig',
        alg: 'EdDSA',
        x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
      },
    ],
  },
  b: {
    keys: [
      {
        kty: 'EC',
        crv: 'P-256',
        kid: 'key-2',
        use: 'sig',
        alg: 'ES256',
        x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
        y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      },
    ],
  },
};

export const MOCK_SEARCH_HITS: SearchHit[] = MOCK_CONTEXTS.map((c) => ({
  ctx_id: c.body.ctx_id,
  lineage_id: c.body.lineage_id,
  agent_id: c.body.agent_id,
  title: c.body.title,
  type: c.body.type,
  created_at: c.body.created_at,
  status: c.registry_state?.status ?? 'active',
  summary: c.body.summary,
  domain: c.body.domain,
  visibility: c.body.visibility,
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
  { name: 'acdp_publish_receipts_total', type: 'counter', value: 267, help: 'Publishes carrying a registry receipt' },
  { name: 'acdp_producer_did_method_total', type: 'counter', value: 312, help: 'Publishes by producer DID method' },
  { name: 'acdp_receipt_audits_total', type: 'counter', value: 9, help: 'Receipt-audit verdicts recorded' },
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
  { component: 'ACDP spec', version: '0.3.0 Final / 0.4.0 Draft', status: 'ok' },
  { component: 'acdp-rs library', version: '0.5.3', status: 'ok' },
  { component: 'acdp-py binding', version: '0.7.0', status: 'ok' },
  { component: 'acdp-node binding', version: '0.7.0', status: 'ok' },
  { component: 'Registry (Rust/axum)', version: '0.3.0 + 0.4.0 witness agg', status: 'ok' },
  { component: 'Control Plane (NestJS)', version: '0.4.0 witness', status: 'ok' },
  { component: 'Playground (FastAPI)', version: '0.4.0 (S28-S31)', status: 'ok' },
];
