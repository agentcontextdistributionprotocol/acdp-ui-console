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
  // ACDP 0.3 lifecycle transitions (RFC-ACDP-0013).
  | 'acdp.retract'
  | 'acdp.republish'
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
  // ACDP 0.2 trust signals carried on the playground step stream (snake_case).
  key_fingerprint?: string;
  receipt_present?: boolean;
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
  /** ACDP 0.3: registry-derived status, when known ('retracted' renders distinctly). */
  status?: string;
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

/**
 * Receipt-audit verdict for a single context event (RFC-ACDP-0010).
 * `verified` = crypto-verified against a current registry key;
 * `verified_historical` = crypto-verified, but the receipt's registry key is
 * retired (§9 historically authorized) — valid, yet worth surfacing;
 * `structural` = shape-only (no crypto); `discrepancy` = a real trust violation;
 * `no_receipt` = registry returned none; `error` = environmental
 * (unreachable/timeout), NOT a trust flag.
 */
export type TrustVerdictStatus =
  | 'verified'
  | 'verified_historical'
  | 'structural'
  | 'discrepancy'
  | 'no_receipt'
  | 'error';

/** Aggregate receipt-audit summary the control plane attaches to a run. */
export interface RunTrustSummary {
  audited: number;
  verified: number;
  // Crypto-verified against a *retired* registry key (RFC-ACDP-0010 §9).
  verifiedHistorical: number;
  structural: number;
  noReceipt: number;
  errors: number;
  flagged: Array<{
    eventId: string;
    ctxId: string | null;
    status: string; // 'discrepancy'
    discrepancies: string[]; // prefix-coded flag strings, e.g. 'content_hash_mismatch:…'
  }>;
}

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
  // ACDP 0.2: nullable until the audit sweep produces a verdict for the run.
  trust?: RunTrustSummary | null;
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
  // ACDP 0.2 trust signals (optional; absent on 0.1.0 traffic).
  keyFingerprint?: string | null;
  receiptPresent?: boolean | null;
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
    /** ACDP 0.3: registry-derived status, when the control plane knows it. */
    status?: string | null;
  }>;
  edges: Array<{ from: string; to: string }>;
}

export interface CpDashboardOverview {
  window: string;
  totalRuns: number;
  totalContexts: number;
  totalAgents: number;
  recentRuns: CpRun[];
  byScenario: Array<{ scenario_id: string; run_count: number }>;
  byRegistry: Array<{ registry_authority: string; event_count: number }>;
  // ACDP 0.2: per-registry receipt coverage + producer DID-method breakdown.
  receiptCoverage?: Array<{ registry_authority: string; publish_count: number; receipt_count: number }>;
  didMethods?: Array<{ method: 'did:web' | 'did:key' | 'other'; publish_count: number }>;
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

/** A registry authority enrolled with the control plane (secret omitted). */
export interface RegistryEnrollment {
  authority: string;
  tenantId: string;
  baseUrl?: string | null;
  registryDid?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface EnrollRegistryInput {
  authority: string;
  tenantId?: string;
  baseUrl?: string;
  registryDid?: string;
  webhookSecret?: string;
  enabled?: boolean;
}

// ── Registry types ────────────────────────────────────────────────────
/** Producer signature over the canonicalized (JCS) body. */
export interface Signature {
  algorithm: string; // 'ed25519' | 'ecdsa-p256' | …
  key_id: string; // did:web:…#key-1
  value: string; // base64
}

/** Pointer to out-of-band data backing a context. */
export interface DataRef {
  type: string;
  location: string;
  encoding?: string;
}

/** Inclusive [start, end] window the context's data describes. */
export interface DataPeriod {
  start: string;
  end: string;
}

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
  // Richer protocol fields (acdp-rs Body) — all optional for forward-compat.
  signature?: Signature;
  supersedes?: string | null;
  contributors?: string[];
  description?: string;
  audience?: string[];
  expires_at?: string;
  data_period?: DataPeriod;
  schema_uri?: string;
  data_refs?: DataRef[];
  acdp_version?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Registry-derived context status (RFC-ACDP-0004 §4; 'retracted' added by
 * RFC-ACDP-0013, acdp/0.3.0). The vocabulary is open — `(string & {})`
 * preserves unknown future values without collapsing the union to `string`.
 */
export type ContextStatus = 'active' | 'superseded' | 'expired' | 'retracted' | (string & {});

/**
 * A signed, append-only lifecycle event recorded in
 * `registry_state.lifecycle_events` (RFC-ACDP-0013, acdp/0.3.0).
 * `event_type` is an open vocabulary; v1 defines 'retracted' and 'republished'.
 */
export interface LifecycleEvent {
  event_id: string; // UUID minted by the actor
  ctx_id: string; // must equal the carrying context's ctx_id
  event_type: 'retracted' | 'republished' | (string & {});
  occurred_at: string; // canonical ms-precision RFC 3339 UTC
  actor: string; // DID: producer for producer-initiated, registry DID otherwise
  reason?: string; // informational only
  signature?: Signature; // REQUIRED on producer-initiated events
}

/** Mutable registry-side state served alongside the immutable body. */
export interface RegistryState {
  status: ContextStatus;
  // ACDP 0.3: present when the registry runs the lifecycle profile and the
  // context has recorded lifecycle transitions (RFC-ACDP-0013).
  lifecycle_events?: LifecycleEvent[];
}

/**
 * Registry receipt (RFC-ACDP-0010) — the serving registry's signed attestation
 * that it accepted and stored a context. `key_fingerprint` records the producer's
 * publish-time signing key, enabling historical-key verification after rotation.
 */
export interface RegistryReceipt {
  registry_did: string; // e.g. 'did:web:registry-c.playground.local'
  ctx_id: string;
  lineage_id: string;
  origin_registry: string; // authority string
  created_at: string; // canonical RFC3339, ms precision
  content_hash: string; // 'sha256:…'
  key_fingerprint: string; // 'sha256:…' of the producer's publish-time key
  signature: Signature;
}

/**
 * Lineage-head receipt (RFC-ACDP-0011, acdp/0.3.0) — a registry-signed
 * attestation that, as of `as_of`, `head_ctx_id` was the current head of
 * `lineage_id` with status `head_status` (never 'superseded'/'retracted').
 */
export interface LineageHeadReceipt {
  receipt_version: 'acdp-lhr/1';
  registry_did: string; // did:web:<serving authority>
  lineage_id: string;
  head_ctx_id: string;
  head_version: number;
  head_status: ContextStatus;
  as_of: string; // registry response-time clock, ms-precision RFC 3339 UTC
  signature: Signature;
}

/** Signed transparency-log checkpoint (RFC-ACDP-0012 §6). */
export interface LogCheckpoint {
  checkpoint_version: 'acdp-log/1';
  log_id: string; // did:web:<authority>/log/<name>
  tree_size: number;
  root_hash: string; // 'sha256:…'
  timestamp: string; // ms-precision RFC 3339 UTC
  signature: Signature;
}

/**
 * Transparency-log inclusion proof (RFC-ACDP-0012 §8.2, §9.1) — the RFC 6962
 * audit path for `leaf_index` at `tree_size`, plus the signed checkpoint it
 * verifies against. Carried as a top-level retrieval-envelope member (§10).
 */
export interface LogInclusion {
  log_id: string; // must equal log_checkpoint.log_id
  leaf_index: number; // 0-based, < tree_size
  tree_size: number; // must equal log_checkpoint.tree_size
  inclusion_path: string[]; // 'sha256:…' node digests, lowest level first
  log_checkpoint: LogCheckpoint;
  /** Optional convenience echo — verifiers must not trust it (§9.1 step 1). */
  leaf?: Record<string, unknown>;
}

export interface FullContext {
  body: ContextBody;
  registry_state: RegistryState;
  // ACDP 0.2: present when the serving registry runs the receipts profile.
  registry_receipt?: RegistryReceipt | null;
  // ACDP 0.3: present when the serving registry runs the head-receipts profile.
  lineage_head_receipt?: LineageHeadReceipt | null;
  // ACDP 0.3: present when the serving registry runs the transparency-log profile.
  log_inclusion?: LogInclusion | null;
}

/**
 * A single search result — the `match_summary` projection per
 * `acdp-common.schema.json` (RFC-ACDP-0005 §2.2). Required fields are always
 * present on the wire; `summary`/`domain`/`visibility` are optional (the
 * registry omits `visibility` for restricted/private results the caller can't
 * see). The full body (`content_hash`, `tags`, `data_refs`, …) is NOT in this
 * projection — fetch it via `getContext`. The origin registry authority is not
 * carried here; derive it from `ctx_id` (`acdp://<authority>/<id>`).
 */
export interface SearchHit {
  ctx_id: string;
  lineage_id: string;
  agent_id: string;
  title: string;
  type: string;
  created_at: string;
  status: ContextStatus;
  summary?: string;
  domain?: string;
  visibility?: string;
}

export interface SearchResponse {
  matches: SearchHit[];
  total_estimate?: number;
  next_cursor?: string;
  /** Set when a multi-registry search had at least one registry fail. */
  partial?: boolean;
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

// ── Security: revocations + signing keys ──────────────────────────────
export interface RevocationEntry {
  jti: string;
  sub: string; // subject DID of the revoked token
  iss: string; // issuer
  exp: number; // original expiry (unix seconds)
  revoked_at_ms: number; // when it was revoked (unix ms)
}

export interface RevocationFeed {
  entries: RevocationEntry[];
  next_cursor: number | null;
}

/** A single JSON Web Key (subset of RFC 7517 fields the UI surfaces). */
export interface Jwk {
  kty: string;
  kid?: string;
  crv?: string;
  alg?: string;
  use?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

export interface JwkSet {
  keys: Jwk[];
}

// ── Misc ──────────────────────────────────────────────────────────────
export type RegistryAuthority = 'a' | 'b';

/**
 * Registries the console can ask for capabilities. Registry C (the receipts /
 * 0.3.0 trust-profile registry) exists only in demo mode — it has no proxy
 * route, so live-mode capability queries for it fail fast.
 */
export type CapabilityAuthority = RegistryAuthority | 'c';

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

export interface ContextSearchParams {
  q?: string;
  type?: string;
  domain?: string;
  /** Comma-separated tag list (AND semantics). */
  tags?: string;
  agentId?: string;
  status?: string;
  visibility?: string;
  cursor?: string;
  limit?: number;
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
