'use client';

import { useQuery } from '@tanstack/react-query';
import { ContextDetail } from '@/components/contexts/context-detail';
import { getContext } from '@/lib/api/client';
import { ApiError } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';

export function ContextInspector({ ctxId }: { ctxId: string | null }) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading, error } = useQuery({
    queryKey: ['context', ctxId, demoMode],
    queryFn: () => getContext(ctxId!, demoMode),
    enabled: !!ctxId,
  });

  // See app/contexts/page.tsx's identical check: a fail-closed
  // verifyCtxIdBinding rejection is a worse signal than a generic fetch
  // failure and gets its own trust-hostile message.
  const bindingMismatch =
    error instanceof ApiError &&
    (error.errorCode === 'CONTEXT_ID_MISMATCH' || error.errorCode === 'CONTEXT_BINDING_UNVERIFIABLE');

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em' }}>
        CONTEXT BODY
      </div>
      {!ctxId && <div style={{ fontSize: 11, color: C.faint }}>Click a node or event to inspect its context.</div>}
      {ctxId && isLoading && <div style={{ fontSize: 11, color: C.faint }}>Loading…</div>}
      {ctxId && error && (
        <div style={{ fontSize: 11, color: C.danger }}>
          {bindingMismatch
            ? "Registry served a context that doesn't match its own claimed id — this response cannot be trusted."
            : 'Could not load context.'}
        </div>
      )}
      {ctxId && data && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {/* requestedCtxId is the ctxId this inspector was asked to load (a graph
              node/event's id), independent of whatever the fetched body claims. */}
          <ContextDetail ctx={data} compact requestedCtxId={ctxId} />
        </div>
      )}
    </div>
  );
}
