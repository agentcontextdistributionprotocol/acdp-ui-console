// ══════════════════════════════════════════════════════════════════════
// Client-side ACDP verification — REAL cryptographic verdicts.
//
// Every function here reaches an *independent* verdict by running the wasm
// verifier over the data on hand. A green result means the browser recomputed
// the hash / checked the signature itself — never that a server said so.
//
//   status: 'verified'    → cryptographically checked and valid
//           'failed'      → cryptographically checked and INVALID (tamper/mismatch)
//           'unavailable' → COULD NOT CHECK. Two distinct causes, both of them
//                           "we have no verdict", neither of them a finding:
//                             (a) a required signer key / DID document is not
//                                 on hand — the original case, rendered as
//                                 "material only";
//                             (b) the material itself could not be parsed well
//                                 enough for the check to run at all (see
//                                 `verifyCtxIdBinding` below, which carries its
//                                 own `unavailableLabel` so the chip does not
//                                 claim a missing key it does have).
//
// `unavailable` is NEVER rendered as a pass. Neither a missing key nor an
// unparseable body is a failure of the proof — but neither is a verification,
// so they share this third state rather than being forced into `failed`.
// A verdict producer that reaches `unavailable` for reason (b) SHOULD set
// `unavailableLabel`, because the default chip copy names reason (a).
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
  /**
   * Optional replacement for the chip's default `unavailable` status word
   * ("material only"). That default is copy written for the key-not-on-hand
   * case every other `unavailable` in this module represents; a producer that
   * reaches `unavailable` for a DIFFERENT reason sets this so the chip does not
   * say something untrue. Consumed by `VerdictChip`
   * (`components/contexts/context-detail.tsx`); absent for every other verdict,
   * which keeps the default rendering unchanged.
   */
  unavailableLabel?: string;
}

const verified = (detail: string): Verdict => ({ status: 'verified', detail });
const failed = (detail: string): Verdict => ({ status: 'failed', detail });
const unavailable = (detail: string, unavailableLabel?: string): Verdict =>
  unavailableLabel
    ? { status: 'unavailable', detail, unavailableLabel }
    : { status: 'unavailable', detail };

interface WasmVerdict {
  valid: boolean;
  error?: string;
  stale?: boolean;
}

/** Run a wasm verifier that returns a `{valid,…}` verdict, mapping throws honestly. */
function fromWasm(run: () => string, okDetail: string, failPrefix: string): Verdict {
  let v: WasmVerdict;
  try {
    v = JSON.parse(run()) as WasmVerdict;
  } catch (e) {
    // A THROW (or unparseable output) is malformed *host input* (RFC-ACDP spec
    // violation in the material itself), not a clean false verdict — surface it
    // as a failure to verify.
    return failed(`malformed material: ${(e as Error).message}`);
  }
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

/**
 * The two strict-parse gates acdp-wasm 0.14.1's `verifyCtxIdBinding` THROWS
 * from, and how each maps to an honest `unavailable`.
 *
 * `acdp_wasm.d.ts` documents that this function "Throws on malformed body JSON
 * or a malformed `expectedCtxId`" — i.e. EVERY documented throw from it is a
 * could-not-check, never a verdict about the served body's authenticity. There
 * is no structured discriminator to switch on: the throws are plain `Error`s
 * with no `code` and no own enumerable keys (confirmed against the installed
 * binary), so the message prefix is the only signal available.
 *
 * The two prefixes implicate OPPOSITE parties and therefore must not share one
 * sentence. `invalid body JSON:` means the registry's body did not conform to
 * the acdp-rs `Body` schema. `invalid expected_ctx_id:` means the id THIS
 * CONSOLE asked about is not a canonical ACDP id — the served body may be
 * perfectly well-formed, and the same body that throws under a bad id returns
 * `{"valid":true}` under a good one. Blaming the body on that arm would accuse
 * a correctly-behaving registry, which is the exact defect this mapping exists
 * to remove.
 */
const CTX_ID_BINDING_UNCHECKABLE: ReadonlyArray<{
  prefix: string;
  detail: string;
  unavailableLabel: string;
}> = [
  {
    prefix: 'invalid body JSON:',
    detail: 'served body does not conform to the acdp-rs Body schema — ctx_id binding not checked',
    unavailableLabel: 'body not parseable',
  },
  {
    prefix: 'invalid expected_ctx_id:',
    detail:
      'the requested ctx_id is not a canonical ACDP id — binding not checked; the served body was not the problem',
    unavailableLabel: 'requested id malformed',
  },
];

// ── ctx_id binding (acdp-wasm 0.14.1) — catches a registry silently serving a
// DIFFERENT context than the one requested. `content_hash` alone can't catch
// this: a body can be perfectly self-consistent and still be the wrong body.
// `expectedCtxId` MUST come from the caller's own independently-known request
// (a search hit's id, a URL param, a graph node's id) — NEVER read back off
// `body.ctx_id` itself, which would make this tautologically green.
//
// THIS FUNCTION DOES NOT USE `fromWasm`'s THROW MAPPING, deliberately.
// `fromWasm` turns every throw into `failed` — correct for its other callers,
// whose comment (above) reads a throw as "malformed host input (RFC-ACDP spec
// violation in the material itself)". That reading does not hold here, and the
// dominant trigger shows why: a body with NO `signature` throws
// `invalid body JSON: missing field \`signature\``, yet `lib/types.ts:310`
// declares `signature?` optional, `:318` declares `data_refs?` optional, and
// `context-detail.tsx` renders an unsigned context with a neutral `unsigned`
// chip as a legitimate state. Mapping that to `failed` renders
// "✗ ctx_id binding · verification failed" — the one verdict in this module
// that alleges a HOSTILE REGISTRY — against a registry that served exactly
// what it was asked for. A false allegation of tampering is not the same cost
// as a false alarm. `verifyRegistryReceipt` (below) already returns
// `unavailable` for this same missing-signature case, so this also makes the
// function consistent with its own module contract and its own neighbour.
//
// A CLEAN `{valid:false}` VERDICT STAYS `failed`. The binary returns that for
// genuine substitution ("context substitution: requested …, registry served
// …"), which is the finding this check exists for and is not blunted here.
// An unrecognized throw message ALSO stays `failed` — see below.
//
// THE `invalid body JSON:` ARM IS ATTACKER-REACHABLE. Stating this plainly,
// because the rest of this reasoning is about accidental failure and a reader
// should not mistake it for an exhaustive threat model. A hostile registry that
// wants to suppress its own red chip can do it deterministically: serve the
// substituted body AND make that body fail acdp-rs `Body` deserialization (drop
// `data_refs`, use an unknown `type`, …). Before this change that rendered red;
// now it renders amber. Three things make that acceptable rather than a
// regression, and all three are load-bearing:
//   1. The pre-change red was never a DETECTION. The binary threw before
//      running the binding comparison, on both sides of this change — so the
//      old red chip was an accident of the catch-all mapping, not evidence of
//      substitution. Nothing that was previously proven is now unproven.
//   2. `unavailable` is never rendered as a pass, and the caption says
//      verbatim that the binding was NOT checked. The console asserts nothing
//      it cannot prove, which is the invariant that actually matters here.
//   3. A receipt-bearing context still goes red independently, via
//      `verifyRegistryReceipt` — which this phase deliberately leaves on
//      `fromWasm`'s throw→`failed` mapping.
// What is genuinely lost is a red chip on a receipt-LESS context with an
// unparseable body. If that becomes a real concern, the fix is a positive
// signal (a registry-receipt requirement, or an upstream structured error
// discriminator), not reverting to an accusation the verifier never made.
//
// WHY A PREFIX MATCH RATHER THAN A BLANKET `catch → unavailable`. A blanket
// catch is defensible on the documentation alone and would carry no string
// debt, but it fails in the wrong direction: a genuinely new throw class in a
// future acdp-wasm would be silently absorbed as `unavailable` (an
// UNDER-alarm). Under a prefix match, a changed message merely stops matching
// and reverts to today's red `failed` (an OVER-alarm). That asymmetry, not
// elegance, is why the prefix match wins — and
// `test/__tests__/wasm-fixtures.test.ts` pins both prefixes against the real
// binary so a bump that changes the text fails CI loudly instead of silently
// reverting this behavior.
//
// THIS OVERRIDES TWO RECORDED, CONFIRMED REJECTIONS, both named so a future
// simplification pass does not re-reject the change by pointing at them:
// `ASSUMPTIONS.md` alternative (c) of "UI-2 Phase 2: ctxIdBinding's two
// strict-parse failure surfaces" (the `invalid expected_ctx_id:` arm) and
// alternative (a) of the `fromWasm` entry (the `invalid body JSON:` arm).
// Their stated grounds were (i) string matching is brittle across acdp-wasm
// versions — now answered by the real-binary prefix test, which did not exist
// when they were written; (ii) the hover tooltip already carries the needed
// information "for anyone who hovers" — a `title` attribute is invisible on
// touch, invisible to keyboard, and unreliably announced, so the distinction
// is now surfaced inline via the chip's own label and a `VerdictCaption`; and
// (iii) the over-alarm is "low and one-directional" — true for a genuinely
// malformed body, but priced as uniform when on this arm it is a substitution
// accusation against a correctly-behaving registry.
//
// NOT touched: `verifyReceipt`'s mapping (`verifyRegistryReceipt` below) and
// `fromWasm` itself. Widening this to `fromWasm` would silently re-decide
// DECISIONS.md's deferred question about `verifyReceipt`'s strict `body_json`
// parse on a schema-drifted-but-cryptographically-valid REAL body, which is
// pending a live-registry smoke test. The cost of that scoping, stated: on a
// body carrying a `signature` but no `data_refs`, one view shows
// `ctx_id binding · body not parseable` (amber) beside
// `registry receipt · verification failed` (red) — two colours for one cause.
// Deliberate, and debt to retire when that deferred entry resolves.
export async function verifyCtxIdBinding(body: ContextBody, expectedCtxId: string): Promise<Verdict> {
  const wasm = await getAcdpWasm();
  let raw: string;
  try {
    raw = wasm.verifyCtxIdBinding(JSON.stringify(body), expectedCtxId);
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    const uncheckable = CTX_ID_BINDING_UNCHECKABLE.find((m) => message.startsWith(m.prefix));
    if (uncheckable) return unavailable(uncheckable.detail, uncheckable.unavailableLabel);
    // Fail-safe direction for an unknown condition: an unrecognized throw
    // (a late wasm-init failure, OOM, a future throw class) stays `failed`.
    return failed(`malformed material: ${message}`);
  }
  return fromWasm(
    () => raw,
    'served body is bound to the requested ctx_id',
    'served body does not match the requested ctx_id',
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
    () => wasm.verifyReceipt(JSON.stringify(receipt), JSON.stringify(body), registryKey, body.ctx_id, recomputed, fingerprint),
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
  const witnessDocs: Record<string, unknown> = {};
  for (const wid of trusted) {
    // Use the cosignature's own signature.key_id so a synthesized did:key
    // document exposes the exact verification-method fragment the signer used.
    const keyId = cosigs.find((c) => c.witness_id === wid)?.signature.key_id;
    const doc = resolveDidDocument(wid, docs, keyId);
    if (doc) witnessDocs[wid] = doc;
  }
  // A witness whose DID document didn't resolve can't be checked — per this
  // module's contract, absence of a key is not a failure of the proof. Exclude
  // it from both the quorum requirement and the set handed to the evaluator,
  // rather than letting it count against quorum by default.
  const resolvable = trusted.filter((wid) => Object.hasOwn(witnessDocs, wid));
  const skipped = trusted.length - resolvable.length;
  if (trusted.length > 0 && resolvable.length === 0) {
    return {
      status: 'unavailable',
      detail: `${trusted.length} witness cosignature${trusted.length === 1 ? '' : 's'} present but no witness DID document resolved — quorum not evaluated`,
      witnessedCount: 0,
      requiredCount: trusted.length,
    };
  }
  const required = resolvable.length; // demo policy: every resolvable distinct witness must verify
  const skippedNote =
    skipped > 0 ? ` (${skipped} witness${skipped === 1 ? '' : 'es'} skipped — DID document not resolved)` : '';
  let raw: string;
  try {
    raw = wasm.evaluateWitnessQuorum(
      JSON.stringify(cosigs),
      JSON.stringify(inclusion.log_checkpoint),
      JSON.stringify(resolvable),
      JSON.stringify(witnessDocs),
      JSON.stringify({ min_witnesses: Math.max(1, required), max_age_secs: null }),
      new Date().toISOString(),
    );
  } catch (e) {
    return { status: 'failed', detail: `malformed cosignatures: ${(e as Error).message}`, witnessedCount: 0, requiredCount: required };
  }
  let report: { witnessed_count: number; meets_quorum: boolean; failures?: unknown[] };
  try {
    report = JSON.parse(raw) as typeof report;
  } catch (e) {
    return { status: 'failed', detail: `malformed quorum result: ${(e as Error).message}`, witnessedCount: 0, requiredCount: required };
  }
  const wc = report.witnessed_count;
  if (report.meets_quorum) {
    return {
      status: 'verified',
      detail: `${wc}-witnessed — every cosignature independently verified against its witness key${skippedNote}`,
      witnessedCount: wc,
      requiredCount: required,
    };
  }
  return {
    status: 'failed',
    detail: `${wc} of ${required} witness cosignatures verified${skippedNote}`,
    witnessedCount: wc,
    requiredCount: required,
  };
}
