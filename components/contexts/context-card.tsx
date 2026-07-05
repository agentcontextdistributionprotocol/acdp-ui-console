'use client';

import { formatCtxId, formatAgentDid, shortAuthority, parseCtxId } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { pressable } from '@/lib/utils/a11y';
import { C, statusChipClass } from '@/lib/colors';
import type { SearchHit } from '@/lib/types';

export function ContextCard({ hit, onOpen }: { hit: SearchHit; onOpen: (ctxId: string) => void }) {
  // The match_summary projection carries no registry_authority; the origin
  // registry is encoded in the ctx_id (acdp://<authority>/<id>).
  const authority = parseCtxId(hit.ctx_id)?.authority ?? '';
  const retracted = hit.status === 'retracted';
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        cursor: 'pointer',
        // Retracted contexts stay inspectable but read as decommissioned.
        ...(retracted ? { opacity: 0.6, borderColor: 'rgba(240, 93, 122, 0.35)', borderStyle: 'dashed' } : {}),
      }}
      {...pressable(() => onOpen(hit.ctx_id), `Inspect context ${hit.title || hit.ctx_id}`)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {hit.title || 'Untitled context'}
          </div>
          <div className="did" style={{ marginBottom: 8, fontSize: 11, maxWidth: '100%' }}>
            {formatCtxId(hit.ctx_id)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hit.status && <span className={statusChipClass(hit.status)}>{hit.status}</span>}
            {hit.type && <span className="chip">{hit.type}</span>}
            {hit.domain && <span className="chip">{hit.domain}</span>}
            {hit.visibility && <span className={`chip${hit.visibility === 'public' ? '' : ' ok'}`}>{hit.visibility}</span>}
            {authority && <span className="chip mode-dual">{shortAuthority(authority)}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="did" style={{ fontSize: 10 }}>
            {formatAgentDid(hit.agent_id)}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>{timeAgo(hit.created_at)}</div>
        </div>
      </div>
    </div>
  );
}
