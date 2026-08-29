import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogInclusion, WitnessCosignature } from '@/lib/types';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';

const evaluateWitnessQuorum = vi.fn();
const verifyContentHashWasm = vi.fn();

vi.mock('@/lib/verify/wasm', () => ({
  getAcdpWasm: () =>
    Promise.resolve({
      evaluateWitnessQuorum,
      verifyContentHash: verifyContentHashWasm,
    }),
}));

import { verifyContentHash, verifyWitnessQuorum } from '@/lib/verify/verify';

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
});
