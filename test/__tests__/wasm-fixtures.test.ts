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
//
// Boundary: because this file hand-feeds bytes to `init()` directly, it does
// NOT exercise `getAcdpWasm()`'s dynamic-`import()` + webpack
// `new URL('..._bg.wasm', import.meta.url)` path (`lib/verify/wasm.ts:20-31`)
// — the very path an acdp-wasm bump touching `__wbg_load` would affect. A
// green gate here plus a green `next build` still leaves the browser loader
// itself unverified.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import init, * as acdp from '@agentcontextdistributionprotocol/acdp-wasm';
import type { ContextBody, LogInclusion, RegistryReceipt } from '@/lib/types';
import { MOCK_CONTEXTS, MOCK_LINEAGE_CHAINS } from '@/lib/data/mock-data';
import { LIN_ATTESTED, MOCK_CRYPTO, MOCK_DID_DOCS, WITNESS_BETA_DID } from '@/lib/data/mock-crypto';
import { resolveDidDocument, resolveEd25519Raw, resolveVerificationKey } from '@/lib/verify/resolve';

const REGISTRY_A_DID = 'did:web:registry-a.playground.local';

// ── key extraction ───────────────────────────────────────────────────
// `resolveVerificationKey` / `resolveEd25519Raw` (lib/verify/resolve.ts)
// only call the wasm-gated `getAcdpWasm()` inside their `did:key:` branch;
// the `did:web` branch (`findMethod` → `keyFromMethod`) is pure, sync-safe
// logic over `btoa`/`atob`, which are ordinary Node globals. Every lookup in
// this file is `did:web`, so the real resolver is used directly here rather
// than a hand-rolled duplicate — a side benefit is that this gate now also
// exercises `lib/verify/resolve.ts` itself (in coverage scope), not a
// parallel copy of it that isn't.
async function ed25519RawB64FromDoc(did: string): Promise<string> {
  const raw = await resolveEd25519Raw(did, MOCK_DID_DOCS);
  if (!raw) throw new Error(`no ed25519 key resolved for ${did}`);
  return raw;
}
/** SEC1 P-256 public key (base64) from a did:web doc's (sole) verification method. */
async function p256Sec1B64FromDoc(did: string): Promise<string> {
  const key = await resolveVerificationKey(did, MOCK_DID_DOCS);
  if (!key || key.algorithm !== 'ecdsa-p256') throw new Error(`no P-256 key resolved for ${did}`);
  return key.pubKeyB64;
}

/** SHA-256 of a UTF-8 string, hex — this is a node test file, so node's real `crypto` is used directly (same as `gen-mock-crypto.mjs`). */
const sha256Hex = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

// ── full ContextBody per MOCK_CRYPTO entry ──────────────────────────────
// Sourced from the SAME assembled bodies the app actually serves
// (mock-data.ts), rather than a third hand-copied identity table: four of
// the five are `MOCK_CONTEXTS` entries directly, and `cashV2` (which never
// surfaces in `MOCK_CONTEXTS` — see the drift-canary comment below) is the
// second entry of its lineage chain. Typing this as
// `Record<keyof typeof MOCK_CRYPTO, ContextBody>` preserves the
// exhaustiveness guard: a 6th `MOCK_CRYPTO` entry without a matching body
// here fails `npm run typecheck`.
const FULL_BODY: Record<keyof typeof MOCK_CRYPTO, ContextBody> = {
  arcticSource: MOCK_CONTEXTS[0].body,
  arcticDeriv: MOCK_CONTEXTS[1].body,
  cashV1: MOCK_CONTEXTS[2].body,
  cashV2: MOCK_LINEAGE_CHAINS['lin-cashflow-001'][1].body,
  attested: MOCK_CONTEXTS[3].body,
};

function fullBodyOf(key: keyof typeof MOCK_CRYPTO): ContextBody {
  return FULL_BODY[key];
}

const MOCK_CRYPTO_KEYS = Object.keys(MOCK_CRYPTO) as Array<keyof typeof MOCK_CRYPTO>;

describe('wasm-fixtures (real acdp_wasm_bg.wasm)', () => {
  beforeAll(async () => {
    const wasmPath = createRequire(import.meta.url).resolve(
      '@agentcontextdistributionprotocol/acdp-wasm/acdp_wasm_bg.wasm',
    );
    // Load once for the whole file — the binary is ~757KB. A load failure
    // here must fail the whole suite loudly; nothing downstream swallows it.
    await init({ module_or_path: readFileSync(wasmPath) });
  });

  // ── 0. fixture-count guard ──────────────────────────────────────────────
  // These counts are load-bearing for coverage: MOCK_CRYPTO_KEYS drives the
  // content-hash/signature loops below (5 entries: 4 Ed25519 + 1 P-256) and
  // MOCK_CONTEXTS drives the drift-canary loop (4 entries). Emptying either
  // array already fails loudly (vitest errors on an empty `it.each` table).
  // `toHaveLength` also fires symmetrically on *growth* (5→6, 4→5), not just
  // shrinkage — that's fine: a deliberate fixture addition is expected to
  // touch this line, and doing so consciously is correct behavior. What this
  // guards against is either direction happening *silently*, quietly
  // changing how much of the wasm surface this gate exercises on an
  // otherwise green run — nothing else in the repo asserts these counts.
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
  it('arcticSource producer signature verifies (Ed25519, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.arcticSource;
    const rawKey = await ed25519RawB64FromDoc('did:web:registry-a.local:agents:cross-a');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('arcticDeriv producer signature verifies (ECDSA-P256, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.arcticDeriv;
    expect(signature.algorithm).toBe('ecdsa-p256');
    const sec1Key = await p256Sec1B64FromDoc('did:web:registry-b.local:agents:cross-b');
    const verdict = JSON.parse(acdp.verifySignatureP256(sec1Key, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('cashV1 producer signature verifies (Ed25519, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.cashV1;
    const rawKey = await ed25519RawB64FromDoc('did:web:registry-a.local:agents:solo');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('cashV2 producer signature verifies (Ed25519, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.cashV2;
    const rawKey = await ed25519RawB64FromDoc('did:web:registry-a.local:agents:solo');
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
  it('registry receipt verifies (independently recomputed body hash + fingerprint)', async () => {
    const receipt = MOCK_CRYPTO.attested.registry_receipt as RegistryReceipt;
    const body = fullBodyOf('attested');
    // Recompute the body hash OURSELVES, same as verify.ts does — never trust
    // the receipt's echoed content_hash.
    const preimage = acdp.canonicalPreimage(JSON.stringify(body));
    const recomputed = `sha256:${sha256Hex(preimage)}`;
    const registryKeyB64 = await ed25519RawB64FromDoc(REGISTRY_A_DID);
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
    // ctx_id comes from FULL_BODY (the value that was actually signed), not
    // the receipt under test — production binds against `body.ctx_id`, an
    // independent value (verify.ts:122).
    const verdict = JSON.parse(
      acdp.verifyReceipt(JSON.stringify(receipt), registryKeyB64, body.ctx_id, recomputed, fingerprint),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 4. lineage-head receipt (RFC-ACDP-0011) ────────────────────────────
  it('lineage-head receipt verifies', () => {
    const lhr = MOCK_CRYPTO.attested.lineage_head_receipt!;
    const expected = {
      registry_did: REGISTRY_A_DID,
      lineage_id: LIN_ATTESTED,
      head_ctx_id: FULL_BODY.attested.ctx_id,
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
