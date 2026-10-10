// ══════════════════════════════════════════════════════════════════════
// The live registry DID-document disclosure in `ContextDetail`.
//
// When real mode accepted at least one registry DID document, the detail pane
// says — in visible text, never a tooltip — where that key came from: the
// registry this console is configured to use, checked against the ctx_id's
// authority, NOT looked up from the authority's domain. Demo mode and real
// mode with nothing accepted render no such line. The verdict hook is mocked
// so this asserts only the disclosure and the map handed to the verifier.
// ══════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ContextVerdicts } from '@/lib/verify/use-verdicts';
import type { RegistryDidDocs } from '@/lib/hooks/use-registry-did-docs';

const useContextVerdicts = vi.fn<(...args: unknown[]) => ContextVerdicts>(() => ({ ready: false }));
vi.mock('@/lib/verify/use-verdicts', () => ({
  useContextVerdicts: (...args: unknown[]) => useContextVerdicts(...args),
}));

const useRegistryDidDocs = vi.fn<(ctxAuthority: string) => RegistryDidDocs>();
vi.mock('@/lib/hooks/use-registry-did-docs', () => ({
  useRegistryDidDocs: (a: string) => useRegistryDidDocs(a),
}));

import { ContextDetail } from '@/components/contexts/context-detail';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { parseCtxId } from '@/lib/utils/acdp';

const CTX = MOCK_CONTEXTS.find((c) => c.registry_receipt) ?? MOCK_CONTEXTS[0];
const AUTH = parseCtxId(CTX.body.ctx_id)!.authority;
const DID = `did:web:${AUTH}`;
const DOCS = { [DID]: { id: DID } };

const LIVE: RegistryDidDocs = { docs: DOCS, fetched: [{ registry: 'a', did: DID }] };
const NONE: RegistryDidDocs = { docs: undefined, fetched: [] };

function renderIn(demoMode: boolean, didDocs: RegistryDidDocs) {
  usePreferencesStore.setState({ demoMode });
  useRegistryDidDocs.mockReturnValue(didDocs);
  return render(<ContextDetail ctx={CTX} requestedCtxId={CTX.body.ctx_id} />);
}

afterEach(() => {
  cleanup();
  useContextVerdicts.mockClear();
  useRegistryDidDocs.mockReset();
  usePreferencesStore.setState({ demoMode: true });
});

describe('ContextDetail — live registry DID-document disclosure', () => {
  it('real mode with an accepted document renders the disclosure as visible text', () => {
    const text = renderIn(false, LIVE).container.textContent ?? '';
    expect(text).toContain(`Registry key material: the DID document for ${DID} was fetched from Registry A`);
    expect(text).toContain('the registry this console is configured to use (REGISTRY_A_BASE_URL)');
    expect(text).toContain('checked against the authority named in this ctx_id');
    expect(text).toContain(
      "It is consistent with that registry; it was not looked up from the authority's own domain over DNS/TLS.",
    );
  });

  it('the disclosure never calls the document "resolved"', () => {
    const { container } = renderIn(false, LIVE);
    const note = container.querySelector('[role="note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).not.toMatch(/resolv/i);
  });

  it('real mode with nothing accepted renders no disclosure', () => {
    const text = renderIn(false, NONE).container.textContent ?? '';
    expect(text).not.toContain('Registry key material');
  });

  it('demo mode renders no disclosure, even if the hook reported a fetch', () => {
    const text = renderIn(true, LIVE).container.textContent ?? '';
    expect(text).not.toContain('Registry key material');
  });

  it('passes the hook map to the verifier and the ctx_id authority to the hook', () => {
    renderIn(false, LIVE);
    expect(useRegistryDidDocs).toHaveBeenCalledWith(AUTH);
    expect(useContextVerdicts.mock.calls[0][1]).toBe(DOCS);
  });
});
