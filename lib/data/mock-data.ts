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
  LogWitnessState,
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
import type { LineageHeadReceipt, LogInclusion, RegistryReceipt } from '@/lib/types';
import { DID_KEY_PRODUCER, LIN_ATTESTED, MOCK_CRYPTO } from '@/lib/data/mock-crypto';
export { MOCK_DID_DOCS } from '@/lib/data/mock-crypto';

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
const DID_KEY = DID_KEY_PRODUCER; // ephemeral did:key agent (real key, minted in mock-crypto)

// ── Scenarios (mirrors playground catalog, S1–S21) ────────────────────
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
  {
    id: 's21_capabilities_p256',
    name: 'CP Capability P-256 Declaration',
    description:
      'A P-256 agent self-declares a capability with the ecdsa-p256 signature the control plane\'s capability DTO now accepts; fully offline, signature self-verified.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: {},
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
  // ── ACDP 0.3 lifecycle, transparency-log & witness scenarios (S27–S32) ──
  {
    id: 's27_receipt_key_rotation',
    name: 'Receipt Key Rotation',
    description: 'A registry rotates its receipt-signing key; new receipts verify against the current key while pinned historical ones stay valid.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'receipt key rotation' },
  },
  {
    id: 's28_lifecycle_retraction',
    name: 'Lifecycle Retraction',
    description: 'A published context is retracted (RFC-ACDP-0013); the registry serves a retraction receipt and the lineage head reflects the retracted state.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'retract disclosure' },
  },
  {
    id: 's29_transparency_log',
    name: 'Transparency Log Inclusion',
    description: 'A receipt is entered into the append-only transparency log (RFC-ACDP-0012); the consumer verifies the inclusion proof against a signed checkpoint.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'logged attestation' },
  },
  {
    id: 's30_head_receipt_freshness',
    name: 'Head Receipt Freshness',
    description: 'A lineage-head receipt (RFC-ACDP-0011) proves the current head; a stale head is detected via the receipt timestamp/counter.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'lineage head freshness' },
  },
  {
    id: 's31_witness_cosigning',
    name: 'Witness Cosigning',
    description: 'Independent witnesses cosign a transparency-log checkpoint (RFC-ACDP-0015); a quorum of distinct witness signatures is verified offline.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'witnessed checkpoint' },
  },
  {
    id: 's32_key_revocation',
    name: 'Key Revocation',
    description: 'A producer key is revoked; contexts signed after the revocation instant fail closed while pre-revocation receipts stay historically authorized.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'revoked producer key' },
  },
  // ── RFC-ACDP-0016 external anchors (0.5.0 line, Draft) ──────────────
  {
    id: 's33_anchors',
    name: 'External Anchors',
    description:
      'A well-formed anchors entry is accepted and signed like any other field (anc-001); a scheme-unaware verifier still produces a valid verdict while structurally never dereferencing anchors[].uri (anc-005, RFC-ACDP-0016 §6). A tampered anchor fails closed. The live half supersedes twice to exercise the anchors carry-forward / clear_anchors fix in Producer::new_version_from.',
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'anchored settlement snapshot' },
  },
  {
    id: 's34_embedded_content',
    name: 'Embedded Content Integrity',
    description:
      "A data_refs[].embedded payload's own content_hash (RFC-ACDP-0002 §6.3/§6.6 Check 8) is verified over the decoded bytes — JCS form for json, raw UTF-8 for utf8, decoded bytes for base64. It is independent of the DataRef-root content_hash (§6.1): one foreign digest is accepted in the root slot and rejected in the embedded slot. Absent is legal, explicit null is a deserialization failure, and tampered content fails closed at both the body and data-ref layers.",
    registry_mode: 'single',
    agent_count: 1,
    framework: 'langchain',
    default_inputs: { topic: 'inline sensor snapshot' },
  },
];

export const SCENARIO_COUNT = MOCK_SCENARIOS.length;

// ── Lineage graphs ────────────────────────────────────────────────────
const LIVE_LINEAGE: LineageGraph = {
  nodes: [
    {
      ctx_id: `acdp://${AUTH_A}/d1feb434-ef44-4166-b3ac-a157f795661d`,
      agent_id: DID_A,
      title: 'Cross-registry source — Arctic shipping routes',
      context_type: 'data_snapshot',
      registry_authority: AUTH_A,
      step: 1,
    },
    {
      ctx_id: `acdp://${AUTH_B}/29b45ae4-1607-4e71-9efc-5016babeb19c`,
      agent_id: DID_B,
      title: 'Cross-registry derivative — Arctic investment analysis',
      context_type: 'analysis',
      registry_authority: AUTH_B,
      step: 2,
    },
  ],
  edges: [
    {
      src: `acdp://${AUTH_A}/d1feb434-ef44-4166-b3ac-a157f795661d`,
      dst: `acdp://${AUTH_B}/29b45ae4-1607-4e71-9efc-5016babeb19c`,
    },
  ],
};

const FANOUT_LINEAGE: LineageGraph = {
  nodes: [
    { ctx_id: `acdp://${AUTH_A}/c63ebc23-ff31-49d0-9983-62f656f6e1a8`, agent_id: DID_SOLO, title: 'Market sentiment source', context_type: 'data_snapshot', registry_authority: AUTH_A, step: 1 },
    { ctx_id: `acdp://${AUTH_A}/2e4d1a86-5807-4132-963e-6834fbecdd47`, agent_id: 'did:web:registry-a.local:agents:c1', title: 'Equities take', context_type: 'analysis', registry_authority: AUTH_A, step: 2 },
    // Retracted after publication (RFC-ACDP-0013) — renders dashed/danger in the DAG.
    { ctx_id: `acdp://${AUTH_A}/bb20faad-dcc5-46a3-9056-b1d55f610333`, agent_id: 'did:web:registry-a.local:agents:c2', title: 'FX take', context_type: 'analysis', registry_authority: AUTH_A, step: 2, status: 'retracted' },
    { ctx_id: `acdp://${AUTH_A}/5587233c-7150-42ca-b8c8-691b6cc13f6a`, agent_id: 'did:web:registry-a.local:agents:c3', title: 'Commodities take', context_type: 'analysis', registry_authority: AUTH_A, step: 2 },
  ],
  edges: [
    { src: `acdp://${AUTH_A}/c63ebc23-ff31-49d0-9983-62f656f6e1a8`, dst: `acdp://${AUTH_A}/2e4d1a86-5807-4132-963e-6834fbecdd47` },
    { src: `acdp://${AUTH_A}/c63ebc23-ff31-49d0-9983-62f656f6e1a8`, dst: `acdp://${AUTH_A}/bb20faad-dcc5-46a3-9056-b1d55f610333` },
    { src: `acdp://${AUTH_A}/c63ebc23-ff31-49d0-9983-62f656f6e1a8`, dst: `acdp://${AUTH_A}/5587233c-7150-42ca-b8c8-691b6cc13f6a` },
  ],
};

export const MOCK_LINEAGE: Record<string, LineageGraph> = {
  [LIVE_RUN_ID]: LIVE_LINEAGE,
  [COMPLETED_RUN_ID]: {
    nodes: [
      { ctx_id: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`, agent_id: DID_SOLO, title: 'Quarterly cash flow snapshot', context_type: 'data_snapshot', registry_authority: AUTH_A, step: 1 },
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
    { type: 'acdp.publish', run_id: COMPLETED_RUN_ID, ts: iso(272), agent_id: DID_SOLO, ctx_id: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`, title: 'Quarterly cash flow snapshot', registry_authority: AUTH_A, contexts_produced: 1 },
    { type: 'run.complete', run_id: COMPLETED_RUN_ID, ts: iso(271), scenario_id: 's1_single_publish', contexts_produced: 1 },
  ],
  [FAILED_RUN_ID]: [
    { type: 'run.started', run_id: FAILED_RUN_ID, ts: iso(1320), scenario_id: 's15_supersession_lineage' },
    { type: 'agent.started', run_id: FAILED_RUN_ID, ts: iso(1319), agent_id: DID_SOLO },
    { type: 'acdp.publish', run_id: FAILED_RUN_ID, ts: iso(1315), agent_id: DID_SOLO, ctx_id: `acdp://${AUTH_A}/96976a64-745d-4dab-a874-b481b06120db`, title: 'Forecast model v1', registry_authority: AUTH_A, contexts_produced: 1 },
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
    // Offline isolation invariant proved, but the live cross-tenant round-trip
    // couldn't be exercised in this environment — the run degrades (RFC-ACDP
    // offline-core semantics), which the summary flags.
    result: { summary: { degraded: true } },
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
          ctxId: `acdp://${AUTH_B}/f24ba292-b358-4343-a077-2d08c3c018b0`,
          status: 'discrepancy',
          discrepancies: [
            // Fabricated/illustrative truncated hashes for the demo narrative — not derived
            // from MOCK_CRYPTO or any real fixture, so they don't reference any ctx_id/UUID
            // rewrite elsewhere in this file and should not be "fixed" to match one.
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
    registries: [AUTH_A],
    inputs: { topic: 'rotated signing key' },
    // The producer rotated its key after publishing; the pre-rotation context
    // still verifies against the retired key pinned by the receipt (RFC-ACDP-0010
    // §9 historically authorized) — cryptographically valid, just not current.
    trust: { audited: 1, verified: 0, verifiedHistorical: 1, structural: 0, noReceipt: 0, errors: 0, flagged: [] },
  },
  {
    runId: 'run-revoked-1',
    tenantId: 'default',
    scenarioId: 's32_key_revocation',
    status: 'completed',
    startedAt: iso(1900),
    completedAt: iso(1850),
    contextsCount: 3,
    registries: [AUTH_A],
    inputs: { topic: 'revoked producer key' },
    // DID_A's signing key was revoked mid-window (RFC-ACDP-0014, see the
    // key-revocation context fixture in MOCK_CONTEXTS). All three contexts pass
    // the baseline RFC-ACDP-0010 receipt audit (verified: 3) — compromise
    // doesn't invalidate the signature math, only its trustworthiness (§7) —
    // which is exactly why the orthogonal revocation check below matters, and
    // why this fixture carries one event of each verdict class: one published
    // before the compromise boundary is historically authorized, one published
    // at/after it fails closed despite its valid receipt, and one whose signing
    // time can't be established fails closed too, because an unprovable
    // ordering is not an authorization.
    trust: {
      audited: 3,
      verified: 3,
      verifiedHistorical: 0,
      structural: 0,
      noReceipt: 0,
      errors: 0,
      flagged: [],
      keyRevocationPreCompromise: 1,
      keyRevocationRevokedAtOrAfter: 1,
      // MOCK_DASHBOARD.keyRevocation advertises a `revokedTimeUnverifiable`,
      // but no run fixture produced one — so the amber chip branch and the
      // fail-closed-but-not-at-or-after path were unreachable in demo mode,
      // and an operator clicking through from that KPI found nothing. This is
      // the only way a human can exercise them before deploy.
      keyRevocationRevokedTimeUnverifiable: 1,
      revoked: [
        {
          eventId: 'ev-revoked-1',
          ctxId: `acdp://${AUTH_A}/d3a8c1e2-9f4b-4a6d-8c5e-2b7f1a9d3c6e`,
          status: 'pre_compromise',
          boundary: '2026-08-01 00:00:00+00',
          trustClass: 'producer_signed',
          sources: [{ ctxId: `acdp://${AUTH_A}/c4f1a2b3-6d7e-4f8a-9b0c-1d2e3f4a5b6c`, publisher: DID_A }],
        },
        {
          eventId: 'ev-revoked-2',
          ctxId: `acdp://${AUTH_A}/e7b2f4a1-3d6c-4f8e-9a1b-5c3d7e9f2a4b`,
          status: 'revoked_at_or_after',
          boundary: '2026-08-01 00:00:00+00',
          trustClass: 'producer_signed',
          sources: [{ ctxId: `acdp://${AUTH_A}/c4f1a2b3-6d7e-4f8a-9b0c-1d2e3f4a5b6c`, publisher: DID_A }],
        },
        {
          // RFC-ACDP-0014 §7: the signing time could not be established, so it
          // cannot be shown to precede the boundary. Fail-closed — an
          // unprovable ordering is not an authorization. `registry_attested`
          // rather than `producer_signed` because this is exactly the class
          // where the receipt's attested time is what is missing or untrusted.
          eventId: 'ev-revoked-3',
          ctxId: `acdp://${AUTH_A}/f1c9d3b7-5a2e-4c8d-b6f0-3e7a1d5c9b2f`,
          status: 'revoked_time_unverifiable',
          boundary: '2026-08-01 00:00:00+00',
          trustClass: 'registry_attested',
          sources: [{ ctxId: `acdp://${AUTH_A}/c4f1a2b3-6d7e-4f8a-9b0c-1d2e3f4a5b6c`, publisher: DID_A }],
        },
      ],
    },
  },
];

// ── Context events (global firehose / history) ────────────────────────
export const MOCK_CONTEXT_EVENTS: CpContextEvent[] = [
  { id: 'ev-1', eventType: 'context_published', eventTs: iso(8), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_A, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's5_cross_registry', keyFingerprint: 'sha256:1f4a90c2e7b3', receiptPresent: true },
  { id: 'ev-2', eventType: 'context_retrieved', eventTs: iso(11), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[0].ctx_id, agentId: DID_B, registryAuthority: AUTH_B, scenarioId: 's5_cross_registry' },
  { id: 'ev-3', eventType: 'context_published', eventTs: iso(3), runId: LIVE_RUN_ID, ctxId: LIVE_LINEAGE.nodes[1].ctx_id, agentId: DID_B, contextType: 'analysis', visibility: 'public', version: 1, derivedFrom: [LIVE_LINEAGE.nodes[0].ctx_id], registryAuthority: AUTH_B, scenarioId: 's5_cross_registry', keyFingerprint: 'sha256:a07c5d1b9e22', receiptPresent: false },
  { id: 'ev-4', eventType: 'context_published', eventTs: iso(272), runId: COMPLETED_RUN_ID, ctxId: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`, agentId: DID_SOLO, contextType: 'data_snapshot', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's1_single_publish', keyFingerprint: 'sha256:3c8e2f04a1d6', receiptPresent: true },
  { id: 'ev-5', eventType: 'search_executed', eventTs: iso(300), runId: COMPLETED_RUN_ID, agentId: DID_SOLO, registryAuthority: AUTH_A, scenarioId: 's1_single_publish' },
  { id: 'ev-6', eventType: 'context_published', eventTs: iso(710), runId: 'run-c4d5e6f7', ctxId: `acdp://${AUTH_A}/fee57f10-e884-42f8-b01f-c12eb4fa54e0`, agentId: 'did:web:registry-a.local:agents:tenant-a', contextType: 'data_snapshot', visibility: 'restricted', version: 1, registryAuthority: AUTH_A, scenarioId: 's10_tenant_isolation' },
  { id: 'ev-7', eventType: 'context_published', eventTs: iso(140), runId: 'run-receipts-1', ctxId: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`, agentId: DID_KEY, contextType: 'demo:attestation', visibility: 'public', version: 1, registryAuthority: AUTH_A, scenarioId: 's22_receipts', keyFingerprint: 'sha256:bd61f88a4c70', receiptPresent: true },
  // ── RFC-ACDP-0013 lifecycle events (ACDP 0.3) ─────────────────────────
  // Registry-initiated hold + restore on the attested context (a pair).
  { id: 'ev-8', eventType: 'context_retracted', eventTs: iso(110), runId: null, ctxId: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`, agentId: `did:web:${AUTH_A}`, contextType: 'demo:attestation', version: 1, registryAuthority: AUTH_A },
  { id: 'ev-9', eventType: 'context_republished', eventTs: iso(80), runId: null, ctxId: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`, agentId: `did:web:${AUTH_A}`, contextType: 'demo:attestation', version: 1, registryAuthority: AUTH_A },
  // Producer-initiated retraction of the non-head cashflow v1.
  { id: 'ev-10', eventType: 'context_retracted', eventTs: iso(3600), runId: null, ctxId: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`, agentId: DID_SOLO, contextType: 'data_snapshot', version: 1, registryAuthority: AUTH_A },
  // Retraction of the fan-out FX derivative (renders retracted in the run DAG).
  { id: 'ev-11', eventType: 'context_retracted', eventTs: iso(3500), runId: 'run-fan-3', ctxId: `acdp://${AUTH_A}/bb20faad-dcc5-46a3-9056-b1d55f610333`, agentId: 'did:web:registry-a.local:agents:c2', contextType: 'analysis', version: 1, registryAuthority: AUTH_A, scenarioId: 's3_fanout' },
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
    { registry_authority: AUTH_A, publish_count: 187, receipt_count: 142 },
    { registry_authority: AUTH_B, publish_count: 125, receipt_count: 71 },
  ],
  didMethods: [
    { method: 'did:web', publish_count: 248 },
    { method: 'did:key', publish_count: 58 },
    { method: 'other', publish_count: 6 },
  ],
  keyRevocation: { preCompromise: 9, revokedAtOrAfter: 2, revokedTimeUnverifiable: 1 },
};

// ── Dashboard: per-window demo payloads ───────────────────────────────
//
// The demo branch used to return `{...MOCK_DASHBOARD, window}` for every
// window, so the overview claimed the same 47 runs under "window 1h" as under
// "window 30d" — and, because `keyRevocation` was always `{9, 2, 1}`, the
// dashboard's "revocation not reported" degrade path was unreachable by a human
// in the default mode. It could only ever be seen in a test, which is the gap
// this console's own review standard calls out.
//
// The aggregates are scaled off the 24 h fixture rather than hand-authored five
// times: they are illustrative, and five parallel fixtures would drift.
const DEMO_WINDOW_SCALE: Record<string, number> = {
  '1h': 0.06,
  '6h': 0.3,
  '24h': 1,
  '7d': 4.2,
  '30d': 12,
};

// `keyRevocation` is NOT scaled. It is the field the degrade path keys on, so
// making the not-reported branch reachable must be a deliberate fixture rather
// than an accident of where a rounding rule happens to land. Two windows are
// pinned; every other window inherits the 24 h figures.
//
//   1h → all zero        → "not reported" (the degrade path)
//   6h → one non-zero    → figures render, INCLUDING the two genuine zeros
//                          beside it — the heuristic's other arm, also
//                          otherwise invisible to a human.
const DEMO_WINDOW_REVOCATION: Record<string, CpDashboardOverview['keyRevocation']> = {
  '1h': { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 },
  '6h': { preCompromise: 2, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 },
};

/**
 * The demo `/dashboard/overview` payload for one window.
 *
 * **Every headline figure is DERIVED from its own scaled parts, never scaled
 * independently.** Scaling the totals and the breakdowns separately rounds them
 * apart: at `6h` an independently-scaled `totalRuns` came out 14 while its own
 * scenario bars summed to 15, and the DID-method bars missed `totalContexts` by
 * one at two windows. The 24 h fixture holds `Σ byScenario === totalRuns` and
 * `Σ byRegistry === Σ didMethods === totalContexts`; a window picker that
 * visibly breaks those is worse than no picker, since the whole reason the
 * picker exists is to let a human look at this page.
 */
export function demoDashboardForWindow(window: string): CpDashboardOverview {
  const scale = DEMO_WINDOW_SCALE[window] ?? 1;
  const n = (v: number) => Math.round(v * scale);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // Scenarios with no runs in a short window are dropped rather than drawn as
  // zero-height bars — and the total is then read off what remains, so the
  // chart and the KPI cannot disagree.
  const byScenario = MOCK_DASHBOARD.byScenario
    .map((s) => ({ ...s, run_count: n(s.run_count) }))
    .filter((s) => s.run_count > 0);
  const totalRuns = sum(byScenario.map((s) => s.run_count));

  const byRegistry = MOCK_DASHBOARD.byRegistry.map((r) => ({ ...r, event_count: n(r.event_count) }));
  const totalContexts = sum(byRegistry.map((r) => r.event_count));

  // Receipts ride the same per-registry publish counts, so coverage can never
  // report more receipts than publishes.
  // Keyed by authority, NOT by index: the two lists happen to be in the same
  // order today, and a positional join would go silently wrong the moment
  // either is reordered or a third registry is added.
  const eventsByAuthority = new Map(byRegistry.map((r) => [r.registry_authority, r.event_count]));
  const receiptCoverage = MOCK_DASHBOARD.receiptCoverage?.map((r) => {
    const publish_count = eventsByAuthority.get(r.registry_authority) ?? n(r.publish_count);
    return { ...r, publish_count, receipt_count: Math.min(publish_count, n(r.receipt_count)) };
  });

  // The DID-method split must sum to `totalContexts` exactly, so the last
  // bucket absorbs the rounding remainder instead of leaving the bars off by
  // one against the KPI above them.
  const didHead = (MOCK_DASHBOARD.didMethods ?? []).slice(0, -1).map((m) => ({ ...m, publish_count: n(m.publish_count) }));
  const didLast = (MOCK_DASHBOARD.didMethods ?? []).at(-1);
  const didMethods = didLast
    ? [...didHead, { ...didLast, publish_count: Math.max(0, totalContexts - sum(didHead.map((m) => m.publish_count))) }]
    : MOCK_DASHBOARD.didMethods;

  return {
    ...MOCK_DASHBOARD,
    window,
    totalRuns,
    totalContexts,
    // At least one agent whenever anything ran — `round(12 × 0.06)` is 1, but a
    // narrower window must not report runs produced by nobody.
    totalAgents: totalRuns > 0 ? Math.max(1, n(MOCK_DASHBOARD.totalAgents)) : 0,
    recentRuns: MOCK_DASHBOARD.recentRuns.slice(0, Math.max(0, Math.min(MOCK_DASHBOARD.recentRuns.length, totalRuns))),
    byScenario,
    byRegistry,
    receiptCoverage,
    didMethods,
    keyRevocation: DEMO_WINDOW_REVOCATION[window] ?? MOCK_DASHBOARD.keyRevocation,
  };
}

// ── Agents ────────────────────────────────────────────────────────────
export const MOCK_AGENTS: KnownAgent[] = [
  { agentDid: DID_A, registryAuthority: AUTH_A, contextCount: 12, firstSeen: iso(172800), lastSeen: iso(8) },
  { agentDid: DID_B, registryAuthority: AUTH_B, contextCount: 8, firstSeen: iso(172800), lastSeen: iso(21) },
  { agentDid: DID_SOLO, registryAuthority: AUTH_A, contextCount: 47, firstSeen: iso(432000), lastSeen: iso(240) },
  { agentDid: DID_KEY, registryAuthority: AUTH_A, contextCount: 1, firstSeen: iso(140), lastSeen: iso(140) },
];

// ── Registries ────────────────────────────────────────────────────────
export const MOCK_REGISTRIES: KnownRegistry[] = [
  { authority: AUTH_A, baseUrl: 'http://localhost:8100', eventCount: 187, firstSeen: iso(432000), lastSeen: iso(8) },
  { authority: AUTH_B, baseUrl: 'http://localhost:8200', eventCount: 125, firstSeen: iso(432000), lastSeen: iso(3) },
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
  // registry-a hosts the receipts profile directly (playground consolidated to a
  // two-registry topology): its capabilities advertise the full trust-profile
  // stack — RFC-ACDP-0010 receipts, RFC-ACDP-0011 head receipts, RFC-ACDP-0012
  // transparency log, RFC-ACDP-0013 lifecycle.
  //
  // `acdp_version` is 0.5.0. The demo describes ONE registry-a and used to give
  // it two different protocol versions on two different pages: this value on
  // /registries (`registry-card.tsx`) and the SDK matrix's registry row on
  // /config.
  //
  // 0.5.0 is not a judgement call — it is what the real binary advertises.
  // Both playground registries build from `acdp-registry-rs`
  // (`acdp-playground/docker-compose.yml`), whose
  // `acdp_version_claim()` folds an UNCONDITIONAL `(5, "0.5.0")` anchors claim
  // into its max-over-claims (`crates/acdp-registry-server/src/main.rs`,
  // `ANCHORS_VERSION_CLAIM`). Its own comment: "this always advertises >= 0.5.0
  // regardless of config", its own test asserts `"0.5.0"` on bare defaults, and
  // `docs/HTTP-API.md` states it unconditionally. In real mode this page shows
  // 0.5.0; the demo now says the same thing.
  //
  // Both earlier numbers were superseded upstream rather than wrong-at-the-time:
  // 0.3.0 came from `acdp-playground/config/registry-a.toml`'s own comment about
  // the receipts/lifecycle/log ladder, and 0.4.0 is a middle rung that the
  // unconditional anchors claim now shadows. Note also that the demo carries
  // `s33_anchors` below, and a publish with `anchors` is REJECTED by a registry
  // advertising < 0.5.0 — so 0.4.0 would have made the demo internally
  // impossible, not merely stale. (`s33_anchors` is in MOCK_SCENARIOS, far
  // above this block.)
  //
  // Do NOT reconcile `MOCK_CRYPTO.keyRevocation.hashed.acdp_version` ('0.5.0')
  // against anything here. It is a different field on a different type
  // (`ContextBody.acdp_version` in `lib/types.ts` — acdp-rs calls that type
  // `Body` — not `RegistryCapabilities.acdp_version`) and it sits
  // inside a signed fixture's hash preimage: editing it breaks the signature.
  // A grep-driven "align the versions" pass is exactly what would hit both.
  //
  // `profiles` is deliberately NOT extended. registry-rs advertises a closed
  // set (`acdp-registry-types/src/config.rs`, `REGISTRY_ADVERTISABLE_PROFILES`)
  // and none of it is version- or witness-specific — a registry may aggregate
  // cosignatures under `acdp-registry-transparency-log` without advertising
  // anything new (RFC-ACDP-0015 §6.1). So raising the protocol version needs no
  // new profile and must not invent one. `acdp_version` is the protocol spoken;
  // `profiles` are capability flags. They move independently.
  a: {
    acdp_version: '0.5.0',
    registry_did: 'did:web:registry-a.playground.local',
    authority: AUTH_A,
    supported_signature_algorithms: ['ed25519', 'ecdsa-p256'],
    profiles: [
      'acdp-registry-core',
      'acdp-registry-discovery',
      'acdp-registry-receipts',
      'acdp-registry-head-receipts',
      'acdp-registry-transparency-log',
      'acdp-registry-lifecycle',
    ],
    anonymous_public_reads: true,
    limits: { max_payload_bytes: 1_048_576, max_search_limit: 100, max_embedded_bytes: 65_536 },
  },
  // registry-b stays at 0.1.0 ON PURPOSE — it is the demo's older, simpler
  // peer, and the point is heterogeneity: a federation where every registry
  // advertises the same thing would not exercise the console's version-aware
  // surfaces at all. Nothing compares it against the SDK matrix, which has one
  // registry row. Do not "fix" this to match a.
  //
  // Be honest about what that costs: against the real binary this value is
  // COUNTERFACTUAL, and by the same evidence that forces `a` to 0.5.0. Both
  // playground registries build from the same image and the 0.5.0 claim is
  // unconditional, so a real registry-b would also advertise 0.5.0. It is kept
  // at 0.1.0 because a federation whose peers all advertise the same thing
  // exercises none of the console's version-aware surfaces — a demo-narrative
  // choice knowingly made against the facts, which is exactly the kind of thing
  // that should be written down rather than discovered later.
  //
  // Its `profiles` are NOT evidence for that story and should not be read as
  // such. `acdp-consumer` is a profile a registry is explicitly forbidden to
  // advertise, and `acdp-federated` is not a spec profile id at all (the real
  // one is `acdp-registry-federated`) — a real registry refuses to start with
  // either. They are demo shorthand that predates this plan. Left alone here
  // because correcting them is a dataset change with its own blast radius, not
  // because they are right. Tracked as issue #95.
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
// The crypto-bearing fields (content_hash, producer/registry/witness
// signatures, receipts, transparency-log proofs) are REAL — minted and
// self-verified in scripts/gen-mock-crypto.mjs and imported from mock-crypto.
// The identity fields excluded from the §5.7 hash preimage (ctx_id, lineage_id,
// origin_registry, created_at) stay here so the demo dataset reads naturally.
export const MOCK_CONTEXTS: FullContext[] = [
  {
    body: {
      ctx_id: LIVE_LINEAGE.nodes[0].ctx_id,
      lineage_id: 'lin-arctic-001',
      origin_registry: AUTH_A,
      // Derived from the receipt, not an independent iso(N) call: acdp-wasm
      // 0.14.1's verifyReceipt cross-checks the receipt against the served
      // body's created_at (RFC-ACDP-0010 §8 step 3), so these must be
      // structurally identical, not just coincidentally equal at write time.
      created_at: MOCK_CRYPTO.arcticSource.registry_receipt.created_at,
      ...MOCK_CRYPTO.arcticSource.hashed,
      content_hash: MOCK_CRYPTO.arcticSource.content_hash,
      signature: MOCK_CRYPTO.arcticSource.signature,
    },
    registry_state: { status: 'active' },
    // RFC-ACDP-0010 receipt — real registry-a signature over the served body hash.
    registry_receipt: MOCK_CRYPTO.arcticSource.registry_receipt as RegistryReceipt,
  },
  {
    body: {
      ctx_id: LIVE_LINEAGE.nodes[1].ctx_id,
      lineage_id: 'lin-arctic-002',
      origin_registry: AUTH_B,
      created_at: iso(3),
      ...MOCK_CRYPTO.arcticDeriv.hashed,
      content_hash: MOCK_CRYPTO.arcticDeriv.content_hash,
      signature: MOCK_CRYPTO.arcticDeriv.signature,
    },
    registry_state: { status: 'active' },
  },
  {
    body: {
      ctx_id: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`,
      lineage_id: 'lin-cashflow-001',
      origin_registry: AUTH_A,
      created_at: iso(272),
      ...MOCK_CRYPTO.cashV1.hashed,
      content_hash: MOCK_CRYPTO.cashV1.content_hash,
      signature: MOCK_CRYPTO.cashV1.signature,
    },
    // Retracted by its producer after v2 shipped (RFC-ACDP-0013): a non-head
    // version, so the lineage's "current" pointer (v2) is unaffected.
    registry_state: {
      status: 'retracted',
      lifecycle_events: [
        {
          event_id: 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          ctx_id: `acdp://${AUTH_A}/94a58a84-b576-47d7-a73e-d04edf9c95de`,
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
      ctx_id: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`,
      lineage_id: LIN_ATTESTED,
      origin_registry: AUTH_A,
      // Derived from the receipt for the same reason as arcticSource above.
      created_at: MOCK_CRYPTO.attested.registry_receipt.created_at,
      ...MOCK_CRYPTO.attested.hashed,
      content_hash: MOCK_CRYPTO.attested.content_hash,
      signature: MOCK_CRYPTO.attested.signature,
    },
    // Retracted-then-republished pair (RFC-ACDP-0013): the registry held the
    // context pending review, then restored it — final status is active again.
    registry_state: {
      status: 'active',
      lifecycle_events: [
        {
          event_id: 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
          ctx_id: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`,
          event_type: 'retracted',
          occurred_at: iso(110),
          actor: `did:web:${AUTH_A}`,
          reason: 'Held pending compliance review of the attested claims.',
          signature: {
            algorithm: 'ed25519',
            key_id: `did:web:${AUTH_A}#receipt-key-1`,
            value: 'zLcEvtHoldC8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN8',
          },
        },
        {
          event_id: 'c3d4e5f6-7a8b-4c9d-a0e1-2b3c4d5e6f7a',
          ctx_id: `acdp://${AUTH_A}/5dcdb05d-bfbc-4088-936b-da19eec25319`,
          event_type: 'republished',
          occurred_at: iso(80),
          actor: `did:web:${AUTH_A}`,
          reason: 'Compliance review cleared; attestation restored.',
          signature: {
            algorithm: 'ed25519',
            key_id: `did:web:${AUTH_A}#receipt-key-1`,
            value: 'zLcEvtRepubD8m1c0Vd7xkR2pYbnLwQf6sT4uJ9hG0eX1aB2cD3eF4gH5iJ6kL7mN',
          },
        },
      ],
    },
    // Real RFC-ACDP-0010 / 0011 / 0012 / 0015 material (registry-a signatures,
    // real Merkle inclusion proof, two real witness cosignatures).
    registry_receipt: MOCK_CRYPTO.attested.registry_receipt as RegistryReceipt,
    lineage_head_receipt: MOCK_CRYPTO.attested.lineage_head_receipt as LineageHeadReceipt,
    log_inclusion: MOCK_CRYPTO.attested.log_inclusion as unknown as LogInclusion,
  },
  {
    // RFC-ACDP-0014 `key-revocation`: producer-signed declaration that a prior
    // signing key is compromised as of a stated boundary time. No registry
    // receipt (mirrors arcticDeriv/cashV1/cashV2 above), so created_at is free
    // to be a display-only recent timestamp rather than derived from a receipt.
    body: {
      ctx_id: `acdp://${AUTH_A}/c4f1a2b3-6d7e-4f8a-9b0c-1d2e3f4a5b6c`,
      lineage_id: 'lin-key-revocation-001',
      origin_registry: AUTH_A,
      created_at: iso(1800),
      ...MOCK_CRYPTO.keyRevocation.hashed,
      content_hash: MOCK_CRYPTO.keyRevocation.content_hash,
      signature: MOCK_CRYPTO.keyRevocation.signature,
    },
    registry_state: { status: 'active' },
  },
];

// ── Lineage chains (by lineage_id) ────────────────────────────────────
// A v2 that supersedes the cashflow snapshot, so the chain view has a real
// multi-version example to render.
const CASHFLOW_V1 = MOCK_CONTEXTS[2];
const CASHFLOW_V2: FullContext = {
  body: {
    ctx_id: `acdp://${AUTH_A}/b1ae7711-2a4d-4cb3-9762-3f6980b3a6e1`,
    lineage_id: CASHFLOW_V1.body.lineage_id,
    origin_registry: AUTH_A,
    created_at: iso(86400),
    ...MOCK_CRYPTO.cashV2.hashed,
    content_hash: MOCK_CRYPTO.cashV2.content_hash,
    signature: MOCK_CRYPTO.cashV2.signature,
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

/**
 * Transparency-log witness state, keyed by DNS authority (this endpoint is
 * control-plane-side and authority-keyed, not `RegistryAuthority`-keyed like
 * JWKS above). An authority absent from this map is the demo's 404 — the
 * control plane's REGISTRY_NOT_FOUND, meaning no witness state was ever
 * recorded, which the UI renders as no card rather than an error.
 *
 * The two entries deliberately exercise both halves of the null-vs-zero rule,
 * so the degrade branch is reachable by a human in demo mode and not only in
 * tests:
 *   - A: quorum consumption ENABLED. Fresh quorum is met, one cosignature is
 *     stale (fresh 2 < witnessed 3) and two verified under retired keys.
 *   - B: quorum consumption produced NOTHING — all five quorum fields SQL
 *     `NULL`, alongside a failed consistency proof, which is exactly what
 *     upstream writes on that path whether or not quorum is enabled.
 *     The card must show B's checkpoint and alert and print no quorum
 *     figures at all; printing `0 witnesses` here would assert "we checked
 *     and found none" when the truth is "we never checked".
 * B also carries a live alert, using a real `WitnessAlertReason` value and
 * the `{error, previous}` detail shape the upstream's own raiseAlert call
 * sites emit — not an invented vocabulary.
 */
export const MOCK_LOG_WITNESS: Record<string, LogWitnessState> = {
  [AUTH_A]: {
    authority: AUTH_A,
    logId: `${AUTH_A}/log/v1`,
    lastWitnessedSize: 4821,
    lastRootHash: 'sha256:9f2c41ab7d0e5c83b6a14f97e2d3c8b05a6f1e94d7c2b830a5e1f6c4d9b72e08',
    lastSuccessAt: iso(240),
    consecutiveFailures: 0,
    alert: { alerted: false, reason: null, detail: null, at: null },
    checkpoints: [
      {
        logId: `${AUTH_A}/log/v1`,
        treeSize: 4821,
        rootHash: 'sha256:9f2c41ab7d0e5c83b6a14f97e2d3c8b05a6f1e94d7c2b830a5e1f6c4d9b72e08',
        timestamp: iso(258),
        witnessedAt: iso(240),
        signatureValid: true,
        consistencyOk: true,
        witnessedCount: 3,
        meetsQuorum: true,
        freshWitnessedCount: 2,
        meetsFreshQuorum: true,
        // Orthogonal to witnessedCount, never summed with it — picked so no
        // pair of the rendered figures adds up to another one on screen.
        historicalWitnessedCount: 2,
      },
      {
        logId: `${AUTH_A}/log/v1`,
        treeSize: 4796,
        rootHash: 'sha256:2b8e07d5c1a9f34608e7b2d5c9a1f480e3b7c206d9a5f1e8c4b03a7d6e29f145',
        timestamp: iso(3870),
        witnessedAt: iso(3840),
        signatureValid: true,
        consistencyOk: true,
        witnessedCount: 3,
        meetsQuorum: true,
        freshWitnessedCount: 3,
        meetsFreshQuorum: true,
        historicalWitnessedCount: 0,
      },
    ],
    total: 2,
  },
  [AUTH_B]: {
    authority: AUTH_B,
    logId: `${AUTH_B}/log/v1`,
    lastWitnessedSize: 1094,
    lastRootHash: 'sha256:5d13c8b46f0a927e3c5b18d04a6f2e91b7c3d580a9e4f162c8b05d7a3e619f24',
    lastSuccessAt: iso(9600),
    consecutiveFailures: 3,
    alert: {
      alerted: true,
      reason: 'consistency_failed',
      detail: {
        error: 'consistency proof 1094→1120 failed: leaf hash not reachable from the prior root',
        previous: {
          log_id: `${AUTH_B}/log/v1`,
          tree_size: 1094,
          root_hash: 'sha256:5d13c8b46f0a927e3c5b18d04a6f2e91b7c3d580a9e4f162c8b05d7a3e619f24',
        },
      },
      at: iso(1800),
    },
    checkpoints: [
      {
        logId: `${AUTH_B}/log/v1`,
        treeSize: 1094,
        rootHash: 'sha256:5d13c8b46f0a927e3c5b18d04a6f2e91b7c3d580a9e4f162c8b05d7a3e619f24',
        timestamp: iso(9640),
        witnessedAt: iso(9600),
        signatureValid: true,
        // FALSE, not true, and the alert above is why. Upstream persists the
        // offending head with `consistencyOk: false` immediately before raising
        // `consistency_failed` (`checkpoint-witness.service.ts` :484→:485 and
        // :521→:522), and rows come back newest-first — so the head an operator
        // sees under a standing consistency alert is the one that failed. A
        // fixture reading "Consistency: proven" directly beneath
        // `consistency_failed` would teach the demo's viewer a state the real
        // system cannot produce.
        consistencyOk: false,
        witnessedCount: null,
        meetsQuorum: null,
        freshWitnessedCount: null,
        meetsFreshQuorum: null,
        historicalWitnessedCount: null,
      },
    ],
    total: 1,
  },
};

export const MOCK_SEARCH_HITS: SearchHit[] = [
  ...MOCK_CONTEXTS.map((c) => ({
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
  })),
  // A revocation context published under the INTERIM type name
  // (`acdp:key-revocation`, RFC-ACDP-0014 §10). Without it the `key-revocation`
  // facet's two-spelling fan-out is unreachable in demo mode — the one search
  // hit derived from MOCK_CONTEXTS carries the canonical spelling — and the
  // fold-in would ship verifiable only by a test.
  //
  // Appended as a synthetic hit rather than a sixth MOCK_CONTEXTS entry on
  // purpose: `type` sits inside the signed preimage, so a real entry would need
  // its crypto regenerated, and `wasm-fixtures.test.ts` pins MOCK_CONTEXTS at 5
  // to catch silent shrinkage of the acdp-wasm gate's surface. The cost is that
  // this hit has NO body — `getContext`'s demo branch has a defined behavior for
  // exactly that, and the detail pane surfaces it as an unavailable context
  // rather than crashing. Do not "fix" it by fabricating a body: the detail pane
  // runs real signature/hash verification, and an invented body would render
  // failed trust chips for a fixture, which is worse than an honest absence.
  {
    ctx_id: `acdp://${AUTH_A}/7e9b0c12-33a4-4d55-8e66-9f0a1b2c3d4e`,
    lineage_id: 'lin-key-revocation-interim-001',
    agent_id: DID_SOLO,
    title: 'Producer key revocation — interim type name',
    type: 'acdp:key-revocation',
    created_at: iso(86_400 * 120),
    status: 'active',
    summary:
      'Published under the pre-0.5.0 `acdp:key-revocation` type name. A registry still serves it; an exact-match search for the canonical name would never return it.',
    domain: 'security',
    visibility: 'public',
  },
];

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
//
// Reference versions only — no `status` field. Each row's status is COMPUTED
// by `buildSdkMatrixRows` from whether the row has a backing service and what
// that service's /healthz said; it was never read from here. Carrying a static
// `status: 'ok'` alongside that was a trap: after the row/mode split, a row
// could hold `'ok'` here while computing `'reference'`, and a future reader
// would have no way to know which one the UI honours.
export const MOCK_SDK_MATRIX = [
  { component: 'ACDP spec', version: '0.4.0 Final' },
  { component: 'acdp-rs library', version: '0.14.1' },
  { component: 'acdp-py binding', version: '0.14.1' },
  { component: 'acdp-node binding', version: '0.14.1' },
  // Label must match SDK_MATRIX_ROW_SERVICE's key exactly; see the note there.
  // 0.5.0, matching what the real registry advertises and what
  // MOCK_CAPABILITIES.a now says — see the note there. The parenthetical names
  // WHY the claim is 0.5.0: RFC-ACDP-0016 external anchors, which registry-rs
  // folds in unconditionally. It used to read "(witness aggregation)", which is
  // the 0.4.0 rung and no longer the reason for the number.
  { component: 'Registry A (Rust/axum)', version: '0.5.0 (external anchors)' },
  { component: 'Control Plane (NestJS)', version: '0.4.0 (witness cosigning)' },
  { component: 'Playground (FastAPI)', version: '0.4.0 (S28-S34)' },
];
