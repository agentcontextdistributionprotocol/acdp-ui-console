'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListTree } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EventsTable } from '@/components/events/events-table';
import { listCpEvents } from '@/lib/api/client';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

const EVENT_TYPES = ['All types', 'context_published', 'context_retrieved', 'search_executed'];

export default function EventsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [agent, setAgent] = useState('');
  const [registry, setRegistry] = useState('');
  const [type, setType] = useState('All types');
  const [liveOn, setLiveOn] = useState(false);

  const filter = useMemo(
    () => ({
      agentId: agent || undefined,
      registryAuthority: registry || undefined,
      eventType: type === 'All types' ? undefined : type,
      limit: 200,
    }),
    [agent, registry, type],
  );

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

  return (
    <div className="page">
      <SectionTitle icon={ListTree} title="Events" sub="Cross-run event history + live SSE firehose" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          placeholder="Filter by agent DID…"
          style={{ width: 220 }}
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        />
        <input
          className="form-input"
          placeholder="Registry authority…"
          style={{ width: 180 }}
          value={registry}
          onChange={(e) => setRegistry(e.target.value)}
        />
        <select className="form-input" style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div
          className={`pill${liveOn ? ' active-pill' : ''}`}
          style={{ marginLeft: 'auto' }}
          onClick={() => setLiveOn((v) => !v)}
        >
          <span className={`dot ${liveOn && live ? 'ok pulse' : 'err'}`} />
          {liveOn ? 'Live SSE' : 'Live off'}
        </div>
      </div>

      {history.isLoading && <LoadingSkeleton rows={6} height={42} />}
      {history.error && <ErrorPanel message={String(history.error)} />}
      {!history.isLoading && !history.error && (
        <Card>
          <EventsTable events={merged} />
        </Card>
      )}
    </div>
  );
}
