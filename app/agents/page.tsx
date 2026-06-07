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
import { listAgents, listCpEvents } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatAgentDid, formatCtxId, shortAuthority } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { pressable } from '@/lib/utils/a11y';
import { C } from '@/lib/colors';
import type { KnownAgent } from '@/lib/types';

export default function AgentsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading, error } = useQuery({
    queryKey: ['agents', demoMode],
    queryFn: () => listAgents(demoMode),
  });
  const [selected, setSelected] = useState<KnownAgent | null>(null);

  // Drill-down: the selected agent's recent context events.
  const agentEvents = useQuery({
    queryKey: ['agent-events', selected?.agentDid, demoMode],
    queryFn: () => listCpEvents({ agentId: selected!.agentDid, limit: 20 }, demoMode),
    enabled: !!selected,
  });

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
                <tr key={a.agentDid} {...pressable(() => setSelected(a), `View agent ${a.agentDid}`)}>
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

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? formatAgentDid(selected.agentDid) : 'Agent'}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row label="DID" value={selected.agentDid} mono />
              <Row label="Registry" value={shortAuthority(selected.registryAuthority) || '—'} />
              <Row label="Contexts published" value={String(selected.contextCount)} />
              <Row label="First seen" value={timeAgo(selected.firstSeen)} />
              <Row label="Last active" value={timeAgo(selected.lastSeen)} />
            </div>

            <div>
              <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
                RECENT ACTIVITY
              </div>
              {agentEvents.isLoading && <div style={{ fontSize: 11, color: C.faint }}>Loading…</div>}
              {agentEvents.data && agentEvents.data.data.length === 0 && (
                <div style={{ fontSize: 11, color: C.faint }}>No recorded events.</div>
              )}
              {agentEvents.data && agentEvents.data.data.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {agentEvents.data.data.slice(0, 8).map((ev) => (
                    <div
                      key={ev.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.text }}
                    >
                      <span className="chip">{ev.eventType.replace(/_/g, '.')}</span>
                      <span className="did" style={{ flex: 1 }}>
                        {ev.ctxId ? formatCtxId(ev.ctxId) : '—'}
                      </span>
                      <span style={{ color: C.muted }}>{timeAgo(ev.eventTs)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
      <span
        style={{
          fontSize: 11,
          color: C.text,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          wordBreak: 'break-all',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}
