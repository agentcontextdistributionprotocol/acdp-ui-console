'use client';

import { useEffect, useRef, useState } from 'react';
import { getMockRunEvents } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { LineageGraph, StepEvent } from '@/lib/types';

export type LiveStatus = 'connecting' | 'live' | 'complete' | 'error';

const MAX_EVENTS = 500;
const MAX_RECONNECT = 8;
const DEMO_INTERVAL = 600;

function terminal(type: string): LiveStatus | null {
  if (type === 'run.complete') return 'complete';
  if (type === 'run.error') return 'error';
  return null;
}

/**
 * Subscribes to a run's event stream. Demo mode replays the recorded mock
 * stream; real mode connects to the SSE relay with exponential-backoff
 * reconnect.
 */
export function useLiveRun(runId: string) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [lineage, setLineage] = useState<LineageGraph | undefined>(undefined);
  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setEvents([]);
    setStatus('connecting');
    setLineage(undefined);
    retriesRef.current = 0;

    const append = (ev: StepEvent) => {
      setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), ev]);
      if (ev.lineage_graph) setLineage(ev.lineage_graph);
      const t = terminal(ev.type);
      if (t) setStatus(t);
    };

    // ── Demo replay ──────────────────────────────────────────────────
    if (demoMode) {
      const frames = getMockRunEvents(runId);
      setStatus('live');
      frames.forEach((frame, i) => {
        const timer = setTimeout(() => append(frame), i * DEMO_INTERVAL);
        timersRef.current.push(timer);
      });
      return () => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
      };
    }

    // ── Real SSE ─────────────────────────────────────────────────────
    let closed = false;
    const connect = () => {
      if (closed) return;
      const es = new EventSource(`/api/stream/runs/${encodeURIComponent(runId)}`);
      esRef.current = es;

      es.onopen = () => {
        retriesRef.current = 0;
        setStatus('live');
      };

      const onData = (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as StepEvent;
          append(ev);
        } catch {
          /* ignore non-JSON keepalive frames */
        }
      };
      es.onmessage = onData;

      es.addEventListener('end', () => {
        setStatus((s) => (s === 'live' || s === 'connecting' ? 'complete' : s));
        es.close();
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (closed) return;
        if (retriesRef.current >= MAX_RECONNECT) {
          setStatus('error');
          return;
        }
        const delay = Math.min(1000 * 2 ** retriesRef.current, 15_000);
        retriesRef.current += 1;
        const timer = setTimeout(connect, delay);
        timersRef.current.push(timer);
      };
    };

    connect();

    return () => {
      closed = true;
      esRef.current?.close();
      esRef.current = null;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [runId, demoMode]);

  return { events, status, lineage };
}
