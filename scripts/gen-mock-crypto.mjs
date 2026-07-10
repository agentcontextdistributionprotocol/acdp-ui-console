// ══════════════════════════════════════════════════════════════════════
// Deterministic generator for the demo's REAL cryptographic material.
//
// Everything the console renders a *green* client-side verdict for in demo
// mode is minted here with actual keys and actual signatures, then
// self-verified through the SAME `@agentcontextdistributionprotocol/acdp-wasm`
// verifier the browser uses. If any surface fails to verify, this script
// throws and refuses to emit — so `lib/data/mock-crypto.ts` can never drift
// into a fake-green state.
//
//   node scripts/gen-mock-crypto.mjs        # regenerate lib/data/mock-crypto.ts
//
// The wasm is a *verifier*, not a signer (no producer/registry key material
// lives in it), so signing is done here with Node's `crypto` over the exact
// ACDP preimages (RFC-ACDP-0001 §5.7 / §5.8; RFC-ACDP-0010/0011/0012/0015):
//   preimage = ASCII "sha256:<hex>" where hex = SHA-256(JCS(object − signature))
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import init, * as acdp from '@agentcontextdistributionprotocol/acdp-wasm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
await init({
  module_or_path: readFileSync(
    path.join(ROOT, 'node_modules/@agentcontextdistributionprotocol/acdp-wasm/acdp_wasm_bg.wasm'),
  ),
});

// ── low-level helpers ─────────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58btc(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}
const b64 = (buf) => Buffer.from(buf).toString('base64');
const b64urlToBuf = (s) => Buffer.from(s, 'base64url');

/** RFC 8785 JCS for the (string/int/array/object) shapes ACDP signs. */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const sha256Hex = (str) => createHash('sha256').update(str, 'utf8').digest('hex');
/** ACDP preimage hash of an object MINUS its `signature` member. */
function preimageHash(objWithoutSig) {
  return 'sha256:' + sha256Hex(jcs(objWithoutSig));
}

// ── Ed25519 identity from a fixed 32-byte seed ────────────────────────
const ED_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function ed25519FromSeed(seedHex) {
  const seed = Buffer.from(seedHex, 'hex');
  const priv = createPrivateKey({ key: Buffer.concat([ED_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const pubJwk = createPublicKey(priv).export({ format: 'jwk' });
  const rawPub = b64urlToBuf(pubJwk.x); // 32 bytes
  const multibase = 'z' + base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), rawPub]));
  return {
    algorithm: 'ed25519',
    seedHex,
    priv,
    rawPubB64: b64(rawPub),
    multibase,
    didKey: 'did:key:' + multibase,
    signAscii: (msg) => b64(nodeSign(null, Buffer.from(msg, 'utf8'), priv)),
  };
}

// ── P-256 identity (random key; ECDSA is non-deterministic but verifies) ─
function p256Identity() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const sec1 = Buffer.concat([Buffer.from([0x04]), b64urlToBuf(jwk.x), b64urlToBuf(jwk.y)]);
  return {
    algorithm: 'ecdsa-p256',
    jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    sec1B64: b64(sec1),
    signAscii: (msg) =>
      b64(nodeSign('sha256', Buffer.from(msg, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' })),
  };
}

// ── content_hash (RFC-ACDP-0001 §5.7): recompute via the wasm's own JCS ─
function contentHashOf(body) {
  const preimage = acdp.canonicalPreimage(JSON.stringify(body));
  return 'sha256:' + sha256Hex(preimage);
}

// ── DID-document builder (did:web) ────────────────────────────────────
function didWebDoc(did, fragment, identity) {
  const vmId = `${did}#${fragment}`;
  const method =
    identity.algorithm === 'ed25519'
      ? { id: vmId, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: identity.multibase }
      : { id: vmId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: identity.jwk };
  return { id: did, verificationMethod: [method], assertionMethod: [vmId] };
}

const assertOk = (label, verdictJson) => {
  const v = JSON.parse(verdictJson);
  if (!v.valid) throw new Error(`self-verify FAILED for ${label}: ${verdictJson}`);
  return v;
};

// ══════════════════════════════════════════════════════════════════════
// Identities (fixed seeds → deterministic keys/DIDs)
// ══════════════════════════════════════════════════════════════════════
const AUTH_A = 'registry-a.playground.local';
const AUTH_B = 'registry-b.playground.local';
const REGISTRY_A_DID = `did:web:${AUTH_A}`;
const WEB_A = 'did:web:registry-a.local:agents:cross-a';
const WEB_B = 'did:web:registry-b.local:agents:cross-b';
const WEB_SOLO = 'did:web:registry-a.local:agents:solo';
const WITNESS_ALPHA = 'did:web:witness-alpha.trust.example';

const registryA = ed25519FromSeed('99'.repeat(32));
const prodA = ed25519FromSeed('22'.repeat(32));
const prodSolo = ed25519FromSeed('33'.repeat(32));
const prodKey = ed25519FromSeed('44'.repeat(32)); // did:key producer
const witnessAlpha = ed25519FromSeed('55'.repeat(32));
const witnessBeta = ed25519FromSeed('66'.repeat(32)); // did:key witness
const prodB = p256Identity();

// Fixed timestamps for signed/hashed fields (kept stable so signatures hold).
const T = {
  arcticExpires: '2026-08-01T00:00:00.000Z',
  arcticStart: '2026-03-01T00:00:00.000Z',
  arcticEnd: '2026-07-01T00:00:00.000Z',
  cashStart: '2026-04-01T00:00:00.000Z',
  cashEnd: '2026-07-01T00:00:00.000Z',
  receiptCreated: '2026-07-06T12:00:00.000Z',
  asOf: '2026-07-06T12:34:00.000Z',
  checkpoint: '2026-07-06T12:34:00.000Z',
  witnessedAlpha: '2026-07-06T12:35:00.000Z',
  witnessedBeta: '2026-07-06T12:33:00.000Z',
};

// ── ctx identity strings (excluded from content_hash; reused from mock) ─
const CTX_ARCTIC_SRC = `acdp://${AUTH_A}/f4a2c9e1-1d2b-4a3c-9e8f-001`;
const CTX_ARCTIC_DERIV = `acdp://${AUTH_B}/9c11a7f2-7b6c-4d5e-8a9b-002`;
const CTX_CASH_V1 = `acdp://${AUTH_A}/2e78f01a-solo`;
const CTX_CASH_V2 = `acdp://${AUTH_A}/2e78f01a-solo-v2`;
const CTX_ATTESTED = `acdp://${AUTH_A}/attested-001`;
// RFC-ACDP-0001 §5: lineage_id is a 'lin:sha256:<hex>' identifier. The other
// demo lineages use a loose label form that only the strict LHR parser rejects;
// the attested context (the one with a lineage-head receipt) uses the real form.
const LIN_ATTESTED = 'lin:sha256:' + sha256Hex('acdp-demo-lineage-attested-001');

// ══════════════════════════════════════════════════════════════════════
// 1. Producer bodies — content_hash + producer signature
// ══════════════════════════════════════════════════════════════════════

/** Build a body, compute its real content_hash, sign it, self-verify. */
function makeBody({ ctx_id, lineage_id, origin_registry, created_at, producer, keyFragment, hashed }) {
  const body = {
    ctx_id,
    lineage_id,
    origin_registry,
    created_at,
    ...hashed,
  };
  const content_hash = contentHashOf(body);
  // did:web producers pass a `keyFragment` (+ `did`); a did:key producer does not
  // — its key_id is the multibase under its own did:key identifier.
  const keyId =
    keyFragment !== undefined ? `${producer.did}#${keyFragment}` : `${producer.didKey}#${producer.multibase}`;
  const signature = { algorithm: producer.algorithm, key_id: keyId, value: producer.signAscii(content_hash) };
  const full = { ...body, content_hash, signature };
  // self-verify content_hash
  assertOk(`content_hash ${ctx_id}`, acdp.verifyContentHash(JSON.stringify(full), content_hash));
  // self-verify producer signature
  const sigVerdict =
    producer.algorithm === 'ed25519'
      ? acdp.verifySignatureEd25519(producer.rawPubB64, signature.value, content_hash)
      : acdp.verifySignatureP256(producer.sec1B64, signature.value, content_hash);
  assertOk(`producer signature ${ctx_id}`, sigVerdict);
  return { hashed, content_hash, signature };
}

const arcticSrc = makeBody({
  ctx_id: CTX_ARCTIC_SRC,
  lineage_id: 'lin-arctic-001',
  origin_registry: AUTH_A,
  created_at: '2026-07-06T11:59:00.000Z',
  producer: { ...prodA, did: WEB_A },
  keyFragment: 'key-1',
  hashed: {
    version: 1,
    agent_id: WEB_A,
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
    supersedes: null,
    contributors: [WEB_A],
    data_refs: [
      { type: 'data_snapshot', location: 's3://acdp-demo/arctic/ais-2024.parquet', encoding: 'application/parquet' },
    ],
    data_period: { start: T.arcticStart, end: T.arcticEnd },
    expires_at: T.arcticExpires,
    schema_uri: 'https://schemas.acdp.dev/data_snapshot/v1.json',
  },
});

const arcticDeriv = makeBody({
  ctx_id: CTX_ARCTIC_DERIV,
  lineage_id: 'lin-arctic-002',
  origin_registry: AUTH_B,
  created_at: '2026-07-06T12:30:00.000Z',
  producer: { ...prodB, did: WEB_B },
  keyFragment: 'key-2',
  hashed: {
    version: 1,
    agent_id: WEB_B,
    title: 'Cross-registry derivative — Arctic investment analysis',
    type: 'analysis',
    visibility: 'public',
    derived_from: [CTX_ARCTIC_SRC],
    summary: 'Investment implications derived from the Arctic shipping snapshot.',
    description: 'Risk-weighted investment thesis across shipping, insurance, and port-infrastructure equities.',
    tags: ['investment', 'analysis'],
    domain: 'finance',
    acdp_version: '0.1.0',
    supersedes: null,
    contributors: [WEB_B, WEB_A],
    audience: [WEB_A],
    data_refs: [
      { type: 'report', location: 'https://reports.acdp-demo/arctic-investment.pdf', encoding: 'application/pdf' },
    ],
    schema_uri: 'https://schemas.acdp.dev/analysis/v1.json',
  },
});

const cashHashed = {
  version: 1,
  agent_id: WEB_SOLO,
  title: 'Quarterly cash flow snapshot',
  type: 'data_snapshot',
  visibility: 'public',
  derived_from: [],
  summary: 'Snapshot of quarterly operating cash flow figures.',
  description: 'Operating, investing, and financing cash flows for the trailing quarter.',
  tags: ['finance'],
  domain: 'finance',
  acdp_version: '0.1.0',
  supersedes: null,
  contributors: [WEB_SOLO],
  data_refs: [
    { type: 'data_snapshot', location: 's3://acdp-demo/finance/cashflow-q.json', encoding: 'application/json' },
  ],
  data_period: { start: T.cashStart, end: T.cashEnd },
};
const cashV1 = makeBody({
  ctx_id: CTX_CASH_V1,
  lineage_id: 'lin-cashflow-001',
  origin_registry: AUTH_A,
  created_at: '2026-07-06T09:00:00.000Z',
  producer: { ...prodSolo, did: WEB_SOLO },
  keyFragment: 'key-1',
  hashed: cashHashed,
});
const cashV2 = makeBody({
  ctx_id: CTX_CASH_V2,
  lineage_id: 'lin-cashflow-001',
  origin_registry: AUTH_A,
  created_at: '2026-07-05T12:00:00.000Z',
  producer: { ...prodSolo, did: WEB_SOLO },
  keyFragment: 'key-1',
  hashed: {
    ...cashHashed,
    version: 2,
    supersedes: CTX_CASH_V1,
    title: 'Quarterly cash flow snapshot (revised)',
    summary: 'Revised quarterly operating cash flow figures after reconciliation.',
  },
});

const attestedHashed = {
  version: 1,
  agent_id: prodKey.didKey,
  title: 'Attested disclosure — did:key ephemeral agent',
  type: 'attestation',
  visibility: 'public',
  derived_from: [],
  summary: 'Offline-verifiable disclosure published by an ephemeral did:key agent to the receipts registry.',
  description:
    'Demonstrates the RFC-ACDP-0010 receipts profile: the producer key is embedded in the did:key identifier and pinned by the registry receipt.',
  tags: ['attestation', 'did:key'],
  domain: 'compliance',
  acdp_version: '0.2.0',
  supersedes: null,
  contributors: [prodKey.didKey],
};
const attested = makeBody({
  ctx_id: CTX_ATTESTED,
  lineage_id: LIN_ATTESTED,
  origin_registry: AUTH_A,
  created_at: '2026-07-06T11:57:00.000Z',
  producer: prodKey,
  hashed: attestedHashed,
});

// ══════════════════════════════════════════════════════════════════════
// 2. Registry receipts (RFC-ACDP-0010)
// ══════════════════════════════════════════════════════════════════════
function makeReceipt({ ctx_id, lineage_id, origin_registry, content_hash, producerRawPubB64, registry, registryDid }) {
  const key_fingerprint = acdp.fingerprintEd25519(producerRawPubB64);
  const unsigned = {
    registry_did: registryDid,
    ctx_id,
    lineage_id,
    origin_registry,
    created_at: T.receiptCreated,
    content_hash,
    key_fingerprint,
  };
  const hash = preimageHash(unsigned);
  const receipt = {
    ...unsigned,
    signature: { algorithm: 'ed25519', key_id: `${registryDid}#receipt-key-1`, value: registry.signAscii(hash) },
  };
  assertOk(
    `receipt ${ctx_id}`,
    acdp.verifyReceipt(JSON.stringify(receipt), registry.rawPubB64, ctx_id, content_hash, key_fingerprint),
  );
  return receipt;
}
const arcticReceipt = makeReceipt({
  ctx_id: CTX_ARCTIC_SRC,
  lineage_id: 'lin-arctic-001',
  origin_registry: AUTH_A,
  content_hash: arcticSrc.content_hash,
  producerRawPubB64: prodA.rawPubB64,
  registry: registryA,
  registryDid: REGISTRY_A_DID,
});
const attestedReceipt = makeReceipt({
  ctx_id: CTX_ATTESTED,
  lineage_id: LIN_ATTESTED,
  origin_registry: AUTH_A,
  content_hash: attested.content_hash,
  producerRawPubB64: prodKey.rawPubB64,
  registry: registryA,
  registryDid: REGISTRY_A_DID,
});

// ══════════════════════════════════════════════════════════════════════
// 3. Lineage-head receipt (RFC-ACDP-0011)
// ══════════════════════════════════════════════════════════════════════
const lhrUnsigned = {
  receipt_version: 'acdp-lhr/1',
  registry_did: REGISTRY_A_DID,
  lineage_id: LIN_ATTESTED,
  head_ctx_id: CTX_ATTESTED,
  head_version: 1,
  head_status: 'active',
  as_of: T.asOf,
};
const lineageHeadReceipt = {
  ...lhrUnsigned,
  signature: { algorithm: 'ed25519', key_id: `${REGISTRY_A_DID}#receipt-key-1`, value: registryA.signAscii(preimageHash(lhrUnsigned)) },
};
{
  const expected = { registry_did: REGISTRY_A_DID, lineage_id: LIN_ATTESTED, head_ctx_id: CTX_ATTESTED, head_version: 1, head_status: 'active' };
  const doc = didWebDoc(REGISTRY_A_DID, 'receipt-key-1', registryA);
  assertOk(
    'lineage_head_receipt',
    // pass a generous max_age so the fixed timestamp is not flagged invalid (staleness is a separate flag)
    acdp.verifyLineageHeadReceipt(
      JSON.stringify(lineageHeadReceipt),
      JSON.stringify(expected),
      JSON.stringify(doc),
      T.asOf,
      300n,
      315360000n,
    ),
  );
}

// ══════════════════════════════════════════════════════════════════════
// 4. Transparency log — checkpoint + inclusion proof (RFC-ACDP-0012)
// ══════════════════════════════════════════════════════════════════════
const LOG_ID = `${REGISTRY_A_DID}/log/receipts`;

// §9.1 step 1: the leaf is rebuilt from the VERIFIED receipt.
const reconstructedLeaf = acdp.buildLogLeaf(JSON.stringify(attestedReceipt));
const ourLeafHash = acdp.merkleLeafHash(reconstructedLeaf);

// Build a real 6-leaf RFC 6962 tree with our leaf at index 2.
const TREE_SIZE = 6;
const LEAF_INDEX = 2;
const leafHashes = [];
for (let i = 0; i < TREE_SIZE; i++) {
  leafHashes.push(i === LEAF_INDEX ? ourLeafHash : 'sha256:' + sha256Hex(`filler-leaf-${i}`));
}
const mth = (hashes) => acdp.merkleRootHash(JSON.stringify(hashes));
// RFC 6962 audit path for leaf m in D[0:n].
function auditPath(m, lo, hi) {
  const n = hi - lo;
  if (n <= 1) return [];
  let k = 1;
  while (k << 1 < n) k <<= 1;
  if (m - lo < k) return [...auditPath(m, lo, lo + k), mth(leafHashes.slice(lo + k, hi))];
  return [...auditPath(m, lo + k, hi), mth(leafHashes.slice(lo, lo + k))];
}
const rootHash = mth(leafHashes);
const inclusionPath = auditPath(LEAF_INDEX, 0, TREE_SIZE);

const checkpointUnsigned = {
  checkpoint_version: 'acdp-log/1',
  log_id: LOG_ID,
  tree_size: TREE_SIZE,
  root_hash: rootHash,
  timestamp: T.checkpoint,
};
const logCheckpoint = {
  ...checkpointUnsigned,
  signature: { algorithm: 'ed25519', key_id: `${REGISTRY_A_DID}#receipt-key-1`, value: registryA.signAscii(preimageHash(checkpointUnsigned)) },
};
const registryDoc = didWebDoc(REGISTRY_A_DID, 'receipt-key-1', registryA);
assertOk(
  'log_checkpoint',
  acdp.verifyLogCheckpoint(JSON.stringify(logCheckpoint), JSON.stringify(registryDoc), LOG_ID, T.checkpoint, 300n),
);

const logInclusion = {
  log_id: LOG_ID,
  leaf_index: LEAF_INDEX,
  tree_size: TREE_SIZE,
  inclusion_path: inclusionPath,
  log_checkpoint: logCheckpoint,
};
assertOk(
  'log_inclusion',
  acdp.verifyLogInclusion(JSON.stringify(logInclusion), JSON.stringify(logCheckpoint), reconstructedLeaf),
);

// ══════════════════════════════════════════════════════════════════════
// 5. Witness cosignatures + quorum (RFC-ACDP-0015)
// ══════════════════════════════════════════════════════════════════════
const witnessedCheckpoint = { log_id: LOG_ID, tree_size: TREE_SIZE, root_hash: rootHash, timestamp: T.checkpoint };
const cosigAlpha = JSON.parse(
  acdp.buildWitnessCosignature(JSON.stringify(witnessedCheckpoint), WITNESS_ALPHA, witnessAlpha.seedHex, T.witnessedAlpha),
);
const cosigBeta = JSON.parse(
  acdp.buildWitnessCosignature(JSON.stringify(witnessedCheckpoint), witnessBeta.didKey, witnessBeta.seedHex, T.witnessedBeta),
);
const alphaFragment = cosigAlpha.signature.key_id.split('#')[1];
const witnessAlphaDoc = didWebDoc(WITNESS_ALPHA, alphaFragment, witnessAlpha);
// A did:key witness needs a synthesized document whose id == witness_id and
// whose verificationMethod #fragment matches the cosignature's key_id fragment.
const betaFragment = cosigBeta.signature.key_id.split('#')[1];
const witnessBetaDoc = {
  id: witnessBeta.didKey,
  verificationMethod: [
    { id: cosigBeta.signature.key_id, type: 'Ed25519VerificationKey2020', controller: witnessBeta.didKey, publicKeyMultibase: witnessBeta.multibase },
  ],
  assertionMethod: [cosigBeta.signature.key_id],
};
void betaFragment;

// self-verify each cosignature + the §8 quorum report
assertOk(
  'witness cosig alpha',
  acdp.verifyWitnessCosignature(JSON.stringify(cosigAlpha), JSON.stringify(witnessAlphaDoc), JSON.stringify(logCheckpoint), T.checkpoint, 300n),
);
assertOk(
  'witness cosig beta',
  acdp.verifyWitnessCosignature(JSON.stringify(cosigBeta), JSON.stringify(witnessBetaDoc), JSON.stringify(logCheckpoint), T.checkpoint, 300n),
);
{
  const report = JSON.parse(
    acdp.evaluateWitnessQuorum(
      JSON.stringify([cosigAlpha, cosigBeta]),
      JSON.stringify(logCheckpoint),
      JSON.stringify([WITNESS_ALPHA, witnessBeta.didKey]),
      JSON.stringify({ [WITNESS_ALPHA]: witnessAlphaDoc, [witnessBeta.didKey]: witnessBetaDoc }),
      JSON.stringify({ min_witnesses: 2, max_age_secs: null }),
      T.checkpoint,
    ),
  );
  if (!report.meets_quorum || report.witnessed_count !== 2) {
    throw new Error('self-verify FAILED for witness quorum: ' + JSON.stringify(report));
  }
}

// ══════════════════════════════════════════════════════════════════════
// 6. DID documents the console supplies in demo mode (did:web only).
// ══════════════════════════════════════════════════════════════════════
const didDocs = {
  [WEB_A]: didWebDoc(WEB_A, 'key-1', prodA),
  [WEB_B]: didWebDoc(WEB_B, 'key-2', prodB),
  [WEB_SOLO]: didWebDoc(WEB_SOLO, 'key-1', prodSolo),
  [REGISTRY_A_DID]: didWebDoc(REGISTRY_A_DID, 'receipt-key-1', registryA),
  [WITNESS_ALPHA]: witnessAlphaDoc,
};

// ══════════════════════════════════════════════════════════════════════
// Emit lib/data/mock-crypto.ts
// ══════════════════════════════════════════════════════════════════════
const out = {
  DID_KEY_PRODUCER: prodKey.didKey,
  WITNESS_BETA_DID: witnessBeta.didKey,
  LIN_ATTESTED,
  MOCK_DID_DOCS: didDocs,
  arcticSource: { hashed: arcticSrc.hashed, content_hash: arcticSrc.content_hash, signature: arcticSrc.signature, registry_receipt: arcticReceipt },
  arcticDeriv: { hashed: arcticDeriv.hashed, content_hash: arcticDeriv.content_hash, signature: arcticDeriv.signature },
  cashV1: { hashed: cashV1.hashed, content_hash: cashV1.content_hash, signature: cashV1.signature },
  cashV2: { hashed: cashV2.hashed, content_hash: cashV2.content_hash, signature: cashV2.signature },
  attested: {
    hashed: attested.hashed,
    content_hash: attested.content_hash,
    signature: attested.signature,
    registry_receipt: attestedReceipt,
    lineage_head_receipt: lineageHeadReceipt,
    log_inclusion: { ...logInclusion, witness_signatures: [cosigAlpha, cosigBeta] },
  },
};

const banner = `// ══════════════════════════════════════════════════════════════════════
// GENERATED by scripts/gen-mock-crypto.mjs — DO NOT EDIT BY HAND.
//
// Real ACDP cryptographic material for the demo dataset: every content_hash,
// producer signature, registry receipt, lineage-head receipt, transparency-log
// checkpoint + inclusion proof, and witness cosignature below was minted with
// actual Ed25519 / ECDSA-P256 keys and SELF-VERIFIED through the same
// @agentcontextdistributionprotocol/acdp-wasm verifier the browser runs. The
// generator throws if any surface fails to verify, so these values are known-good.
//
// Regenerate:  node scripts/gen-mock-crypto.mjs
// ══════════════════════════════════════════════════════════════════════
`;

const body = `${banner}
export const DID_KEY_PRODUCER = ${JSON.stringify(out.DID_KEY_PRODUCER)};
export const WITNESS_BETA_DID = ${JSON.stringify(out.WITNESS_BETA_DID)};
export const LIN_ATTESTED = ${JSON.stringify(out.LIN_ATTESTED)};

/** did:web DID documents the console resolves offline in demo mode. */
export const MOCK_DID_DOCS: Record<string, unknown> = ${JSON.stringify(out.MOCK_DID_DOCS, null, 2)};

/** Per-context crypto material (hashed body fields + signatures + trust proofs). */
export const MOCK_CRYPTO = ${JSON.stringify(
  {
    arcticSource: out.arcticSource,
    arcticDeriv: out.arcticDeriv,
    cashV1: out.cashV1,
    cashV2: out.cashV2,
    attested: out.attested,
  },
  null,
  2,
)};
`;

writeFileSync(path.join(ROOT, 'lib/data/mock-crypto.ts'), body);
console.log('OK — all surfaces self-verified. Wrote lib/data/mock-crypto.ts');
console.log('did:key producer =', out.DID_KEY_PRODUCER);
console.log('did:key witness  =', out.WITNESS_BETA_DID);
