'use client';

import { useEffect, useRef } from 'react';
import { EventRow } from './event-row';
import { StatusDot } from '@/components/ui/status-dot';
import { EmptyState } from '@/components/ui/empty-state';
import type { LiveStatus } from '@/lib/hooks/use-live-run';
import type { StepEvent } from '@/lib/types';

export function EventFeed({
  events,
  status,
  onSelectCtx,
}: {
  events: StepEvent[];
  status: LiveStatus;
  onSelectCtx?: (ctxId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const live = status === 'live' || status === 'connecting';

  return (
    <div className="event-feed-panel">
      <div className="feed-header">
        <h2>Event Stream</h2>
        {live ? (
          <span className="live-badge">
            <StatusDot tone="ok" pulse />
            LIVE
          </span>
        ) : (
          <span className={`badge ${status === 'error' ? 'badge-failed' : 'badge-complete'}`}>
            {status === 'error' ? '✗ error' : '● ended'}
          </span>
        )}
      </div>
      <div className="feed-list" ref={listRef}>
        {events.length === 0 ? (
          <EmptyState title="Waiting for events…" />
        ) : (
          events.map((ev, i) => <EventRow key={`${ev.type}-${ev.ts}-${i}`} event={ev} onSelectCtx={onSelectCtx} />)
        )}
      </div>
    </div>
  );
}
