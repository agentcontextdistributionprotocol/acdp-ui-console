'use client';

import { shortAuthority } from '@/lib/utils/acdp';
import { formatNumber } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { CpDashboardOverview } from '@/lib/types';
import { EmptyState } from '@/components/ui/empty-state';

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: C.panel3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: tone }} />
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  'did:web': C.info,
  'did:key': C.purple,
  other: C.muted,
};

/** Per-registry receipt coverage: how many publishes carried a registry receipt. */
export function ReceiptCoverageBars({ coverage }: { coverage: NonNullable<CpDashboardOverview['receiptCoverage']> }) {
  if (!coverage || coverage.length === 0) return <EmptyState title="No receipt coverage in this window" />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {coverage.map((r) => {
        const pct = r.publish_count > 0 ? (r.receipt_count / r.publish_count) * 100 : 0;
        const tone = pct >= 90 ? C.success : pct >= 50 ? C.warning : C.danger;
        return (
          <div key={r.registry_authority} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
              <span style={{ color: C.text }}>{shortAuthority(r.registry_authority)}</span>
              <span style={{ marginLeft: 'auto', color: tone, fontWeight: 600 }}>{Math.round(pct)}%</span>
              <span style={{ color: C.muted, fontSize: 10.5 }}>
                {formatNumber(r.receipt_count)}/{formatNumber(r.publish_count)}
              </span>
            </div>
            <Bar pct={pct} tone={tone} />
          </div>
        );
      })}
    </div>
  );
}

/** Producer DID-method adoption (did:web vs did:key vs other). */
export function DidMethodBars({ methods }: { methods: NonNullable<CpDashboardOverview['didMethods']> }) {
  if (!methods || methods.length === 0) return <EmptyState title="No publishes in this window" />;
  const total = methods.reduce((s, m) => s + m.publish_count, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {methods.map((m) => {
        const pct = (m.publish_count / total) * 100;
        const tone = METHOD_TONE[m.method] ?? C.muted;
        return (
          <div key={m.method} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
              <span className="did" style={{ color: C.text }}>{m.method}</span>
              <span style={{ marginLeft: 'auto', color: tone, fontWeight: 600 }}>{Math.round(pct)}%</span>
              <span style={{ color: C.muted, fontSize: 10.5 }}>{formatNumber(m.publish_count)}</span>
            </div>
            <Bar pct={pct} tone={tone} />
          </div>
        );
      })}
    </div>
  );
}
