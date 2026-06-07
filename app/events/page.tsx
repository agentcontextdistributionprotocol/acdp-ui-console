'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListTree } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EventsTable } from '@/components/events/events-table';
import { listCpEvents } from '@/lib/api/client';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';

const EVENT_TYPES = ['All types', 'context_published', 'context_retrieved', 'search_executed'];
const PAGE = 50;

export default function EventsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [agent, setAgent] = useState('');
  const [registry, setRegistry] = useState('');
  const [type, setType] = useState('All types');
  const [liveOn, setLiveOn] = useState(false);
  const [visible, setVisible] = useState(PAGE);

  const agentQ = useDebounced(agent);
  const registryQ = useDebounced(registry);

  const filter = useMemo(
    () => ({
      agentId: agentQ || undefined,
      registryAuthority: registryQ || undefined,
      eventType: type === 'All types' ? undefined : type,
      limit: 200,
    }),
    [agentQ, registryQ, type],
  );

  // Reset the visible window whenever the filter changes.
  useEffect(() => setVisible(PAGE), [filter]);

  const history = useQuery({
    queryKey: ['events', filter, demoMode],
    queryFn: () => listCpEvents(filter, demoMode),
  });

  const { events: liveEvents, live } = useGlobalEvents(liveOn);

  const merged = useMemo(() => {
    if (!liveOn) return history.data?.data ?? [];
    const seen = new Set(liveEvents.map((e) => e.id));
    return [...liveEvents, ...(history.data?.data ?? []).filter((e) => !seen.has(e.id))];
  }, [liveOn, liveEvents, history.data]);

  const shown = merged.slice(0, visible);

  return (
    <div className="page">
      <SectionTitle icon={ListTree} title="Events" sub="Cross-run event history + live SSE firehose" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          placeholder="Filter by agent DID…"
          aria-label="Filter by agent DID"
          style={{ width: 220 }}
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        />
        <input
          className="form-input"
          placeholder="Registry authority…"
          aria-label="Filter by registry authority"
          style={{ width: 180 }}
          value={registry}
          onChange={(e) => setRegistry(e.target.value)}
        />
        <select
          className="form-input"
          aria-label="Filter by event type"
          style={{ width: 180 }}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`pill${liveOn ? ' active-pill' : ''}`}
          style={{ marginLeft: 'auto' }}
          aria-pressed={liveOn}
          onClick={() => setLiveOn((v) => !v)}
        >
          <span className={`dot ${liveOn && live ? 'ok pulse' : 'err'}`} />
          {liveOn ? 'Live SSE' : 'Live off'}
        </button>
      </div>

      {history.isLoading && <LoadingSkeleton rows={6} height={42} />}
      {history.error && <ErrorPanel message={String(history.error)} />}
      {!history.isLoading && !history.error && (
        <>
          <Card>
            <EventsTable events={shown} />
          </Card>
          {visible < merged.length && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                Showing {shown.length} of {merged.length}
              </span>
              <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
