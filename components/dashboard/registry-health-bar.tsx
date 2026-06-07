'use client';

import { StatusDot } from '@/components/ui/status-dot';
import { shortAuthority } from '@/lib/utils/acdp';
import { formatNumber } from '@/lib/utils/format';
import type { CpDashboardOverview } from '@/lib/types';

export function RegistryHealthBar({ byRegistry }: { byRegistry: CpDashboardOverview['byRegistry'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {byRegistry.map((r) => (
        <div key={r.registry_authority} className="metric-row">
          <StatusDot tone="ok" />
          <span className="metric-name">{shortAuthority(r.registry_authority)}</span>
          <span className="metric-val">{formatNumber(r.event_count)}</span>
        </div>
      ))}
    </div>
  );
}
