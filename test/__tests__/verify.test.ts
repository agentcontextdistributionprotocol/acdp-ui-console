import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextBody, LineageHeadReceipt, LogInclusion, RegistryReceipt, WitnessCosignature } from '@/lib/types';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';

const evaluateWitnessQuorum = vi.fn();
const verifyContentHashWasm = vi.fn();
const resolveDidKey = vi.fn();
const verifySignatureEd25519 = vi.fn();
const verifySignatureP256 = vi.fn();
const canonicalPreimage = vi.fn();
const fingerprintEd25519 = vi.fn();
const verifyReceipt = vi.fn();
const verifyLineageHeadReceiptWasm = vi.fn();
const verifyLogCheckpoint = vi.fn();
const buildLogLeaf = vi.fn();
const verifyLogInclusion = vi.fn();

vi.mock('@/lib/verify/wasm', () => ({
  getAcdpWasm: () =>
    Promise.resolve({
      evaluateWitnessQuorum,
      verifyContentHash: verifyContentHashWasm,
      resolveDidKey,
      verifySignatureEd25519,
      verifySignatureP256,
      canonicalPreimage,
      fingerprintEd25519,
      verifyReceipt,
      verifyLineageHeadReceipt: verifyLineageHeadReceiptWasm,
      verifyLogCheckpoint,
      buildLogLeaf,
      verifyLogInclusion,
    }),
}));

import {
  verifyContentHash,
  verifyLineageHeadReceipt,
  verifyProducerSignature,
  verifyRegistryReceipt,
  verifyTransparencyLog,
  verifyWitnessQuorum,
} from '@/lib/verify/verify';

const DID_KEY_SIGNER = 'did:key:z6MkSignerRawKeyMaterial';
const DID_KEY_REGISTRY = 'did:key:z6MkRegistryRawKeyMaterial';

function bodyWithSignature(overrides: Partial<ContextBody> = {}): ContextBody {
  return {
    ...MOCK_CONTEXTS[0].body,
    signature: { algorithm: 'ed25519', key_id: `${DID_KEY_SIGNER}#key-1`, value: 'sig-value' },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

function cosig(witnessId: string, keyId: string): WitnessCosignature {
  return {
    cosignature_version: 'acdp-cosig/1',
    witness_id: witnessId,
    witnessed_checkpoint: {
      log_id: 'did:web:reg.example/log/main',
      tree_size: 5,
      root_hash: 'sha256:abc',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    witnessed_at: '2026-01-01T00:00:00.000Z',
    signature: { algorithm: 'ed25519', key_id: keyId, value: 'sigvalue' },
  };
}

function inclusionWith(witnesses: WitnessCosignature[]): LogInclusion {
  return {
    log_id: 'did:web:reg.example/log/main',
    leaf_index: 0,
    tree_size: 5,
    inclusion_path: [],
    log_checkpoint: {
      checkpoint_version: 'acdp-log/1',
      log_id: 'did:web:reg.example/log/main',
      tree_size: 5,
      root_hash: 'sha256:abc',
      timestamp: '2026-01-01T00:00:00.000Z',
      signature: { algorithm: 'ed25519', key_id: 'did:web:reg.example#key-1', value: 'sig' },
    },
    witness_signatures: witnesses,
  };
}

describe('verifyContentHash — fromWasm malformed-output handling (UI-4)', () => {
  it('valid wasm output verifies', async () => {
    verifyContentHashWasm.mockReturnValue(JSON.stringify({ valid: true }));
    const result = await verifyContentHash(MOCK_CONTEXTS[0].body);
    expect(result.status).toBe('verified');
  });

  it('unparseable wasm output is caught as a failure, not an unhandled throw', async () => {
    verifyContentHashWasm.mockReturnValue('not json');
    const result = await verifyContentHash(MOCK_CONTEXTS[0].body);
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('malformed material:');
  });

  it('a throw from the wasm call itself is caught the same way', async () => {
    verifyContentHashWasm.mockImplementation(() => {
      throw new Error('nope');
    });
    const result = await verifyContentHash(MOCK_CONTEXTS[0].body);
    expect(result.status).toBe('failed');
    expect(result.detail).toBe('malformed material: nope');
  });
});

describe('verifyWitnessQuorum — unresolvable witnesses (UI-5)', () => {
  it('all witnesses resolved, quorum met → verified', async () => {
    evaluateWitnessQuorum.mockReturnValue(JSON.stringify({ witnessed_count: 2, meets_quorum: true }));
    const witnesses = [
      cosig('did:key:witness-a', 'did:key:witness-a#witness-a'),
      cosig('did:key:witness-b', 'did:key:witness-b#witness-b'),
    ];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('verified');
    expect(result.witnessedCount).toBe(2);
    expect(result.requiredCount).toBe(2);
    expect(result.detail).toContain('2-witnessed');
  });

  it('all witnesses resolved, quorum not met → failed', async () => {
    evaluateWitnessQuorum.mockReturnValue(JSON.stringify({ witnessed_count: 1, meets_quorum: false }));
    const witnesses = [
      cosig('did:key:witness-a', 'did:key:witness-a#witness-a'),
      cosig('did:key:witness-b', 'did:key:witness-b#witness-b'),
    ];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('failed');
    expect(result.witnessedCount).toBe(1);
    expect(result.requiredCount).toBe(2);
    expect(result.detail).toBe('1 of 2 witness cosignatures verified');
  });

  it('excludes an unresolved witness from the quorum requirement instead of counting it as a failure', async () => {
    evaluateWitnessQuorum.mockImplementation((_cosigs: string, _cp: string, trustedJson: string) => {
      const trusted = JSON.parse(trustedJson) as string[];
      return JSON.stringify({ witnessed_count: trusted.length, meets_quorum: true });
    });
    const witnesses = [
      cosig('did:key:witness-a', 'did:key:witness-a#witness-a'),
      // did:web with no matching entry in `docs` — its DID document never resolves.
      cosig('did:web:unresolved.example', 'did:web:unresolved.example#key-1'),
    ];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('verified');
    expect(result.requiredCount).toBe(1);
    expect(result.witnessedCount).toBe(1);
    expect(result.detail).toContain('1 witness skipped — DID document not resolved');

    const [, , trustedArg] = evaluateWitnessQuorum.mock.calls[0];
    expect(JSON.parse(trustedArg)).toEqual(['did:key:witness-a']);
  });

  it('every witness unresolved → unavailable, never a false "failed"', async () => {
    const witnesses = [
      cosig('did:web:a.example', 'did:web:a.example#key-1'),
      cosig('did:web:b.example', 'did:web:b.example#key-1'),
    ];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('unavailable');
    expect(result.witnessedCount).toBe(0);
    expect(result.requiredCount).toBe(2);
    expect(evaluateWitnessQuorum).not.toHaveBeenCalled();
  });

  it('a throw from the wasm evaluator surfaces as failed with the resolvable-only required count', async () => {
    evaluateWitnessQuorum.mockImplementation(() => {
      throw new Error('boom');
    });
    const witnesses = [
      cosig('did:key:witness-a', 'did:key:witness-a#witness-a'),
      cosig('did:web:unresolved.example', 'did:web:unresolved.example#key-1'),
    ];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('failed');
    expect(result.detail).toBe('malformed cosignatures: boom');
    expect(result.requiredCount).toBe(1);
  });

  it('unparseable (but non-throwing) evaluator output is caught as failed, not an unhandled throw (UI-4)', async () => {
    evaluateWitnessQuorum.mockReturnValue('not json');
    const witnesses = [cosig('did:key:witness-a', 'did:key:witness-a#witness-a')];
    const result = await verifyWitnessQuorum(inclusionWith(witnesses), undefined);
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('malformed quorum result:');
  });
});

describe('verifyProducerSignature', () => {
  afterEach(() => resolveDidKey.mockReset());

  it('no signature on the body → unavailable', async () => {
    const result = await verifyProducerSignature({ ...MOCK_CONTEXTS[0].body, signature: undefined }, undefined);
    expect(result.status).toBe('unavailable');
  });

  it('did:web signer with no DID document supplied → unavailable, never a false failure', async () => {
    const body = bodyWithSignature({ signature: { algorithm: 'ed25519', key_id: 'did:web:unresolved.example#key-1', value: 'v' } });
    const result = await verifyProducerSignature(body, undefined);
    expect(result.status).toBe('unavailable');
    expect(result.detail).toContain('DID document not fetched');
  });

  it('did:key signer resolves offline and a valid wasm verdict verifies', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'key-bytes' }));
    verifySignatureEd25519.mockReturnValue(JSON.stringify({ valid: true }));
    const result = await verifyProducerSignature(bodyWithSignature(), undefined);
    expect(result.status).toBe('verified');
  });

  it('did:key signer with an invalid signature → failed', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'key-bytes' }));
    verifySignatureEd25519.mockReturnValue(JSON.stringify({ valid: false, error: 'mismatch' }));
    const result = await verifyProducerSignature(bodyWithSignature(), undefined);
    expect(result.status).toBe('failed');
  });
});

describe('verifyRegistryReceipt', () => {
  afterEach(() => resolveDidKey.mockReset());

  function receipt(overrides: Partial<RegistryReceipt> = {}): RegistryReceipt {
    const body = bodyWithSignature();
    return {
      registry_did: DID_KEY_REGISTRY,
      ctx_id: body.ctx_id,
      lineage_id: body.lineage_id,
      origin_registry: body.origin_registry,
      created_at: '2026-01-01T00:00:00.000Z',
      content_hash: body.content_hash,
      key_fingerprint: 'sha256:fingerprint',
      signature: { algorithm: 'ed25519', key_id: `${DID_KEY_REGISTRY}#key-1`, value: 'sig' },
      ...overrides,
    };
  }

  it('registry signer not resolvable → unavailable', async () => {
    const result = await verifyRegistryReceipt(
      { ...receipt(), registry_did: 'did:web:unresolved.example', signature: { algorithm: 'ed25519', key_id: 'did:web:unresolved.example#key-1', value: 'sig' } },
      bodyWithSignature(),
      undefined,
    );
    expect(result.status).toBe('unavailable');
  });

  it('producer key not on hand → unavailable (cannot recompute the fingerprint)', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'registry-key' }));
    const body = bodyWithSignature({ signature: { algorithm: 'ed25519', key_id: 'did:web:unresolved.example#key-1', value: 'v' } });
    const result = await verifyRegistryReceipt(receipt(), body, undefined);
    expect(result.status).toBe('unavailable');
    expect(result.detail).toContain('producer key not on hand');
  });

  it('both keys resolvable and the wasm verdict is valid → verified', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'raw-key' }));
    canonicalPreimage.mockReturnValue('preimage-bytes');
    fingerprintEd25519.mockReturnValue('sha256:fp');
    verifyReceipt.mockReturnValue(JSON.stringify({ valid: true }));
    const result = await verifyRegistryReceipt(receipt(), bodyWithSignature(), undefined);
    expect(result.status).toBe('verified');
  });
});

describe('verifyLineageHeadReceipt', () => {
  afterEach(() => resolveDidKey.mockReset());

  function lhr(): LineageHeadReceipt {
    const body = bodyWithSignature();
    return {
      receipt_version: 'acdp-lhr/1',
      registry_did: DID_KEY_REGISTRY,
      lineage_id: body.lineage_id,
      head_ctx_id: body.ctx_id,
      head_version: body.version,
      head_status: 'active',
      as_of: '2026-01-01T00:00:00.000Z',
      signature: { algorithm: 'ed25519', key_id: `${DID_KEY_REGISTRY}#key-1`, value: 'sig' },
    };
  }

  it('registry signer not resolvable → unavailable', async () => {
    const badLhr: LineageHeadReceipt = { ...lhr(), registry_did: 'did:web:unresolved.example' };
    const result = await verifyLineageHeadReceipt(badLhr, bodyWithSignature(), 'active', undefined);
    expect(result.status).toBe('unavailable');
  });

  it('resolvable registry signer and a valid wasm verdict → verified', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'raw-key' }));
    verifyLineageHeadReceiptWasm.mockReturnValue(JSON.stringify({ valid: true }));
    const result = await verifyLineageHeadReceipt(lhr(), bodyWithSignature(), 'active', undefined);
    expect(result.status).toBe('verified');
  });
});

describe('verifyTransparencyLog', () => {
  afterEach(() => resolveDidKey.mockReset());

  function inclusion(): LogInclusion {
    return {
      log_id: `${DID_KEY_REGISTRY}/log/main`,
      leaf_index: 0,
      tree_size: 1,
      inclusion_path: [],
      log_checkpoint: {
        checkpoint_version: 'acdp-log/1',
        log_id: `${DID_KEY_REGISTRY}/log/main`,
        tree_size: 1,
        root_hash: 'sha256:root',
        timestamp: '2026-01-01T00:00:00.000Z',
        signature: { algorithm: 'ed25519', key_id: `${DID_KEY_REGISTRY}#key-1`, value: 'sig' },
      },
    };
  }

  it('log signer not resolvable → unavailable', async () => {
    const badInclusion: LogInclusion = {
      ...inclusion(),
      log_checkpoint: { ...inclusion().log_checkpoint, signature: { algorithm: 'ed25519', key_id: 'did:web:unresolved.example#key-1', value: 'sig' } },
    };
    const result = await verifyTransparencyLog(badInclusion, undefined, undefined);
    expect(result.status).toBe('unavailable');
  });

  it('valid checkpoint signature but no receipt on hand → unavailable (leaf cannot be rebuilt)', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'raw-key' }));
    verifyLogCheckpoint.mockReturnValue(JSON.stringify({ valid: true }));
    const result = await verifyTransparencyLog(inclusion(), undefined, undefined);
    expect(result.status).toBe('unavailable');
    expect(result.detail).toContain('inclusion leaf needs the registry receipt');
  });

  it('checkpoint valid, receipt present, inclusion proof valid → verified', async () => {
    resolveDidKey.mockReturnValue(JSON.stringify({ algorithm: 'ed25519', public_key_b64: 'raw-key' }));
    verifyLogCheckpoint.mockReturnValue(JSON.stringify({ valid: true }));
    buildLogLeaf.mockReturnValue('leaf-hash');
    verifyLogInclusion.mockReturnValue(JSON.stringify({ valid: true }));
    const body = bodyWithSignature();
    const receipt: RegistryReceipt = {
      registry_did: DID_KEY_REGISTRY,
      ctx_id: body.ctx_id,
      lineage_id: body.lineage_id,
      origin_registry: body.origin_registry,
      created_at: '2026-01-01T00:00:00.000Z',
      content_hash: body.content_hash,
      key_fingerprint: 'sha256:fp',
      signature: { algorithm: 'ed25519', key_id: `${DID_KEY_REGISTRY}#key-1`, value: 'sig' },
    };
    const result = await verifyTransparencyLog(inclusion(), receipt, undefined);
    expect(result.status).toBe('verified');
  });
});
