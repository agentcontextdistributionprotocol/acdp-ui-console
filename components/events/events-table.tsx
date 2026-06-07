'use client';

import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { eventTypeColor } from '@/lib/colors';
import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { shortId, timeAgo } from '@/lib/utils/format';
import type { CpContextEvent } from '@/lib/types';

function colorKey(eventType: string): string {
  if (eventType.includes('publish')) return 'acdp.publish';
  if (eventType.includes('retriev')) return 'acdp.retrieve';
  if (eventType.includes('search')) return 'acdp.search';
  return 'agent';
}

export function EventsTable({ events }: { events: CpContextEvent[] }) {
  const router = useRouter();
  if (events.length === 0) return <EmptyState title="No events match these filters" />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Agent</th>
          <th>Ctx ID</th>
          <th>Registry</th>
          <th>Run</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => {
          const color = eventTypeColor(colorKey(ev.eventType));
          return (
            <tr key={ev.id} onClick={() => ev.runId && router.push(`/runs/${ev.runId}`)}>
              <td>
                <span
                  className="badge"
                  style={{ color, background: 'color-mix(in srgb, currentColor 12%, transparent)', borderColor: 'color-mix(in srgb, currentColor 24%, transparent)' }}
                >
                  {ev.eventType.replace(/_/g, '.')}
                </span>
              </td>
              <td className="did">{formatAgentDid(ev.agentId) || '—'}</td>
              <td className="did">{ev.ctxId ? formatCtxId(ev.ctxId) : '—'}</td>
              <td>{shortAuthority(ev.registryAuthority) || '—'}</td>
              <td className="did">{ev.runId ? shortId(ev.runId, 8, 4) : '—'}</td>
              <td style={{ color: 'var(--muted)' }}>{timeAgo(ev.eventTs)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
