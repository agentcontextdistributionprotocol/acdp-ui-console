// ══════════════════════════════════════════════════════════════════════
// `acceptRegistryDidDocument` — the gate between a registry-controlled
// `/.well-known/did.json` body and the wasm verifier. A document is accepted
// only when its id, the registry's advertised DID, `did:web:<advertised
// authority>`, and the ctx_id's authority all agree; every other shape is null.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { acceptRegistryDidDocument, authorityToDidWeb, MAX_VERIFICATION_METHODS } from '@/lib/verify/did-docs';
import { MOCK_CAPABILITIES, MOCK_DID_DOCS } from '@/lib/data/mock-data';

const AUTH = 'registry-a.playground.local';
const DID = `did:web:${AUTH}`;

function vm(id = `${DID}#receipt-key-1`, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'Ed25519VerificationKey2020',
    controller: DID,
    publicKeyMultibase: 'z6Mkhu4BLQGcYCtgBVYdM7TgYcGyg6TXqGcnbpdY8ufABFsz',
    ...extra,
  };
}

function goodDoc(overrides: Record<string, unknown> = {}) {
  return { id: DID, verificationMethod: [vm()], assertionMethod: [`${DID}#receipt-key-1`], ...overrides };
}

const EXPECTED = { authority: AUTH, registryDid: DID, ctxAuthority: AUTH };

describe('authorityToDidWeb', () => {
  it('maps a bare host and percent-encodes a port colon', () => {
    expect(authorityToDidWeb('registry.example.com')).toBe('did:web:registry.example.com');
    expect(authorityToDidWeb('localhost:8100')).toBe('did:web:localhost%3A8100');
  });
});

describe('acceptRegistryDidDocument', () => {
  it('accepts a well-formed registry document and returns the same object', () => {
    const doc = goodDoc();
    expect(acceptRegistryDidDocument(doc, EXPECTED)).toBe(doc);
  });

  it('accepts the bundled demo registry document against the demo capabilities', () => {
    const caps = MOCK_CAPABILITIES.a;
    const doc = MOCK_DID_DOCS[caps.registry_did];
    expect(
      acceptRegistryDidDocument(doc, { authority: caps.authority, registryDid: caps.registry_did, ctxAuthority: caps.authority }),
    ).toBe(doc);
  });

  it('accepts a JWK-encoded verification method', () => {
    const { publicKeyMultibase: _drop, ...rest } = vm();
    void _drop;
    const doc = goodDoc({ verificationMethod: [{ ...rest, publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'AA' } }] });
    expect(acceptRegistryDidDocument(doc, EXPECTED)).toBe(doc);
  });

  it('accepts a ported authority only with the %3A encoding', () => {
    const auth = 'localhost:8100';
    const did = 'did:web:localhost%3A8100';
    const doc = {
      id: did,
      verificationMethod: [{ ...vm(`${did}#k`), controller: did }],
    };
    expect(acceptRegistryDidDocument(doc, { authority: auth, registryDid: did, ctxAuthority: auth })).toBe(doc);
    // The unencoded spelling is not did:web for that authority.
    const raw = { id: 'did:web:localhost:8100', verificationMethod: [{ ...vm('did:web:localhost:8100#k'), controller: 'did:web:localhost:8100' }] };
    expect(
      acceptRegistryDidDocument(raw, { authority: auth, registryDid: 'did:web:localhost:8100', ctxAuthority: auth }),
    ).toBeNull();
  });

  it('null when the document id is not the registry DID', () => {
    expect(acceptRegistryDidDocument(goodDoc({ id: 'did:web:evil.example' }), EXPECTED)).toBeNull();
    // A producer DID on the same host is not the registry's own DID.
    expect(acceptRegistryDidDocument(goodDoc({ id: `${DID}:agents:x` }), EXPECTED)).toBeNull();
  });

  it('null when the advertised registry_did disagrees with did:web:<authority>', () => {
    expect(acceptRegistryDidDocument(goodDoc(), { ...EXPECTED, registryDid: 'did:web:other.example' })).toBeNull();
    expect(acceptRegistryDidDocument(goodDoc(), { ...EXPECTED, registryDid: '' })).toBeNull();
  });

  it('null when the ctx_id authority is not the registry authority', () => {
    expect(acceptRegistryDidDocument(goodDoc(), { ...EXPECTED, ctxAuthority: 'registry-b.playground.local' })).toBeNull();
    expect(acceptRegistryDidDocument(goodDoc(), { ...EXPECTED, ctxAuthority: '' })).toBeNull();
  });

  it('null when the port differs', () => {
    const did = 'did:web:localhost%3A8100';
    const doc = { id: did, verificationMethod: [{ ...vm(`${did}#k`), controller: did }] };
    expect(
      acceptRegistryDidDocument(doc, { authority: 'localhost:8200', registryDid: 'did:web:localhost%3A8200', ctxAuthority: 'localhost:8200' }),
    ).toBeNull();
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', [goodDoc()]],
    ['a string', JSON.stringify(goodDoc())],
    ['no verificationMethod', { id: DID }],
    ['an empty verificationMethod', goodDoc({ verificationMethod: [] })],
    ['a non-array verificationMethod', goodDoc({ verificationMethod: vm() })],
    ['a method for another DID', goodDoc({ verificationMethod: [vm('did:web:evil.example#k')] })],
    ['a method with an empty fragment', goodDoc({ verificationMethod: [vm(`${DID}#`)] })],
    ['a method with a foreign controller', goodDoc({ verificationMethod: [vm(undefined, { controller: 'did:web:evil.example' })] })],
    ['a method with no key', goodDoc({ verificationMethod: [vm(undefined, { publicKeyMultibase: undefined })] })],
    ['a method with two keys', goodDoc({ verificationMethod: [vm(undefined, { publicKeyJwk: { kty: 'OKP' } })] })],
    ['a method with no type', goodDoc({ verificationMethod: [vm(undefined, { type: '' })] })],
    ['a non-array assertionMethod', goodDoc({ assertionMethod: `${DID}#receipt-key-1` })],
    ['a foreign assertionMethod ref', goodDoc({ assertionMethod: ['did:web:evil.example#k'] })],
    [
      'too many verification methods',
      goodDoc({ verificationMethod: Array.from({ length: MAX_VERIFICATION_METHODS + 1 }, (_, i) => vm(`${DID}#k${i}`)) }),
    ],
  ])('null on a shape mismatch: %s', (_label, raw) => {
    expect(acceptRegistryDidDocument(raw, EXPECTED)).toBeNull();
  });

  it('accepts exactly MAX_VERIFICATION_METHODS entries', () => {
    const doc = goodDoc({
      verificationMethod: Array.from({ length: MAX_VERIFICATION_METHODS }, (_, i) => vm(`${DID}#k${i}`)),
    });
    expect(acceptRegistryDidDocument(doc, EXPECTED)).toBe(doc);
  });
});
