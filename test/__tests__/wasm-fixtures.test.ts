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
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init, * as acdp from '@agentcontextdistributionprotocol/acdp-wasm';
import type { ContextBody, LogInclusion, RegistryReceipt } from '@/lib/types';
import { MOCK_CONTEXTS, MOCK_LINEAGE_CHAINS } from '@/lib/data/mock-data';
import { LIN_ATTESTED, MOCK_CRYPTO, MOCK_DID_DOCS, WITNESS_BETA_DID } from '@/lib/data/mock-crypto';
import { resolveDidDocument, resolveEd25519Raw, resolveVerificationKey } from '@/lib/verify/resolve';
import { verifyCtxIdBinding } from '@/lib/verify/verify';

// Route `lib/verify/verify.ts`'s own mapping over the REAL binary. Only the
// LOADER is replaced: `getAcdpWasm()` rejects outside a browser
// (`lib/verify/wasm.ts:17-19`), so it is swapped for one that hands back the
// very module instance `beforeAll` initializes below. The verifier, its parser
// and its error messages are the real 0.14.1 ones — which is the entire point:
// the throw→verdict mapping added in UI-3 Phase 1 is a string match on
// upstream's message text, and mocking that text would make the gate
// tautological (exactly how `verify.test.ts`'s mocked throws missed this).
vi.mock('@/lib/verify/wasm', () => ({
  getAcdpWasm: async () => await import('@agentcontextdistributionprotocol/acdp-wasm'),
}));

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
//
// NOTE, since the guarantee changed shape: this used to be enforced by
// accident. `getAcdpWasm()` rejects outside a browser, so a fixture that
// switched to `did:key` would have failed LOUDLY here. The `vi.mock` above now
// makes that loader resolve successfully in this file, so the `did:key` branch
// would run silently instead. The guarantee is therefore "no fixture in
// MOCK_DID_DOCS uses did:key", not "it would throw if one did" — if that ever
// stops holding, this block needs a real assertion rather than a comment.
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
// (mock-data.ts), rather than a third hand-copied identity table: five of
// the six are `MOCK_CONTEXTS` entries directly, and `cashV2` (which never
// surfaces in `MOCK_CONTEXTS` — see the drift-canary comment below) is the
// second entry of its lineage chain. Typing this as
// `Record<keyof typeof MOCK_CRYPTO, ContextBody>` preserves the
// exhaustiveness guard: a 7th `MOCK_CRYPTO` entry without a matching body
// here fails `npm run typecheck`.
const FULL_BODY: Record<keyof typeof MOCK_CRYPTO, ContextBody> = {
  arcticSource: MOCK_CONTEXTS[0].body,
  arcticDeriv: MOCK_CONTEXTS[1].body,
  cashV1: MOCK_CONTEXTS[2].body,
  cashV2: MOCK_LINEAGE_CHAINS['lin-cashflow-001'][1].body,
  attested: MOCK_CONTEXTS[3].body,
  keyRevocation: MOCK_CONTEXTS[4].body,
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
  // content-hash/signature loops below (6 entries: 5 Ed25519 + 1 P-256) and
  // MOCK_CONTEXTS drives the drift-canary loop (5 entries, since UI-2 Phase 5
  // added `keyRevocation`). Emptying either array already fails loudly
  // (vitest errors on an empty `it.each` table). `toHaveLength` also fires
  // symmetrically on *growth* (6→7, 5→6), not just shrinkage — that's fine: a
  // deliberate fixture addition is expected to touch this line, and doing so
  // consciously is correct behavior. What this guards against is either
  // direction happening *silently*, quietly changing how much of the wasm
  // surface this gate exercises on an otherwise green run — nothing else in
  // the repo asserts these counts.
  it('fixture counts have not silently shrunk', () => {
    expect(MOCK_CRYPTO_KEYS).toHaveLength(6);
    expect(MOCK_CONTEXTS).toHaveLength(5);
  });

  // ── 1. all 6 MOCK_CRYPTO content hashes verify ─────────────────────────
  it.each(MOCK_CRYPTO_KEYS)('content_hash verifies for MOCK_CRYPTO.%s', (key) => {
    const body = fullBodyOf(key);
    const verdict = JSON.parse(acdp.verifyContentHash(JSON.stringify(body), body.content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // ── 2. all 6 producer signatures verify (5 Ed25519 + 1 P-256) ──────────
  it('arcticSource producer signature verifies (Ed25519, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.arcticSource;
    const rawKey = await ed25519RawB64FromDoc('did:web:registry-a.local:agents:cross-a');
    const verdict = JSON.parse(acdp.verifySignatureEd25519(rawKey, signature.value, content_hash)) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  it('keyRevocation producer signature verifies (Ed25519, did:web)', async () => {
    const { content_hash, signature } = MOCK_CRYPTO.keyRevocation;
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
      acdp.verifyReceipt(JSON.stringify(receipt), JSON.stringify(body), registryKeyB64, body.ctx_id, recomputed, fingerprint),
    ) as { valid: boolean };
    expect(verdict.valid).toBe(true);
  });

  // `arcticSource` is the OTHER context whose `created_at` is structurally derived from its
  // own receipt (mock-data.ts, same fix as `attested` — see the created_at-consistency test in
  // mock-data.test.ts). Without this second real-binary receipt check, that derivation was only
  // ever exercised against a hand-assembled body inside the generator (gen-mock-crypto.mjs),
  // never against the actual body this console assembles and serves (MOCK_CONTEXTS[0].body) —
  // this closes that one-sided coverage gap, mirroring the `attested` test above exactly.
  it('arcticSource registry receipt verifies (independently recomputed body hash + fingerprint, did:web producer)', async () => {
    const receipt = MOCK_CRYPTO.arcticSource.registry_receipt as RegistryReceipt;
    const body = fullBodyOf('arcticSource');
    const preimage = acdp.canonicalPreimage(JSON.stringify(body));
    const recomputed = `sha256:${sha256Hex(preimage)}`;
    const registryKeyB64 = await ed25519RawB64FromDoc(REGISTRY_A_DID);
    const producerKeyB64 = await ed25519RawB64FromDoc('did:web:registry-a.local:agents:cross-a');
    const fingerprint = acdp.fingerprintEd25519(producerKeyB64);
    expect(fingerprint).toBe(receipt.key_fingerprint);
    const verdict = JSON.parse(
      acdp.verifyReceipt(JSON.stringify(receipt), JSON.stringify(body), registryKeyB64, body.ctx_id, recomputed, fingerprint),
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
  // Driven off MOCK_CONTEXTS (5 entries — cashV2 never surfaces as a context
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

  // ── 10. verifyCtxIdBinding (UI-2 Phase 2, acdp-wasm 0.14.1) ────────────────
  // Every OTHER test of this check (verify.test.ts, use-verdicts.test.ts) mocks
  // the wasm symbol entirely, and demo mode's `getContext` is an exact-match
  // lookup by ctx_id (lib/api/client.ts) so the UI path can never exercise a
  // real mismatch either — this is the ONLY place the real binary's actual
  // verdict (not a stub) proves the check is wired correctly, not tautological.
  it.each(MOCK_CONTEXTS.map((c, i) => [i, c] as const))(
    'ctx_id binding verifies for the body\'s own ctx_id (MOCK_CONTEXTS[%i])',
    (_i, ctx) => {
      const verdict = JSON.parse(
        acdp.verifyCtxIdBinding(JSON.stringify(ctx.body), ctx.body.ctx_id),
      ) as { valid: boolean };
      expect(verdict.valid).toBe(true);
    },
  );

  // The same five bodies, one level up — through verify.ts's mapping rather
  // than the raw binary. The assertion above checks `{valid:true}`, which has
  // no `status` field; this one is what proves the console renders them green.
  it.each(MOCK_CONTEXTS.map((c, i) => [i, c] as const))(
    'ctx_id binding maps to Verdict.status "verified" (MOCK_CONTEXTS[%i])',
    async (_i, ctx) => {
      const verdict = await verifyCtxIdBinding(ctx.body, ctx.body.ctx_id);
      expect(verdict.status).toBe('verified');
      expect(verdict.unavailableLabel).toBeUndefined();
    },
  );

  it('ctx_id binding fails against a DIFFERENT context\'s ctx_id (the real red-chip case)', async () => {
    const served = MOCK_CONTEXTS[0].body;
    const requestedInstead = MOCK_CONTEXTS[1].body.ctx_id;
    const verdict = JSON.parse(
      acdp.verifyCtxIdBinding(JSON.stringify(served), requestedInstead),
    ) as { valid: boolean; error?: string };
    expect(verdict.valid).toBe(false);
    // …and the mapped verdict stays RED. This is the check the whole module
    // exists for; the could-not-check mapping below must not blunt it.
    const mapped = await verifyCtxIdBinding(served, requestedInstead);
    expect(mapped.status).toBe('failed');
    expect(mapped.detail).toContain('does not match the requested ctx_id');
  });

  // ── 11. could-not-check ≠ failed (UI-3 Phase 1) ───────────────────────────
  // acdp-wasm 0.14.1 THROWS (rather than returning a `{valid:false}` verdict)
  // from two strict-parse gates. `lib/verify/verify.ts` string-matches the two
  // message prefixes to map them to `unavailable`, so THIS is the test that
  // pins the upstream message text that mapping depends on: if a future bump
  // changes the wording, criterion-1 below fails loudly here instead of the
  // mapping silently reverting every such context to a red
  // "✗ ctx_id binding · verification failed" — an accusation of registry
  // substitution against a registry that served exactly what was asked for.

  /** Clone a body without one of its (type-level optional) protocol fields. */
  function without(body: ContextBody, field: 'signature' | 'data_refs'): ContextBody {
    const clone: ContextBody = { ...body };
    delete clone[field];
    return clone;
  }

  const BASE = MOCK_CONTEXTS[0].body;

  const UNCHECKABLE: ReadonlyArray<{
    name: string;
    body: ContextBody;
    expectedCtxId: string;
    prefix: string;
    label: string;
    detailNeedle: string;
  }> = [
    {
      name: 'body with `signature` deleted',
      body: without(BASE, 'signature'),
      expectedCtxId: BASE.ctx_id,
      prefix: 'invalid body JSON:',
      label: 'body not parseable',
      detailNeedle: 'served body',
    },
    {
      name: 'body with `data_refs` deleted',
      body: without(BASE, 'data_refs'),
      expectedCtxId: BASE.ctx_id,
      prefix: 'invalid body JSON:',
      label: 'body not parseable',
      detailNeedle: 'served body',
    },
    {
      name: "body with visibility 'internal'",
      body: { ...BASE, visibility: 'internal' },
      expectedCtxId: BASE.ctx_id,
      prefix: 'invalid body JSON:',
      label: 'body not parseable',
      detailNeedle: 'served body',
    },
    {
      name: 'body with an unknown `type`',
      body: { ...BASE, type: 'wat' },
      expectedCtxId: BASE.ctx_id,
      prefix: 'invalid body JSON:',
      label: 'body not parseable',
      detailNeedle: 'served body',
    },
    {
      name: 'well-formed body, malformed expectedCtxId',
      body: BASE,
      expectedCtxId: 'not-a-ctx-id',
      prefix: 'invalid expected_ctx_id:',
      label: 'requested id malformed',
      detailNeedle: 'requested ctx_id',
    },
  ];

  it.each(UNCHECKABLE.map((c) => [c.name, c] as const))(
    'the real binary throws with the pinned prefix — %s',
    (_name, c) => {
      let thrown: unknown;
      try {
        acdp.verifyCtxIdBinding(JSON.stringify(c.body), c.expectedCtxId);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, 'expected the binary to THROW, not return a verdict').toBeInstanceOf(Error);
      expect((thrown as Error).message.startsWith(c.prefix)).toBe(true);
    },
  );

  it.each(UNCHECKABLE.map((c) => [c.name, c] as const))(
    'maps to `unavailable`, not `failed` — %s',
    async (_name, c) => {
      const verdict = await verifyCtxIdBinding(c.body, c.expectedCtxId);
      expect(verdict.status).toBe('unavailable');
      expect(verdict.unavailableLabel).toBe(c.label);
      expect(verdict.detail).toContain(c.detailNeedle);
      expect(verdict.detail).not.toContain('malformed material');
    },
  );

  // The two arms implicate OPPOSITE parties, so one shared sentence would be
  // actively false on one of them: the same body that throws under a bad id
  // returns `{"valid":true}` under a good one, so blaming the served body there
  // would accuse a correctly-behaving registry. Falsified by string comparison.
  //
  // The plan's criterion 8 asks that "neither string appears on the other arm".
  // Taken literally that is unsatisfiable against the plan's OWN prescribed
  // detail strings: the id arm deliberately ends "…the served body was not the
  // problem", which contains the substring "served body" — and that clause is
  // the whole point of the arm, so the strings are right and the criterion's
  // wording is what is imprecise. Resolved by asserting the distinction where it
  // is actually unambiguous: the two `unavailableLabel`s (which are what the
  // operator reads on the chip) are mutually exclusive, and the detail needle is
  // narrowed to the accusatory clause "served body does not conform" rather than
  // the bare noun phrase. Still falsifiable by string comparison, no judgement.
  it('the body-schema arm and the requested-id arm never share their wording', async () => {
    const bodyArm = await verifyCtxIdBinding(without(BASE, 'signature'), BASE.ctx_id);
    const idArm = await verifyCtxIdBinding(BASE, 'not-a-ctx-id');

    expect(bodyArm.detail).toContain('served body');
    expect(bodyArm.detail).not.toContain('requested ctx_id');
    expect(bodyArm.unavailableLabel).toBe('body not parseable');

    expect(idArm.detail).toContain('requested ctx_id');
    expect(idArm.detail).not.toContain('served body does not conform');
    expect(idArm.unavailableLabel).toBe('requested id malformed');

    // …and the id arm's claim that "the served body was not the problem" is
    // true of THAT EXACT BODY: it verifies cleanly under its own ctx_id.
    expect((await verifyCtxIdBinding(BASE, BASE.ctx_id)).status).toBe('verified');
  });

  // Upstream parses the BODY before the ID, so when both inputs are bad the
  // body arm wins. That ordering is what makes the id arm's sentence — "the
  // served body was not the problem" — truthful instead of a false exoneration
  // of a registry that served an unparseable body.
  //
  // Nothing else in this suite pins it: every other case has exactly one bad
  // input. If upstream ever swaps those two lines (and "validate the caller's
  // own input first" is a perfectly natural refactor), this console would start
  // telling operators the body was fine when it was not — and every other
  // assertion here would stay green. This is the test that reddens instead.
  it('with BOTH inputs bad, the body arm wins — the id arm must never exonerate an unparseable body', async () => {
    const verdict = await verifyCtxIdBinding(without(BASE, 'signature'), 'not-a-ctx-id');
    expect(verdict.status).toBe('unavailable');
    expect(verdict.unavailableLabel).toBe('body not parseable');
    expect(verdict.detail).not.toContain('the served body was not the problem');
  });

  // A malformed ctx_id in the SERVED BODY is a different thing from a malformed
  // requested id, and it must stay RED: that is the registry's own data being
  // wrong, not a check that could not run. Asserted because the could-not-check
  // mapping sits right next to it and a careless widening would swallow it.
  it('a malformed ctx_id in the served body stays `failed`, not `unavailable`', async () => {
    const verdict = await verifyCtxIdBinding({ ...BASE, ctx_id: 'not-an-acdp-id' }, BASE.ctx_id);
    expect(verdict.status).toBe('failed');
    expect(verdict.unavailableLabel).toBeUndefined();
  });
});
