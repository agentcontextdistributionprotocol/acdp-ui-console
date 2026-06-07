'use client';

import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { pressable } from '@/lib/utils/a11y';
import { C } from '@/lib/colors';
import type { SearchHit } from '@/lib/types';

export function ContextCard({ hit, onOpen }: { hit: SearchHit; onOpen: (ctxId: string) => void }) {
  return (
    <div
      className="card"
      style={{ padding: '14px 16px', cursor: 'pointer' }}
      {...pressable(() => onOpen(hit.ctx_id), `Inspect context ${hit.title ?? hit.ctx_id}`)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {hit.title ?? 'Untitled context'}
          </div>
          <div className="did" style={{ marginBottom: 8, fontSize: 11, maxWidth: '100%' }}>
            {formatCtxId(hit.ctx_id)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hit.context_type && <span className="chip">{hit.context_type}</span>}
            {hit.visibility && <span className={`chip${hit.visibility === 'public' ? '' : ' ok'}`}>{hit.visibility}</span>}
            {hit.registry_authority && <span className="chip mode-dual">{shortAuthority(hit.registry_authority)}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="did" style={{ fontSize: 10 }}>
            {formatAgentDid(hit.agent_id)}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>
            v{hit.version ?? 1} · {shortAuthority(hit.registry_authority)}
          </div>
        </div>
      </div>
    </div>
  );
}
