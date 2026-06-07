'use client';

import { useEffect, useRef, useState } from 'react';
import { listCpEvents } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpContextEvent } from '@/lib/types';

const MAX = 100;

function normalize(raw: Record<string, unknown>): CpContextEvent {
  return {
    id: String(raw.id ?? raw.event_id ?? Math.random().toString(36).slice(2)),
    eventType: String(raw.eventType ?? raw.type ?? 'event'),
    eventTs: String(raw.eventTs ?? raw.created_at ?? raw.ts ?? new Date().toISOString()),
    runId: (raw.runId ?? raw.run_id) as string | undefined,
    ctxId: (raw.ctxId ?? raw.ctx_id) as string | undefined,
    lineageId: (raw.lineageId ?? raw.lineage_id) as string | undefined,
    agentId: String(raw.agentId ?? raw.agent_id ?? ''),
    contextType: (raw.contextType ?? raw.context_type) as string | undefined,
    visibility: raw.visibility as string | undefined,
    version: raw.version as number | undefined,
    registryAuthority: String(raw.registryAuthority ?? raw.registry_authority ?? ''),
    scenarioId: (raw.scenarioId ?? raw.scenario_id) as string | undefined,
  };
}

/**
 * Live global event feed. In demo mode it replays mock events on a timer; in
 * real mode it subscribes to the control-plane SSE relay.
 */
export function useGlobalEvents(enabled: boolean) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [events, setEvents] = useState<CpContextEvent[]>([]);
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      setLive(false);
      return;
    }

    if (demoMode) {
      let cancelled = false;
      listCpEvents({ limit: MAX }, true).then((res) => {
        if (cancelled) return;
        setEvents(res.data);
        setLive(true);
      });
      return () => {
        cancelled = true;
        setLive(false);
      };
    }

    const es = new EventSource('/api/stream/events');
    esRef.current = es;
    es.onopen = () => setLive(true);
    const handle = (e: MessageEvent) => {
      try {
        const ev = normalize(JSON.parse(e.data));
        setEvents((prev) => [ev, ...prev].slice(0, MAX));
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onmessage = handle;
    ['context_published', 'context_retrieved', 'search_executed'].forEach((t) =>
      es.addEventListener(t, handle as EventListener),
    );
    es.onerror = () => setLive(false);

    return () => {
      es.close();
      esRef.current = null;
      setLive(false);
    };
  }, [enabled, demoMode]);

  return { events, live };
}
