// ══════════════════════════════════════════════════════════════════════
// Client-side ACDP verification — REAL cryptographic verdicts.
//
// Every function here reaches an *independent* verdict by running the wasm
// verifier over the data on hand. A green result means the browser recomputed
// the hash / checked the signature itself — never that a server said so.
//
//   status: 'verified'    → cryptographically checked and valid
//           'failed'      → cryptographically checked and INVALID (tamper/mismatch)
//           'unavailable' → could not check because a required signer key / DID
//                           document is not on hand (honest "material only")
//
// `unavailable` is NEVER rendered as a pass. Absence of a key is not a failure
// of the proof, but it is also not a verification — so it gets its own state.
// ══════════════════════════════════════════════════════════════════════
import type {
  ContextBody,
  LineageHeadReceipt,
  LogInclusion,
  RegistryReceipt,
} from '@/lib/types';
import { getAcdpWasm } from './wasm';
import {
  resolveDidDocument,
  resolveEd25519Raw,
  resolveVerificationKey,
  type DidDocMap,
} from './resolve';

export type VerdictStatus = 'verified' | 'failed' | 'unavailable';

export interface Verdict {
  status: VerdictStatus;
  detail: string;
}

const verified = (detail: string): Verdict => ({ status: 'verified', detail });
const failed = (detail: string): Verdict => ({ status: 'failed', detail });
const unavailable = (detail: string): Verdict => ({ status: 'unavailable', detail });

interface WasmVerdict {
  valid: boolean;
  error?: string;
  stale?: boolean;
}

/** Run a wasm verifier that returns a `{valid,…}` verdict, mapping throws honestly. */
function fromWasm(run: () => string, okDetail: string, failPrefix: string): Verdict {
  let raw: string;
  try {
    raw = run();
  } catch (e) {
    // A THROW is malformed *host input* (RFC-ACDP spec violation in the material
    // itself), not a clean false verdict — surface it as a failure to verify.
    return failed(`malformed material: ${(e as Error).message}`);
  }
  const v = JSON.parse(raw) as WasmVerdict;
  if (v.valid) return verified(v.stale ? `${okDetail} (material is stale)` : okDetail);
  return failed(v.error ? `${failPrefix}: ${v.error.split('\n')[0]}` : failPrefix);
}

// ── content_hash (RFC-ACDP-0001 §5.7) — always self-contained ─────────
export async function verifyContentHash(body: ContextBody): Promise<Verdict> {
  const wasm = await getAcdpWasm();
  return fromWasm(
    () => wasm.verifyContentHash(JSON.stringify(body), body.content_hash),
    'content_hash recomputed from the body and matches',
    'content_hash does not match the body',
  );
}

// ── producer signature (RFC-ACDP-0001 §5.8) ───────────────────────────
export async function verifyProducerSignature(body: ContextBody, docs: DidDocMap): Promise<Verdict> {
  if (!body.signature) return unavailable('body carries no producer signature');
  const wasm = await getAcdpWasm();
  const key = await resolveVerificationKey(body.signature.key_id, docs);
  if (!key) return unavailable('producer DID document not fetched — signature not checked');
  const detail =
    key.algorithm === 'ecdsa-p256'
      ? 'ECDSA-P256 signature valid for the resolved producer key'
      : 'Ed25519 signature valid for the resolved producer key';
  return fromWasm(
    () =>
      key.algorithm === 'ecdsa-p256'
        ? wasm.verifySignatureP256(key.pubKeyB64, body.signature!.value, body.content_hash)
        : wasm.verifySignatureEd25519(key.pubKeyB64, body.signature!.value, body.content_hash),
    detail,
    'producer signature is invalid',
  );
}

// ── SHA-256 helper for the receipt's independently-recomputed body hash ─
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── registry receipt (RFC-ACDP-0010) ──────────────────────────────────
export async function verifyRegistryReceipt(
  receipt: RegistryReceipt,
  body: ContextBody,
  docs: DidDocMap,
): Promise<Verdict> {
  const wasm = await getAcdpWasm();
  // The registry's own signing key (the receipt's signer).
  const registryKey = await resolveEd25519Raw(receipt.signature.key_id, docs);
  if (!registryKey) return unavailable('registry DID document not fetched — receipt signature not checked');
  // The producer key fingerprint the receipt pins — recompute it from the producer key.
  const producerKey = body.signature
    ? await resolveEd25519Raw(body.signature.key_id, docs)
    : null;
  if (!producerKey) {
    return unavailable('producer key not on hand — cannot recompute the receipt fingerprint');
  }
  // Recompute the body hash OURSELVES (never trust the echoed value, RFC-0010 §4).
  const preimage = wasm.canonicalPreimage(JSON.stringify(body));
  const recomputed = `sha256:${await sha256Hex(preimage)}`;
  const fingerprint = wasm.fingerprintEd25519(producerKey);
  return fromWasm(
    () => wasm.verifyReceipt(JSON.stringify(receipt), registryKey, body.ctx_id, recomputed, fingerprint),
    'registry signature valid; receipt binds to our recomputed body hash',
    'registry receipt failed verification',
  );
}

// ── lineage-head receipt (RFC-ACDP-0011) ───────────────────────────────
export async function verifyLineageHeadReceipt(
  lhr: LineageHeadReceipt,
  body: ContextBody,
  status: string,
  docs: DidDocMap,
): Promise<Verdict> {
  const wasm = await getAcdpWasm();
  const doc = resolveDidDocument(lhr.registry_did, docs);
  if (!doc) return unavailable('registry DID document not fetched — head receipt signature not checked');
  const expected = {
    registry_did: lhr.registry_did,
    lineage_id: body.lineage_id,
    head_ctx_id: body.ctx_id,
    head_version: body.version,
    head_status: status,
  };
  return fromWasm(
    () =>
      wasm.verifyLineageHeadReceipt(
        JSON.stringify(lhr),
        JSON.stringify(expected),
        JSON.stringify(doc),
        new Date().toISOString(),
        // Generous freshness window: the crypto verdict is the headline; the UI
        // shows its own staleness chip. `valid` is unaffected by age either way.
        315360000n,
        315360000n,
      ),
    'registry signature valid; head receipt binds to this context',
    'lineage-head receipt failed verification',
  );
}

// ── transparency log: checkpoint signature + inclusion proof (RFC-ACDP-0012) ─
export async function verifyTransparencyLog(
  inclusion: LogInclusion,
  receipt: RegistryReceipt | null | undefined,
  docs: DidDocMap,
): Promise<Verdict> {
  const wasm = await getAcdpWasm();
  const cp = inclusion.log_checkpoint;
  const doc = resolveDidDocument(cp.signature.key_id.split('#')[0], docs);
  if (!doc) return unavailable('log registry DID document not fetched — checkpoint signature not checked');

  // 1. checkpoint signature (signed tree head).
  const cpVerdict = fromWasm(
    () => wasm.verifyLogCheckpoint(JSON.stringify(cp), JSON.stringify(doc), cp.log_id, new Date().toISOString(), 315360000n),
    'checkpoint signature valid',
    'checkpoint signature invalid',
  );
  if (cpVerdict.status !== 'verified') return cpVerdict;

  // 2. inclusion proof — the leaf is rebuilt from the receipt (RFC-0012 §9.1 step 1).
  if (!receipt) {
    return unavailable('checkpoint signature valid; inclusion leaf needs the registry receipt (not present)');
  }
  let leaf: string;
  try {
    leaf = wasm.buildLogLeaf(JSON.stringify(receipt));
  } catch (e) {
    return failed(`could not rebuild the log leaf: ${(e as Error).message}`);
  }
  // RFC-ACDP-0012 §10 log_inclusion is a CLOSED schema — the sibling
  // witness_signatures (RFC-0015) must be dropped before the proof verify.
  const inclusionForVerify = {
    log_id: inclusion.log_id,
    leaf_index: inclusion.leaf_index,
    tree_size: inclusion.tree_size,
    inclusion_path: inclusion.inclusion_path,
    log_checkpoint: inclusion.log_checkpoint,
  };
  return fromWasm(
    () => wasm.verifyLogInclusion(JSON.stringify(inclusionForVerify), JSON.stringify(cp), leaf),
    'checkpoint signature valid AND inclusion proof recomputes to the signed root',
    'inclusion proof does not recompute to the checkpoint root',
  );
}

// ── witness cosignatures + N-witnessed quorum (RFC-ACDP-0015 §8) ───────
export interface QuorumVerdict extends Verdict {
  witnessedCount: number;
  requiredCount: number;
}

export async function verifyWitnessQuorum(inclusion: LogInclusion, docs: DidDocMap): Promise<QuorumVerdict> {
  const wasm = await getAcdpWasm();
  const cosigs = inclusion.witness_signatures ?? [];
  const trusted = Array.from(new Set(cosigs.map((c) => c.witness_id)));
  const required = trusted.length; // demo policy: every distinct witness on hand must verify
  const witnessDocs: Record<string, unknown> = {};
  for (const wid of trusted) {
    // Use the cosignature's own signature.key_id so a synthesized did:key
    // document exposes the exact verification-method fragment the signer used.
    const keyId = cosigs.find((c) => c.witness_id === wid)?.signature.key_id;
    const doc = resolveDidDocument(wid, docs, keyId);
    if (doc) witnessDocs[wid] = doc;
  }
  let raw: string;
  try {
    raw = wasm.evaluateWitnessQuorum(
      JSON.stringify(cosigs),
      JSON.stringify(inclusion.log_checkpoint),
      JSON.stringify(trusted),
      JSON.stringify(witnessDocs),
      JSON.stringify({ min_witnesses: Math.max(1, required), max_age_secs: null }),
      new Date().toISOString(),
    );
  } catch (e) {
    return { status: 'failed', detail: `malformed cosignatures: ${(e as Error).message}`, witnessedCount: 0, requiredCount: required };
  }
  const report = JSON.parse(raw) as {
    witnessed_count: number;
    meets_quorum: boolean;
    failures?: unknown[];
  };
  const wc = report.witnessed_count;
  if (report.meets_quorum) {
    return {
      status: 'verified',
      detail: `${wc}-witnessed — every cosignature independently verified against its witness key`,
      witnessedCount: wc,
      requiredCount: required,
    };
  }
  return {
    status: 'failed',
    detail: `${wc} of ${required} witness cosignatures verified`,
    witnessedCount: wc,
    requiredCount: required,
  };
}
