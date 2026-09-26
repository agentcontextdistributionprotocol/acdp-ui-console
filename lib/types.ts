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
  // RFC-ACDP-0014: revoked-key events. Semantically distinct from `flagged`
  // above — `flagged` is a content/signature discrepancy, `revoked` is a
  // signing key whose authority was later revoked (RFC-ACDP-0014 §7).
  //
  // THESE FIELDS ARE NOT ABSENT WHEN THE CHECK IS DISABLED. An earlier version
  // of this comment said they were, and that claim was load-bearing — it is
  // why the consuming gates were written as presence checks. It is wrong:
  // `receipt-audit.repository.ts` always emits `revoked` (as `[]` when
  // disabled, which its own API docs state outright), the counters are built
  // with `?? 0`, and migration `0023_receipt_audit_revocation.sql` makes
  // `key_revocation_status` NOT NULL DEFAULT 'none'. `KEY_REVOCATION_CHECK_ENABLED`
  // defaults to **false**, so the common case is a present, all-zero payload
  // that is indistinguishable from "checked and clean".
  //
  // They ARE genuinely absent against a control plane that predates the field.
  // Use `runRevocationReported()` (`lib/utils/revocation.ts`) rather than a
  // presence check — it handles both, and carries the proof arm that
  // `audited === 0` makes definitive.
  //
  // acdp-control-plane#176 asked upstream for an explicit signal and shipped
  // (their PR #178) — but ONLY on `/dashboard/overview`, which gained a
  // `features` object and a nullable tile. The RUN-scoped payload these three
  // fields belong to was not changed, so the ambiguity above is still real
  // here even though the dashboard's version of it is now solvable.
  keyRevocationPreCompromise?: number;
  keyRevocationRevokedAtOrAfter?: number;
  keyRevocationRevokedTimeUnverifiable?: number;
  revoked?: Array<{
    eventId: string;
    ctxId: string | null;
    /**
     * RFC-ACDP-0014 §7 revocation verdict. **The vocabulary is open**, like
     * `ContextStatus` below: upstream's `key_revocation_status` column is
     * `varchar(32)` with no DB CHECK constraint, so a control plane newer than
     * this console can legitimately emit a fourth value. `(string & {})`
     * preserves it without collapsing the union to `string`.
     *
     * An unrecognised value is treated as **fail-closed** by
     * `lib/utils/revocation.ts` — the safe direction for an unknown trust
     * verdict is "this may be a violation", never "this is authorized".
     */
    status: 'pre_compromise' | 'revoked_at_or_after' | 'revoked_time_unverifiable' | (string & {});
    boundary: string;
    trustClass: 'producer_signed' | 'registry_attested';
    sources: Array<{ ctxId: string; publisher: string }>;
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
  // RFC-ACDP-0014: window-scoped key-revocation counters.
  //
  // Optional for TWO reasons now, and the history is worth keeping because
  // this comment has been wrong in both directions.
  //
  //  1. A control plane that predates the field omits it.
  //  2. Since acdp-control-plane#178 the field is `null` when
  //     `KEY_REVOCATION_CHECK_ENABLED=false`. An earlier version of this
  //     comment claimed exactly that and was wrong at the time — upstream then
  //     built it unconditionally with `?? 0` — so the correction said "absent
  //     ONLY against a control plane that predates the field". That correction
  //     is now itself out of date. The claim was premature, not false.
  //
  // Both land on absent, so `dashboardRevocationReported()`
  // (`lib/utils/revocation.ts`) stays correct either way. What it still cannot
  // do is tell "enabled and clean" from "never checked"; the `features` object
  // that same upstream release added answers that, and is not modelled here
  // yet — issue #97.
  keyRevocation?: { preCompromise: number; revokedAtOrAfter: number; revokedTimeUnverifiable: number };
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
  registry_did: string; // e.g. 'did:web:registry-a.playground.local'
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
 * The identity-bearing subset of an RFC-ACDP-0012 §6 checkpoint that a witness
 * observed — {log_id, tree_size, root_hash, timestamp}, copied verbatim from the
 * verified checkpoint (RFC-ACDP-0015 §4; acdp-log-cosignature.schema.json). Closed
 * schema: the registry's own checkpoint_version / signature are deliberately NOT
 * restated (the consumer verifies the checkpoint signature independently). The
 * `timestamp` is the registry-CLAIMED checkpoint time — the witness does not vouch
 * for it (`witnessed_at` is what the witness attests).
 */
export interface WitnessedCheckpoint {
  log_id: string; // did:web:<authority>/log/<name>
  tree_size: number;
  root_hash: string; // 'sha256:…'
  timestamp: string; // registry-claimed checkpoint time, ms-precision RFC 3339 UTC
}

/**
 * A transparency-log witness cosignature (RFC-ACDP-0015, acdp/0.4.0;
 * acdp-log-cosignature.schema.json) — an independent witness's signed observation
 * that it saw `witnessed_checkpoint`, verified it, and cosigned it at `witnessed_at`
 * with the witness's OWN DID + key (a witness is not a registry — no publish
 * surface; `signature.key_id` is a DID URL under `witness_id`). Closed, fully
 * signed schema. The N-witnessed count (§8) is over DISTINCT `witness_id` values.
 */
export interface WitnessCosignature {
  cosignature_version: 'acdp-cosig/1';
  witness_id: string; // did:web:… | did:key:… (the witness's own DID)
  witnessed_checkpoint: WitnessedCheckpoint;
  witnessed_at: string; // witness-clock observation time, ms-precision RFC 3339 UTC
  signature: Signature; // keyed by the witness's own assertionMethod key
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
  /**
   * RFC-ACDP-0015 §6.1 witness cosignatures of `log_checkpoint`. The registry
   * attaches these as a top-level SIBLING of `log_checkpoint` (never inside the
   * closed, signed checkpoint — see acdp-registry-core `handlers/log.rs`
   * `attach_witness_signatures`). Absent — never `[]` — when the registry has
   * collected none (backward compatible with pre-0.4.0 consumers).
   */
  witness_signatures?: WitnessCosignature[];
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
  /**
   * Set when at least one of a merged response's upstream queries failed —
   * several registries, several `type` spellings, or both.
   *
   * It does **not** imply a registry is down: the type-spelling axis queries
   * one registry twice, so a single failed `acdp:key-revocation` query sets
   * this while every registry is up. The consuming banner used to say "one
   * registry did not respond" and was therefore capable of blaming a healthy
   * registry — a false claim on a trust surface, which is the defect class
   * this whole phase exists to remove.
   */
  partial?: boolean;
  /**
   * Set when this response is a CLIENT-SIDE MERGE of several upstream queries —
   * several registries, several `type` spellings, or both. A merged response
   * carries no `next_cursor` (merged result sets cannot be keyset-paginated
   * coherently), so it is the first page of each query rather than the whole
   * result set. Consumers must not present it as exhaustive: absence of a
   * result here is not evidence of absence upstream.
   */
  merged?: boolean;
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

// ── Transparency-log witness (RFC-ACDP-0012 / RFC-ACDP-0015) ──────────
/**
 * One witnessed checkpoint — a signed tree head the control plane retained as
 * evidence. Shape is `log_witness_checkpoints` verbatim (the endpoint returns
 * a whole-row `select()`), minus four columns this console deliberately does
 * not model: `id`, `tenantId` (never rendered — it is deployment-internal),
 * `registryAuthority` (redundant — the envelope's own `authority` is the one
 * the caller asked for) and `rawCheckpoint` (a large opaque jsonb blob; this is
 * a status card, not an inspector). All four arrive on the wire and are simply
 * not read.
 *
 * **The five quorum fields are nullable on purpose and the distinction is
 * load-bearing.** The control plane writes SQL `NULL` to all of them in at
 * least three situations — quorum consumption disabled
 * (`WITNESS_QUORUM_ENABLED=false`), any failure-path persist (which omits the
 * quorum argument entirely, so a head can be all-null with quorum *enabled*),
 * and an older deployment that omits the columns from the JSON. They are not
 * distinguishable from here, which is why the UI says "not reported" rather
 * than "disabled".
 *
 * What they DO have in common is the only thing that matters: `null`/`undefined`
 * means *we never counted*, while `0` means *we counted and found none* — a
 * real, alarming value that must render. Never collapse the two with `?? 0`
 * or a truthiness check; test for `typeof x === 'number'`.
 */
export interface LogWitnessCheckpoint {
  logId: string;
  treeSize: number;
  rootHash: string;
  /** Registry-asserted evaluation time from the checkpoint itself (ISO 8601). */
  timestamp: string;
  /** When this control plane witnessed it (ISO 8601). */
  witnessedAt: string;
  signatureValid: boolean;
  /** §9.2 verdict vs the previous head of the same log; null for the first. */
  consistencyOk?: boolean | null;
  /** RFC-ACDP-0015 §8: distinct trusted witnesses attesting this exact tuple. */
  witnessedCount?: number | null;
  meetsQuorum?: boolean | null;
  /**
   * §8.1: the subset of `witnessedCount` also inside the staleness window. A
   * stale-but-valid cosignature still counts toward `witnessedCount`, so
   * `meetsFreshQuorum: false` alongside `meetsQuorum: true` is a SOFT liveness
   * signal upstream explicitly calls "never a failure" — warn, do not alarm.
   */
  freshWitnessedCount?: number | null;
  meetsFreshQuorum?: boolean | null;
  /**
   * §9: witnesses whose cosignature verified under a RETIRED key. **Never**
   * folded into the counts above — upstream (`src/db/schema.ts`) warns it is
   * a separate sub-count and is also orthogonal to two similarly named fields
   * in other RFCs (`receipt_audits.verified_historical`, RFC-ACDP-0014's
   * producer `pre_compromise`). Render it apart; never as a pass.
   */
  historicalWitnessedCount?: number | null;
}

/** Cursor-level alert state: root rewrites, split views, tree-size regressions. */
export interface LogWitnessAlert {
  alerted: boolean;
  /** One of the upstream `WitnessAlertReason` enum values when alerted. */
  reason?: string | null;
  /**
   * Structured jsonb, **not** a string — stringifying it yields
   * `[object Object]`. Every upstream `raiseAlert` call site puts the
   * human-readable message in `detail.error`; nothing else in it is a stable
   * contract, so read that key and ignore the rest.
   */
  detail?: Record<string, unknown> | null;
  at?: string | null;
}

/** `GET control-plane /registries/:authority/log-witness`. */
export interface LogWitnessState {
  authority: string;
  logId?: string | null;
  lastWitnessedSize?: number | null;
  lastRootHash?: string | null;
  lastSuccessAt?: string | null;
  consecutiveFailures: number;
  alert: LogWitnessAlert;
  /** Newest-first, capped at 20 by the control plane. May be empty. */
  checkpoints: LogWitnessCheckpoint[];
  total: number;
}

// ── Misc ──────────────────────────────────────────────────────────────
/** The registry authorities the console proxies, in display order. */
export const REGISTRY_AUTHORITIES = ['a', 'b'] as const;
export type RegistryAuthority = (typeof REGISTRY_AUTHORITIES)[number];

/** Human-facing labels for each registry authority. */
export const REGISTRY_LABELS: Record<RegistryAuthority, string> = {
  a: 'Registry A',
  b: 'Registry B',
};

/**
 * Alias retained for call sites that historically distinguished
 * capability-only registries. The playground consolidated to a two-registry
 * topology (registry-a hosts the receipts / 0.3.0 trust profiles directly), so
 * this is simply `RegistryAuthority`.
 * @deprecated Use `RegistryAuthority`.
 */
export type CapabilityAuthority = RegistryAuthority;

export interface HealthResult {
  /**
   * Whether the service is serving, NOT whether the request succeeded.
   *
   * A transport-level failure is one way to be `false`; the other is an
   * upstream reporting degradation in-band on a 200 (the control plane returns
   * `{ok:false}` at 200 when its database is down). `pingHealth` folds both
   * into this one field — see the envelope table on it.
   */
  ok: boolean;
  latencyMs?: number;
  /**
   * Why `ok` is false — absent when it is true.
   *
   * `'degraded'` means something UPSTREAM answered and the answer was not a
   * healthy one (the control plane's 200 with `ok:false`, the registry's 503,
   * a 404 from a build with no `/healthz`). `'unreachable'` means nothing from
   * beyond this console's boundary answered: a dead socket, the proxy's own
   * 502, or any envelope the console minted itself — `middleware.ts`'s 401,
   * 503 and Origin-mismatch 403, Next's 500 for an unset base URL. The
   * discriminator is the proxy's
   * `x-acdp-ui-proxy` stamp, not the status code.
   *
   * One case is under-claimed rather than wrong: a 200 whose body is not JSON
   * throws a `SyntaxError`, not an `ApiError`, so it carries no stamp to read
   * and lands on `'unreachable'` even though the upstream demonstrably
   * answered. Deliberate — that is the fail-closed direction, and the shape of
   * the escape is documented where it is decided (`lib/api/client.ts`,
   * `failureKind`).
   *
   * A union rather than a free string because two surfaces render it verbatim
   * to operators; a typo would reach the screen as a label.
   */
  detail?: 'degraded' | 'unreachable';
  /**
   * The service's own `/healthz` version string, when the response carried one
   * and could be parsed (registry-rs/control-plane/playground all now expose
   * `version` on this route, in differently-shaped envelopes). Per registry-rs's
   * own `docs/HTTP-API.md`, this field MUST be treated as opaque — display it
   * verbatim, never parse or compare it as a semver.
   *
   * Present on a `ok: false` result too, and meaningful there: both upstreams
   * with a failure path put `version` on the degraded body deliberately,
   * because build identity matters most when a service is unhealthy. It is
   * always read from THIS response — never carried over from an earlier
   * successful ping, which would look identical to an operator while being a
   * weaker claim.
   */
  version?: string;
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
