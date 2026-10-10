'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRegistryCapabilities, getRegistryDidDocument } from '@/lib/api/client';
import { MOCK_DID_DOCS } from '@/lib/data/mock-data';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { acceptRegistryDidDocument } from '@/lib/verify/did-docs';
import type { DidDocMap } from '@/lib/verify/resolve';
import type { RegistryAuthority } from '@/lib/types';

/** One registry DID document this console fetched and accepted. */
export interface FetchedRegistryDid {
  registry: RegistryAuthority;
  did: string;
}

export interface RegistryDidDocs {
  /**
   * The map handed to `useContextVerdicts`. Referentially STABLE across
   * re-renders while the accepted documents are unchanged: `use-verdicts.ts`
   * re-runs the whole wasm suite whenever `docs` changes identity.
   */
  docs: DidDocMap;
  /**
   * Real mode only: which registry DID documents were fetched live and
   * accepted. Empty in demo mode (the docs there are the bundled fixtures, not
   * a fetch) and whenever nothing was accepted.
   */
  fetched: FetchedRegistryDid[];
}

const NONE: FetchedRegistryDid[] = [];
const DEMO: RegistryDidDocs = { docs: MOCK_DID_DOCS, fetched: NONE };
const EMPTY: RegistryDidDocs = { docs: undefined, fetched: NONE };

/**
 * One registry: capabilities probe → (only if it advertises the ctx_id's
 * authority) `/.well-known/did.json` → acceptance gate. Returns the accepted
 * document (the fetched object itself, so its identity is React Query's) or
 * `null`.
 */
function useAcceptedRegistryDoc(
  registry: RegistryAuthority,
  ctxAuthority: string,
  demoMode: boolean,
): Record<string, unknown> | null {
  // Same key and fetcher as `useRegistryCapabilities`, so the probe is shared
  // with /registries rather than issued twice; gated off in demo mode, where
  // the bundled fixtures are used instead.
  const caps = useQuery({
    queryKey: ['registry-capabilities', registry, demoMode],
    queryFn: () => getRegistryCapabilities(registry, demoMode),
    retry: false,
    enabled: !demoMode && ctxAuthority !== '',
  });
  const capsAuthority = caps.data?.authority;
  const capsDid = caps.data?.registry_did;
  const matches = typeof capsAuthority === 'string' && capsAuthority !== '' && capsAuthority === ctxAuthority;

  const doc = useQuery({
    queryKey: ['registry-did-document', registry, demoMode],
    queryFn: () => getRegistryDidDocument(registry, demoMode),
    retry: false,
    enabled: !demoMode && matches,
  });
  const raw = doc.data;

  return useMemo(() => {
    if (demoMode || !matches || raw === undefined || raw === null) return null;
    return acceptRegistryDidDocument(raw, {
      authority: capsAuthority,
      registryDid: typeof capsDid === 'string' ? capsDid : '',
      ctxAuthority,
    });
  }, [demoMode, matches, raw, capsAuthority, capsDid, ctxAuthority]);
}

/**
 * Live did:web key material for the registry that issued a context — and ONLY
 * that registry's own DID document.
 *
 * Real mode: for each configured registry (`a`, `b`), the capabilities probe
 * names the registry's authority; if it equals the authority in the ctx_id,
 * that registry's `/.well-known/did.json` is fetched through the proxy and
 * accepted only if its id is exactly `did:web:<authority>` (see
 * `acceptRegistryDidDocument`). A 404, a fetch error, or a mismatch leaves the
 * map without it, so those surfaces stay `unavailable`.
 *
 * The map is keyed by the document's EXACT DID, so a producer or witness DID
 * on the same host (`did:web:<authority>:agents:x`) is never matched by it —
 * producer signatures and anything needing a producer key stay amber by design.
 *
 * Demo mode: the bundled `MOCK_DID_DOCS`, unchanged from before.
 */
export function useRegistryDidDocs(ctxAuthority: string): RegistryDidDocs {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const a = useAcceptedRegistryDoc('a', ctxAuthority, demoMode);
  const b = useAcceptedRegistryDoc('b', ctxAuthority, demoMode);

  return useMemo(() => {
    if (demoMode) return DEMO;
    if (!a && !b) return EMPTY;
    // Two registries advertising the SAME authority/DID is ambiguous: nothing
    // binds the document to the registry that actually served the context, so
    // neither is trusted (surfaces stay amber) rather than letting b's keys
    // silently replace a's.
    if (a && b && a.id === b.id) return EMPTY;
    // Null-prototype: `resolve.ts` looks keys up with a context-controlled DID,
    // and `docs['__proto__']` must read as absent, not `Object.prototype`.
    const docs: Record<string, unknown> = Object.create(null);
    const fetched: FetchedRegistryDid[] = [];
    for (const [registry, doc] of [
      ['a', a],
      ['b', b],
    ] as const) {
      if (!doc) continue;
      const did = doc.id as string;
      docs[did] = doc;
      fetched.push({ registry, did });
    }
    return { docs, fetched };
  }, [demoMode, a, b]);
}
