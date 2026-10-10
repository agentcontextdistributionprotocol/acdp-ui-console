// @vitest-environment node
// ══════════════════════════════════════════════════════════════════════
// Exact-DID keying of the live registry DID-document map, over the REAL wasm.
//
// Real mode hands `useContextVerdicts` a map holding ONLY the issuing
// registry's own document, keyed by its exact DID. This drives `verify.ts`
// over the attested demo context with exactly that map and asserts which
// surfaces turn green and which stay amber:
//   - registry-signed surfaces that need only the registry key (lineage-head
//     receipt, transparency-log checkpoint) verify;
//   - a did:web producer signature stays `unavailable`;
//   - for that did:web producer the registry receipt stays `unavailable` too
//     (it needs the PRODUCER key to recompute the fingerprint, verify.ts
//     `verifyRegistryReceipt`); for a did:key producer it verifies;
//   - a producer DID on the registry's own host (`<registry did>:agents:x`)
//     is not matched by the registry's entry.
//
// Same loader-only mock as `wasm-fixtures.test.ts` (which this file does not
// touch): the binary is real, only `getAcdpWasm()` is swapped.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init from '@agentcontextdistributionprotocol/acdp-wasm';
import { MOCK_CAPABILITIES, MOCK_CONTEXTS, MOCK_DID_DOCS } from '@/lib/data/mock-data';
import { acceptRegistryDidDocument } from '@/lib/verify/did-docs';
import { resolveDidDocument } from '@/lib/verify/resolve';
import {
  verifyLineageHeadReceipt,
  verifyProducerSignature,
  verifyRegistryReceipt,
  verifyTransparencyLog,
} from '@/lib/verify/verify';

vi.mock('@/lib/verify/wasm', () => ({
  getAcdpWasm: async () => await import('@agentcontextdistributionprotocol/acdp-wasm'),
}));

const caps = MOCK_CAPABILITIES.a;
const REGISTRY_DID = caps.registry_did;
const accepted = acceptRegistryDidDocument(MOCK_DID_DOCS[REGISTRY_DID], {
  authority: caps.authority,
  registryDid: caps.registry_did,
  ctxAuthority: caps.authority,
});
// What `useRegistryDidDocs` returns in real mode for a registry-a context.
const LIVE_MAP: Record<string, unknown> = { [REGISTRY_DID]: accepted };

// did:key producer, with receipt + head receipt + log inclusion.
const ATTESTED = MOCK_CONTEXTS.find((c) => c.registry_receipt && c.lineage_head_receipt && c.log_inclusion)!;
// did:web producer (on another host), with a registry receipt.
const DIDWEB = MOCK_CONTEXTS.find((c) => c.registry_receipt && c.body.signature?.key_id.startsWith('did:web:'))!;

beforeAll(async () => {
  const wasmPath = createRequire(import.meta.url).resolve('@agentcontextdistributionprotocol/acdp-wasm/acdp_wasm_bg.wasm');
  await init({ module_or_path: readFileSync(wasmPath) });
});

describe('live registry DID map — exact-DID keying', () => {
  it('the fixtures under test are registry-a contexts (one did:key, one did:web producer)', () => {
    expect(accepted).not.toBeNull();
    for (const c of [ATTESTED, DIDWEB]) {
      expect(c).toBeDefined();
      expect(c.body.ctx_id.startsWith(`acdp://${caps.authority}/`)).toBe(true);
      expect(c.registry_receipt!.signature.key_id.split('#')[0]).toBe(REGISTRY_DID);
    }
    expect(ATTESTED.body.signature?.key_id.startsWith('did:key:')).toBe(true);
    expect(MOCK_DID_DOCS[DIDWEB.body.signature!.key_id.split('#')[0]]).toBeDefined();
  });

  it('a producer DID on the registry host is not matched by the registry entry', () => {
    expect(resolveDidDocument(`${REGISTRY_DID}:agents:x`, LIVE_MAP)).toBeNull();
    expect(resolveDidDocument(REGISTRY_DID, LIVE_MAP)).toBe(accepted);
  });

  it('the did:web producer signature stays unavailable', async () => {
    const v = await verifyProducerSignature(DIDWEB.body, LIVE_MAP);
    expect(v.status).toBe('unavailable');
    // …and verifies once the producer's own document is on hand (demo map),
    // so the amber above is the missing document, not a broken fixture.
    expect((await verifyProducerSignature(DIDWEB.body, MOCK_DID_DOCS)).status).toBe('verified');
  });

  it('the registry receipt stays unavailable for a did:web producer — it needs the producer key', async () => {
    const v = await verifyRegistryReceipt(DIDWEB.registry_receipt!, DIDWEB.body, LIVE_MAP);
    expect(v.status).toBe('unavailable');
    expect(v.detail).toContain('producer key not on hand');
    expect((await verifyRegistryReceipt(DIDWEB.registry_receipt!, DIDWEB.body, MOCK_DID_DOCS)).status).toBe('verified');
  });

  it('the registry receipt verifies for a did:key producer with only the live registry document', async () => {
    const v = await verifyRegistryReceipt(ATTESTED.registry_receipt!, ATTESTED.body, LIVE_MAP);
    expect(v.status).toBe('verified');
  });

  it('registry-key-only surfaces verify against the live registry document', async () => {
    const lhr = await verifyLineageHeadReceipt(
      ATTESTED.lineage_head_receipt!,
      ATTESTED.body,
      ATTESTED.registry_state.status,
      LIVE_MAP,
    );
    expect(lhr.status).toBe('verified');
    const log = await verifyTransparencyLog(ATTESTED.log_inclusion!, ATTESTED.registry_receipt, LIVE_MAP);
    expect(log.status).toBe('verified');
  });

  it('with no map at all (registry 404) those surfaces are unavailable, not failed', async () => {
    const lhr = await verifyLineageHeadReceipt(
      ATTESTED.lineage_head_receipt!,
      ATTESTED.body,
      ATTESTED.registry_state.status,
      undefined,
    );
    expect(lhr.status).toBe('unavailable');
  });
});
