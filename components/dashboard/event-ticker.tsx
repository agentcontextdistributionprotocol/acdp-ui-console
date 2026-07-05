'use client';

import { Boxes, ArrowDownToLine, Search, Ban, RotateCcw } from 'lucide-react';
import { eventTypeColor } from '@/lib/colors';
import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { EmptyState } from '@/components/ui/empty-state';
import type { CpContextEvent } from '@/lib/types';

function iconFor(eventType: string) {
  if (eventType.includes('retract')) return <Ban size={13} />;
  if (eventType.includes('republish')) return <RotateCcw size={13} />;
  if (eventType.includes('retriev')) return <ArrowDownToLine size={13} />;
  if (eventType.includes('search')) return <Search size={13} />;
  return <Boxes size={13} />;
}

/** Map a CP event type to a step-event-style colour key. */
function colorKey(eventType: string): string {
  // Lifecycle events first: 'context_republished' also contains 'publish'.
  if (eventType.includes('retract')) return 'acdp.retract';
  if (eventType.includes('republish')) return 'acdp.republish';
  if (eventType.includes('publish')) return 'acdp.publish';
  if (eventType.includes('retriev')) return 'acdp.retrieve';
  if (eventType.includes('search')) return 'acdp.search';
  return 'agent';
}

export function EventTicker({ events }: { events: CpContextEvent[] }) {
  if (events.length === 0) return <EmptyState title="No events yet" />;
  return (
    <div style={{ maxHeight: 280, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.slice(0, 12).map((ev) => {
        const color = eventTypeColor(colorKey(ev.eventType));
        return (
          <div key={ev.id} className="event-row anim-in" style={{ ['--ev-color' as string]: color }}>
            <div className="ev-icon">{iconFor(ev.eventType)}</div>
            <div className="ev-body">
              <div className="ev-type">{ev.eventType.replace(/_/g, '.')}</div>
              <div className="ev-detail">
                {ev.ctxId ? formatCtxId(ev.ctxId) : formatAgentDid(ev.agentId) || '—'}
              </div>
              <div className="ev-meta">
                {ev.registryAuthority && <span>{shortAuthority(ev.registryAuthority)}</span>}
                {ev.agentId && <span>{formatAgentDid(ev.agentId)}</span>}
              </div>
            </div>
            <div className="ev-ts">{timeAgo(ev.eventTs)}</div>
          </div>
        );
      })}
    </div>
  );
}
