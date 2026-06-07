'use client';

import { useQuery } from '@tanstack/react-query';
import { JsonViewer } from '@/components/ui/json-viewer';
import { getContext } from '@/lib/api/client';
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
      {ctxId && error && <div style={{ fontSize: 11, color: C.danger }}>Could not load context.</div>}
      {ctxId && data && <JsonViewer data={data.body} style={{ maxHeight: 200, fontSize: 10.5 }} />}
    </div>
  );
}
