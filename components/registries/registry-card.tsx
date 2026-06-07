'use client';

import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { formatNumber, timeAgo } from '@/lib/utils/format';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';

export function RegistryCard({
  registry,
  capabilities,
}: {
  registry: KnownRegistry;
  capabilities?: RegistryCapabilities;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="ok" />
          <h2>{registry.authority}</h2>
        </div>
        <Badge variant="complete">● healthy</Badge>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="metric-row">
          <span className="metric-name">Event count</span>
          <span className="metric-val">{formatNumber(registry.eventCount)}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Base URL</span>
          <span className="did">{registry.baseUrl ?? '—'}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Last seen</span>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{timeAgo(registry.lastSeen)}</span>
        </div>
        {capabilities && (
          <>
            <div className="metric-row">
              <span className="metric-name">ACDP version</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>{capabilities.acdp_version}</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Algorithms</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {capabilities.supported_signature_algorithms.join(', ')}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Profiles</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>{capabilities.profiles.join(', ')}</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Max payload</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {Math.round(capabilities.limits.max_payload_bytes / 1024)} KB
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Anon reads</span>
              <Badge variant={capabilities.anonymous_public_reads ? 'pub' : 'neutral'}>
                {capabilities.anonymous_public_reads ? 'enabled' : 'disabled'}
              </Badge>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
