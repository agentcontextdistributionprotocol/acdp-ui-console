'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
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

const EVENT_TYPES = [
  'All types',
  'context_published',
  'context_retrieved',
  'context_retracted',
  'context_republished',
  'search_executed',
];
const PAGE = 50;

export default function EventsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [agent, setAgent] = useState('');
  const [registry, setRegistry] = useState('');
  const [type, setType] = useState('All types');
  const [liveOn, setLiveOn] = useState(false);

  const agentQ = useDebounced(agent);
  const registryQ = useDebounced(registry);

  const filter = useMemo(
    () => ({
      agentId: agentQ || undefined,
      registryAuthority: registryQ || undefined,
      eventType: type === 'All types' ? undefined : type,
      limit: PAGE,
    }),
    [agentQ, registryQ, type],
  );

  const history = useInfiniteQuery({
    queryKey: ['events', filter, demoMode],
    queryFn: ({ pageParam }) => listCpEvents({ ...filter, beforeTs: pageParam }, demoMode),
    initialPageParam: undefined as string | undefined,
    // Keyset cursor: the oldest row's timestamp becomes the next page's `beforeTs`.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const { events: liveEvents, live } = useGlobalEvents(liveOn);

  // Flatten every fetched page, deduping by id (the boundary row of a keyset page
  // can repeat) and folding the live SSE feed on top of the persisted history.
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    const stream = liveOn ? liveEvents : [];
    for (const e of [...stream, ...(history.data?.pages.flatMap((p) => p.data) ?? [])]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [liveOn, liveEvents, history.data]);

  const total = history.data?.pages[0]?.total;
  const shown = merged;

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
          {(history.hasNextPage || total != null) && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                Showing {shown.length}
                {total != null ? ` of ${total}` : ''}
              </span>
              {history.hasNextPage && (
                <Button
                  variant="secondary"
                  disabled={history.isFetchingNextPage}
                  onClick={() => history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
