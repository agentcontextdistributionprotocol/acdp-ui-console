'use client';

import { useQuery } from '@tanstack/react-query';
import { ContextDetail } from '@/components/contexts/context-detail';
import { getContext } from '@/lib/api/client';
import { contextErrorMessage } from '@/lib/utils/api-error-messages';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';

export function ContextInspector({ ctxId }: { ctxId: string | null }) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading, error } = useQuery({
    queryKey: ['context', ctxId, demoMode],
    queryFn: () => getContext(ctxId!, demoMode),
    enabled: !!ctxId,
  });

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em' }}>
        CONTEXT BODY
      </div>
      {!ctxId && <div style={{ fontSize: 11, color: C.faint }}>Click a node or event to inspect its context.</div>}
      {ctxId && isLoading && <div style={{ fontSize: 11, color: C.faint }}>Loading…</div>}
      {/* The message comes from the shared map, which is also what
          `app/contexts/page.tsx` renders — the two surfaces used to hold their
          own copies of the same two string literals, so a change to one was a
          silent divergence from the other. In particular this no longer tells
          the operator a registry served a substituted context when the control
          plane's own code says only that it could not check. */}
      {ctxId && error && (
        <div style={{ fontSize: 11, color: C.danger }}>{contextErrorMessage(error)}</div>
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
