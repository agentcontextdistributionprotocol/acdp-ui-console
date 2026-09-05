// @vitest-environment node
// ══════════════════════════════════════════════════════════════════════
// Loads the REAL acdp_wasm_bg.wasm and drives it over the committed demo
// fixtures. Every other test in this repo `vi.mock`s the 12 wasm symbols
// (see verify.test.ts / use-verdicts.test.ts) — this is the ONLY place the
// actual verifier binary is ever executed in CI. If a bump silently changes
// verifier semantics, this is the file that is supposed to turn red.
//
// The published package is `wasm-pack --target web` only (no `nodejs`
// variant), so it is hand-fed the binary exactly as
// `scripts/gen-mock-crypto.mjs` already does for the fixture generator
// itself: `readFileSync` the `_bg.wasm` and pass the bytes to `init()`.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import init, * as acdp from '@agentcontextdistributionprotocol/acdp-wasm';
import type { ContextBody, LogInclusion, RegistryReceipt } from '@/lib/types';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';
import { LIN_ATTESTED, MOCK_CRYPTO, MOCK_DID_DOCS, WITNESS_BETA_DID } from '@/lib/data/mock-crypto';
import { resolveDidDocument } from '@/lib/verify/resolve';

const REGISTRY_A_DID = 'did:web:registry-a.playground.local';
const AUTH_A = 'registry-a.playground.local';
const AUTH_B = 'registry-b.playground.local';

// ── hand-rolled key extraction ──────────────────────────────────────────
// `lib/verify/wasm.ts:17-19` hard-rejects `getAcdpWasm()` when
// `typeof window === 'undefined'`, so `lib/verify/verify.ts` and the key
// resolvers in `lib/verify/resolve.ts` (`resolveVerificationKey`,
// `resolveEd25519Raw`) are unusable from a node test. Their raw-key
// extraction helpers (`multibaseEd25519Raw`, `b64urlToBytes`,
// `base58decode`) are module-private and not exported — exporting them
// purely to satisfy a test would widen resolve.ts's public surface for no
// production benefit, so this file duplicates the ~30 lines instead.
// `resolveDidDocument` (resolve.ts:159) *is* pure, sync and wasm-free, so
// it is imported and reused rather than re-implemented below.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error(`invalid base58 char '${ch}'`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const ch of s) {
    if (ch === '1') zeros++;
    else break;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}
/** `z…` multibase (base58btc) with an ed25519-pub multicodec prefix (0xed 0x01) → raw 32-byte key. */
function multibaseEd25519Raw(mb: string): Uint8Array {
  if (!mb.startsWith('z')) throw new Error('unsupported multibase (expected base58btc "z")');
  const decoded = base58decode(mb.slice(1));
  if (decoded[0] === 0xed && decoded[1] === 0x01) return decoded.slice(2);
  return decoded;
}
/** JWK EC P-256 x/y (base64url) → SEC1-uncompressed 65-byte key. */
function jwkP256ToSec1(x: string, y: string): Uint8Array {
  const xb = Buffer.from(x, 'base64url');
  const yb = Buffer.from(y, 'base64url');
  const out = new Uint8Array(1 + xb.length + yb.length);
  out[0] = 0x04;
  out.set(xb, 1);
  out.set(yb, 1 + xb.length);
  return out;
}

interface DidDocLike {
  verificationMethod?: Array<{
    id: string;
    publicKeyMultibase?: string;
    publicKeyJwk?: { x?: string; y?: string };
  }>;
}
/** Raw ed25519 public key (base64) from a did:web doc's (sole) verification method. */
function ed25519RawB64FromDoc(did: string): string {
  const doc = MOCK_DID_DOCS[did] as DidDocLike;
  const method = doc.verificationMethod?.[0];
  if (!method?.publicKeyMultibase) throw new Error(`no ed25519 multibase key on ${did}`);
  return Buffer.from(multibaseEd25519Raw(method.publicKeyMultibase)).toString('base64');
}
/** SEC1 P-256 public key (base64) from a did:web doc's (sole) verification method. */
function p256Sec1B64FromDoc(did: string): string {
  const doc = MOCK_DID_DOCS[did] as DidDocLike;
  const jwk = doc.verificationMethod?.[0]?.publicKeyJwk;
  if (!jwk?.x || !jwk?.y) throw new Error(`no P-256 JWK key on ${did}`);
  return Buffer.from(jwkP256ToSec1(jwk.x, jwk.y)).toString('base64');
}

/** SHA-256 of a UTF-8 string, hex — this is a node test file, so node's real `crypto` is used directly (same as `gen-mock-crypto.mjs`). */
const sha256Hex = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

// ── the five MOCK_CRYPTO entries' identity fields ───────────────────────
// content_hash excludes ctx_id/lineage_id/origin_registry/created_at from its
// preimage (see the comment above `MOCK_CONTEXTS` in mock-data.ts, and the
// drift assertion below, which depends on it) — but these are the *actual*
// values `scripts/gen-mock-crypto.mjs` used when minting each entry, so the
// bodies reconstructed here are byte-for-byte what was signed, not just
// "some value that happens to still verify".
const IDENTITY: Record<keyof typeof MOCK_CRYPTO, Pick<ContextBody, 'ctx_id' | 'lineage_id' | 'origin_registry' | 'created_at'>> = {
  arcticSource: {
    ctx_id: `acdp://${AUTH_A}/f4a2c9e1-1d2b-4a3c-9e8f-001`,
    lineage_id: 'lin-arctic-001',
    origin_registry: AUTH_A,
    created_at: '2026-07-06T11:59:00.000Z',
  },
  arcticDeriv: {
    ctx_id: `acdp://${AUTH_B}/9c11a7f2-7b6c-4d5e-8a9b-002`,
    lineage_id: 'lin-arctic-002',
    origin_registry: AUTH_B,
    created_at: '2026-07-06T12:30:00.000Z',
  },
  cashV1: {
    ctx_id: `acdp://${AUTH_A}/2e78f01a-solo`,
    lineage_id: 'lin-cashflow-001',
    origin_registry: AUTH_A,
    created_at: '2026-07-06T09:00:00.000Z',
  },
  cashV2: {
    ctx_id: `acdp://${AUTH_A}/2e78f01a-solo-v2`,
    lineage_id: 'lin-cashflow-001',
    origin_registry: AUTH_A,
    created_at: '2026-07-05T12:00:00.000Z',
  },
  attested: {
    ctx_id: `acdp://${AUTH_A}/attested-001`,
    lineage_id: LIN_ATTESTED,
    origin_registry: AUTH_A,
    created_at: '2026-07-06T11:57:00.000Z',
  },
};

/** Reassemble a full ContextBody for a MOCK_CRYPTO entry (mirrors mock-data.ts's own assembly). */
function fullBodyOf(key: keyof typeof MOCK_CRYPTO): ContextBody {
  const entry = MOCK_CRYPTO[key];
  return {
    ...IDENTITY[key],
    ...entry.hashed,
    content_hash: entry.content_hash,
    signature: entry.signature,
  } as ContextBody;
}

const MOCK_CRYPTO_KEYS = Object.keys(MOCK_CRYPTO) as Array<keyof typeof MOCK_CRYPTO>;

describe('wasm-fixtures (real acdp_wasm_bg.wasm)', () => {
  beforeAll(async () => {
    const wasmPath = path.join(
      process.cwd(),
      'node_modules/@agentcontextdistributionprotocol/acdp-wasm/acdp_wasm_bg.wasm',
    );
    // Load once for the whole file — the binary is ~757KB. A load failure
    // here must fail the whole suite loudly; nothing downstream swallows it.
    await init({ module_or_path: readFileSync(wasmPath) });
  });

  // ── 0. fixture-count guard ──────────────────────────────────────────────
  // These counts are load-bearing for coverage: MOCK_CRYPTO_KEYS drives the
  // content-hash/signature loops below (5 entries: 4 Ed25519 + 1 P-256) and
  // MOCK_CONTEXTS drives the drift-canary loop (4 entries). Emptying either
  // array already fails loudly (vitest errors on an empty `it.each` table),
  // but silently *shrinking* one (5→3, 4→2) would quietly reduce how much of
  // the wasm surface this gate exercises on an otherwise green run — nothing
  // else in the repo asserts these counts.
  it('fixture counts have not silently shrunk', () => {
    expect(MOCK_CRYPTO_KEYS).toHaveLength(5);
    expect(MOCK_CONTEXTS).toHaveLength(4);
  });

  // ── 1. all 5 MOCK_CRYPTO content hashes verify ─────────────────────────
  it.each(MOCK_CRYPTO_KEYS)('content_hash verifies for MOCK_CRYPTO.%s', (key) => {
    const body = fullBodyOf(key);
    const verdict = JSON.parse(acdp.verifyContentHash(JSON.stringify(body), body.content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 2. all 5 producer signatures verify (4 Ed25519 + 1 P-256) ──────────
  it('arcticSource producer signature verifies (Ed25519, did:web)', () => {
    const { content_hash, signature } = MOCK_CRYPTO.arcticSource;
    const rawKey = ed25519RawB64FromDoc('did:web:registry-a.local:agents:cross-a');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('arcticDeriv producer signature verifies (ECDSA-P256, did:web)', () => {
    const { content_hash, signature } = MOCK_CRYPTO.arcticDeriv;
    expect(signature.algorithm).toBe('ecdsa-p256');
    const sec1Key = p256Sec1B64FromDoc('did:web:registry-b.local:agents:cross-b');
    const verdict = JSON.parse(acdp.verifySignatureP256(sec1Key, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('cashV1 producer signature verifies (Ed25519, did:web)', () => {
    const { content_hash, signature } = MOCK_CRYPTO.cashV1;
    const rawKey = ed25519RawB64FromDoc('did:web:registry-a.local:agents:solo');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('cashV2 producer signature verifies (Ed25519, did:web)', () => {
    const { content_hash, signature } = MOCK_CRYPTO.cashV2;
    const rawKey = ed25519RawB64FromDoc('did:web:registry-a.local:agents:solo');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('attested producer signature verifies (Ed25519, did:key — offline)', () => {
    const { content_hash, signature } = MOCK_CRYPTO.attested;
    const did = signature.key_id.split('#')[0];
    const resolved = JSON.parse(acdp.resolveDidKey(did)) as { algorithm: string; public_key_b64: string };
    expect(resolved.algorithm).toBe('ed25519');
    const verdict = JSON.parse(
      acdp.verifySignatureEd25519(resolved.public_key_b64, signature.value, content_hash),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 3. registry receipt (RFC-ACDP-0010) ────────────────────────────────
  it('registry receipt verifies (independently recomputed body hash + fingerprint)', () => {
    const receipt = MOCK_CRYPTO.attested.registry_receipt as RegistryReceipt;
    const body = fullBodyOf('attested');
    // Recompute the body hash OURSELVES, same as verify.ts does — never trust
    // the receipt's echoed content_hash.
    const preimage = acdp.canonicalPreimage(JSON.stringify(body));
    const recomputed = `sha256:${sha256Hex(preimage)}`;
    const registryKeyB64 = ed25519RawB64FromDoc(REGISTRY_A_DID);
    // Recompute the producer-key fingerprint OURSELVES too (verify.ts:120) —
    // never trust the receipt's echoed key_fingerprint. `attested`'s producer
    // key is a did:key (offline), resolved the same way as the standalone
    // signature test above.
    const producerDid = body.signature!.key_id.split('#')[0];
    const producerResolved = JSON.parse(acdp.resolveDidKey(producerDid)) as {
      algorithm: string;
      public_key_b64: string;
    };
    const fingerprint = acdp.fingerprintEd25519(producerResolved.public_key_b64);
    // Make the derivation load-bearing: it must land on the same fingerprint
    // the receipt itself carries, not just "some value that happens to verify".
    expect(fingerprint).toBe(receipt.key_fingerprint);
    // ctx_id comes from IDENTITY (the value that was actually signed), not the
    // receipt under test — production binds against `body.ctx_id`, an
    // independent value (verify.ts:122).
    const verdict = JSON.parse(
      acdp.verifyReceipt(JSON.stringify(receipt), registryKeyB64, IDENTITY.attested.ctx_id, recomputed, fingerprint),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 4. lineage-head receipt (RFC-ACDP-0011) ────────────────────────────
  it('lineage-head receipt verifies', () => {
    const lhr = MOCK_CRYPTO.attested.lineage_head_receipt!;
    const expected = {
      registry_did: REGISTRY_A_DID,
      lineage_id: LIN_ATTESTED,
      head_ctx_id: IDENTITY.attested.ctx_id,
      head_version: 1,
      head_status: 'active',
    };
    const doc = resolveDidDocument(REGISTRY_A_DID, MOCK_DID_DOCS);
    const verdict = JSON.parse(
      acdp.verifyLineageHeadReceipt(
        JSON.stringify(lhr),
        JSON.stringify(expected),
        JSON.stringify(doc),
        new Date().toISOString(),
        315360000n,
        315360000n,
      ),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 5 & 6. transparency log: checkpoint + inclusion proof (RFC-ACDP-0012) ─
  const inclusion = MOCK_CRYPTO.attested.log_inclusion as unknown as LogInclusion;

  it('log checkpoint signature verifies', () => {
    const cp = inclusion.log_checkpoint;
    const doc = resolveDidDocument(cp.signature.key_id.split('#')[0], MOCK_DID_DOCS);
    const verdict = JSON.parse(
      acdp.verifyLogCheckpoint(JSON.stringify(cp), JSON.stringify(doc), cp.log_id, new Date().toISOString(), 315360000n),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('inclusion proof recomputes to the signed root (buildLogLeaf + verifyLogInclusion)', () => {
    const receipt = MOCK_CRYPTO.attested.registry_receipt as RegistryReceipt;
    const leaf = acdp.buildLogLeaf(JSON.stringify(receipt));
    // RFC-ACDP-0012 §10 log_inclusion is a CLOSED schema — witness_signatures
    // is a sibling member, never part of the signed inclusion proof itself.
    const inclusionForVerify = {
      log_id: inclusion.log_id,
      leaf_index: inclusion.leaf_index,
      tree_size: inclusion.tree_size,
      inclusion_path: inclusion.inclusion_path,
      log_checkpoint: inclusion.log_checkpoint,
    };
    const verdict = JSON.parse(
      acdp.verifyLogInclusion(JSON.stringify(inclusionForVerify), JSON.stringify(inclusion.log_checkpoint), leaf),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 7. 2-of-2 witness quorum (RFC-ACDP-0015 §8) ────────────────────────
  it('2-of-2 witness quorum is satisfied', () => {
    const cosigs = inclusion.witness_signatures ?? [];
    expect(cosigs).toHaveLength(2);
    const trusted = cosigs.map((c) => c.witness_id);
    expect(trusted).toContain(WITNESS_BETA_DID);
    const witnessDocs: Record<string, unknown> = {};
    for (const cosig of cosigs) {
      witnessDocs[cosig.witness_id] = resolveDidDocument(cosig.witness_id, MOCK_DID_DOCS, cosig.signature.key_id);
    }
    const raw = acdp.evaluateWitnessQuorum(
      JSON.stringify(cosigs),
      JSON.stringify(inclusion.log_checkpoint),
      JSON.stringify(trusted),
      JSON.stringify(witnessDocs),
      JSON.stringify({ min_witnesses: 2, max_age_secs: null }),
      new Date().toISOString(),
    );
    const report = JSON.parse(raw) as { witnessed_count: number; meets_quorum: boolean };
    expect(report.witnessed_count).toBe(2);
    expect(report.meets_quorum).toBe(true);
  });

  // ── 8. created_at drift — the regression canary ────────────────────────
  // `mock-data.ts` supplies a wall-clock-relative `created_at` (`iso(N)`) for
  // every MOCK_CONTEXTS body, while the fixtures in mock-crypto.ts were
  // signed against a frozen clock (gen-mock-crypto.mjs). This only passes
  // because `canonicalPreimage` excludes `created_at` from the hash preimage.
  // If a future acdp-wasm release changed that exclusion set, the FIXTURE
  // GENERATOR would still self-verify green (it signs and checks against the
  // same frozen timestamp) while every demo trust chip went red in the
  // browser (which serves the drifted, wall-clock created_at) — a
  // generator-exit-0 gate is structurally blind to that regression. This
  // assertion is not.
  //
  // Driven off MOCK_CONTEXTS (4 entries — cashV2 never surfaces as a context
  // body, so it is not here; it is covered above via MOCK_CRYPTO directly).
  it.each(MOCK_CONTEXTS.map((c, i) => [i, c] as const))(
    'content_hash still verifies with a runtime-drifted created_at (MOCK_CONTEXTS[%i])',
    (_i, ctx) => {
      const verdict = JSON.parse(
        acdp.verifyContentHash(JSON.stringify(ctx.body), ctx.body.content_hash),
      ) as { valid: boolean };
      expect(verdict.valid).toBe(true);
    },
  );

  // ── 9. negative control — a stubbed "always valid" verifier must not pass ─
  it('a tampered field makes the verdict invalid (negative control)', () => {
    const original = MOCK_CONTEXTS[0].body;
    const tampered: ContextBody = { ...original, title: `${original.title} (tampered)` };
    const verdict = JSON.parse(
      acdp.verifyContentHash(JSON.stringify(tampered), original.content_hash),
    ) as { valid: boolean; error?: string };
    expect(verdict.valid).toBe(false);
  });
});
