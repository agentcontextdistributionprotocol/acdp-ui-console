'use client';

import { ArrowDown } from 'lucide-react';
import { formatCtxId, formatAgentDid } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { pressable } from '@/lib/utils/a11y';
import { C } from '@/lib/colors';
import type { FullContext } from '@/lib/types';

/**
 * Vertical version chain for a lineage (oldest → newest). The highest-version
 * entry is marked "current"; each card opens the full context detail.
 */
export function LineageChain({
  chain,
  onOpen,
}: {
  chain: FullContext[];
  onOpen: (ctxId: string) => void;
}) {
  const currentVersion = chain.reduce((max, c) => Math.max(max, c.body.version), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {chain.map((ctx, i) => {
        const b = ctx.body;
        const isCurrent = b.version === currentVersion;
        return (
          <div key={b.ctx_id}>
            <div
              className="card"
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                borderColor: isCurrent ? C.brand : C.border,
              }}
              {...pressable(() => onOpen(b.ctx_id), `Inspect version ${b.version} — ${b.title}`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={isCurrent ? 'chip ok' : 'chip'}>v{b.version}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>
                  {b.title}
                </span>
                {isCurrent && <span className="chip ok">current</span>}
              </div>
              <div className="did" style={{ fontSize: 10.5, marginTop: 6 }}>
                {formatCtxId(b.ctx_id)}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
                {formatAgentDid(b.agent_id)} · {timeAgo(b.created_at)}
                {b.supersedes ? ` · supersedes ${formatCtxId(b.supersedes)}` : ''}
              </div>
            </div>
            {i < chain.length - 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0', color: C.faint }}>
                <ArrowDown size={14} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
