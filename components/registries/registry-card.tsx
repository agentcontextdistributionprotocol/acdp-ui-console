'use client';

import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { formatNumber, timeAgo } from '@/lib/utils/format';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';

/**
 * Tooltip copy for known registry profiles (registries/profiles.md). The
 * 0.3.0 trust profiles get an accent chip so they stand out in the list.
 */
const PROFILE_INFO: Record<string, { title: string; accent?: boolean }> = {
  'acdp-registry-core': { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-discovery': { title: 'Search / discovery endpoints (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-federated': { title: 'Cross-registry federation (RFC-ACDP-0001 §9.1)' },
  'acdp-consumer': { title: 'Consumer deployment profile (RFC-ACDP-0001 §9.1)' },
  'acdp-federated': { title: 'Cross-registry federation (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-receipts': {
    title: 'Signed registry receipts at publish time (RFC-ACDP-0010, acdp 0.2.0)',
  },
  'acdp-registry-head-receipts': {
    title: 'Lineage-head receipts: signed serve-time head attestations (RFC-ACDP-0011, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-transparency-log': {
    title: 'Append-only transparency log with inclusion proofs (RFC-ACDP-0012, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-lifecycle': {
    title: 'Signed lifecycle events: retraction / republication (RFC-ACDP-0013, acdp 0.3.0)',
    accent: true,
  },
};

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
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {capabilities.profiles.map((p) => {
                  const info = PROFILE_INFO[p];
                  return (
                    <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>
                      {p}
                    </span>
                  );
                })}
              </span>
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
