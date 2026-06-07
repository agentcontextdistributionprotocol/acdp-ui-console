'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { listAgents } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { KnownAgent } from '@/lib/types';

export default function AgentsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading, error } = useQuery({
    queryKey: ['agents', demoMode],
    queryFn: () => listAgents(demoMode),
  });
  const [selected, setSelected] = useState<KnownAgent | null>(null);

  return (
    <div className="page">
      <SectionTitle icon={Users} title="Agents" sub="Known agent DIDs observed through the control plane" />

      {isLoading && <LoadingSkeleton rows={4} height={44} />}
      {error && <ErrorPanel message={String(error)} />}
      {data && data.length === 0 && <EmptyState title="No agents observed yet" />}
      {data && data.length > 0 && (
        <Card>
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent DID</th>
                <th>Registry</th>
                <th>Contexts</th>
                <th>First seen</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.agentDid} onClick={() => setSelected(a)}>
                  <td className="did" style={{ maxWidth: 320 }}>
                    {a.agentDid}
                  </td>
                  <td>{shortAuthority(a.registryAuthority)}</td>
                  <td>{a.contextCount}</td>
                  <td style={{ color: 'var(--muted)' }}>{timeAgo(a.firstSeen)}</td>
                  <td style={{ color: 'var(--muted)' }}>{timeAgo(a.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? formatAgentDid(selected.agentDid) : 'Agent'}>
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row label="DID" value={selected.agentDid} mono />
            <Row label="Registry" value={shortAuthority(selected.registryAuthority) || '—'} />
            <Row label="Contexts published" value={String(selected.contextCount)} />
            <Row label="First seen" value={timeAgo(selected.firstSeen)} />
            <Row label="Last active" value={timeAgo(selected.lastSeen)} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="metric-row">
      <span className="metric-name">{label}</span>
      <span style={{ fontSize: 11, color: C.text, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
