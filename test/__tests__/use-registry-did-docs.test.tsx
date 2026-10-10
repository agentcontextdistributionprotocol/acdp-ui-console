// ══════════════════════════════════════════════════════════════════════
// `useRegistryDidDocs` — live did:web material for the issuing registry only.
//
//   - demo mode: the bundled MOCK_DID_DOCS, no network;
//   - real mode: capabilities → did.json → acceptance gate; a 404, a mismatch,
//     or a registry that does not advertise the ctx_id's authority all leave
//     the map empty (surfaces stay amber);
//   - the returned `docs` is referentially STABLE across re-renders, because
//     `useContextVerdicts` re-runs the whole wasm suite when it changes.
// ══════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MOCK_DID_DOCS } from '@/lib/data/mock-data';

const AUTH_A = 'registry-a.example.com';
const AUTH_B = 'registry-b.example.com';
const DID_A = `did:web:${AUTH_A}`;

function regDoc(id = DID_A) {
  return {
    id,
    verificationMethod: [
      {
        id: `${id}#receipt-key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: id,
        publicKeyMultibase: 'z6Mkhu4BLQGcYCtgBVYdM7TgYcGyg6TXqGcnbpdY8ufABFsz',
      },
    ],
    assertionMethod: [`${id}#receipt-key-1`],
  };
}

const caps: Record<string, { authority: string; registry_did: string }> = {
  a: { authority: AUTH_A, registry_did: DID_A },
  b: { authority: AUTH_B, registry_did: `did:web:${AUTH_B}` },
};
let didDocs: Record<string, unknown> = {};

const getRegistryCapabilities = vi.fn(async (authority: string) => caps[authority]);
const getRegistryDidDocument = vi.fn(async (authority: string) => didDocs[authority] ?? null);

vi.mock('@/lib/api/client', () => ({
  getRegistryCapabilities: (a: string) => getRegistryCapabilities(a),
  getRegistryDidDocument: (a: string) => getRegistryDidDocument(a),
}));

let demoMode = false;
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode }),
}));

const { useRegistryDidDocs } = await import('@/lib/hooks/use-registry-did-docs');

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
let client = new QueryClient();
function fresh() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

afterEach(() => {
  cleanup();
  getRegistryCapabilities.mockClear();
  getRegistryDidDocument.mockClear();
  didDocs = {};
  demoMode = false;
});

describe('useRegistryDidDocs', () => {
  it('demo mode returns the bundled MOCK_DID_DOCS and makes no request', () => {
    fresh();
    demoMode = true;
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    expect(result.current.docs).toBe(MOCK_DID_DOCS);
    expect(result.current.fetched).toEqual([]);
    expect(getRegistryCapabilities).not.toHaveBeenCalled();
    expect(getRegistryDidDocument).not.toHaveBeenCalled();
  });

  it('real mode accepts the issuing registry document, keyed by its exact DID', async () => {
    fresh();
    const doc = regDoc();
    didDocs = { a: doc };
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(result.current.fetched).toEqual([{ registry: 'a', did: DID_A }]));
    expect(result.current.docs).toEqual({ [DID_A]: doc });
    // Exact-DID keying: a producer on the same host is not matched.
    expect(result.current.docs?.[`${DID_A}:agents:x`]).toBeUndefined();
    // registry-b advertises another authority, so its did.json is never fetched.
    expect(getRegistryDidDocument).toHaveBeenCalledTimes(1);
    expect(getRegistryDidDocument).toHaveBeenCalledWith('a');
  });

  it('a 404 (null) leaves the map absent', async () => {
    fresh();
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(getRegistryDidDocument).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.docs).toBeUndefined();
    expect(result.current.fetched).toEqual([]);
  });

  it('a fetch error leaves the map absent', async () => {
    fresh();
    getRegistryDidDocument.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(getRegistryDidDocument).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.docs).toBeUndefined();
  });

  it('a document whose id mismatches the registry DID leaves the map absent', async () => {
    fresh();
    didDocs = { a: regDoc('did:web:evil.example') };
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(getRegistryDidDocument).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.docs).toBeUndefined();
  });

  it('a ctx_id authority no configured registry advertises fetches no did.json', async () => {
    fresh();
    didDocs = { a: regDoc() };
    const { result } = renderHook(() => useRegistryDidDocs('elsewhere.example'), { wrapper });
    await waitFor(() => expect(getRegistryCapabilities).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(getRegistryDidDocument).not.toHaveBeenCalled();
    expect(result.current.docs).toBeUndefined();
  });

  it('two registries advertising the same authority are ambiguous: neither is trusted', async () => {
    fresh();
    caps.b = { authority: AUTH_A, registry_did: DID_A };
    try {
      didDocs = { a: regDoc(), b: regDoc() };
      const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
      await waitFor(() => expect(getRegistryDidDocument).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(result.current.docs).toBeUndefined();
      expect(result.current.fetched).toEqual([]);
    } finally {
      caps.b = { authority: AUTH_B, registry_did: `did:web:${AUTH_B}` };
    }
  });

  it('a prototype-name DID reads as absent from the accepted map', async () => {
    fresh();
    didDocs = { a: regDoc() };
    const { result } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(result.current.docs).toBeDefined());
    const docs = result.current.docs as Record<string, unknown>;
    expect(docs['__proto__']).toBeUndefined();
    expect(docs['constructor']).toBeUndefined();
  });

  it('returns a referentially stable docs map across re-renders', async () => {
    fresh();
    didDocs = { a: regDoc() };
    const { result, rerender } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(result.current.docs).toBeDefined());
    const first = result.current.docs;
    rerender();
    rerender();
    expect(result.current.docs).toBe(first);
  });

  it('the absent map is stable too (undefined, not a fresh {})', async () => {
    fresh();
    const { result, rerender } = renderHook(() => useRegistryDidDocs(AUTH_A), { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.docs).toBeUndefined();
  });
});
