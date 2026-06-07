'use client';

import { useEffect, useRef, useState } from 'react';
import { getCpRunEvents, getMockRunEvents } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpContextEvent, LineageGraph, RunStatus, StepEvent, StepEventType } from '@/lib/types';

export type LiveStatus = 'connecting' | 'live' | 'complete' | 'error';

const MAX_EVENTS = 500;
const MAX_RECONNECT = 8;
const DEMO_INTERVAL = 600;

function terminal(type: string): LiveStatus | null {
  if (type === 'run.complete') return 'complete';
  if (type === 'run.error') return 'error';
  return null;
}

const isTerminalRun = (status?: RunStatus) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

// Persisted control-plane event types → playground step types so the existing
// EventRow icons/colors render the historical timeline the same as a live one.
const CP_EVENT_TYPE: Record<string, StepEventType> = {
  context_published: 'acdp.publish',
  context_retrieved: 'acdp.retrieve',
  search_executed: 'acdp.search',
};

function cpEventToStep(e: CpContextEvent): StepEvent {
  return {
    type: CP_EVENT_TYPE[e.eventType] ?? (e.eventType as StepEventType),
    run_id: e.runId ?? '',
    ts: e.eventTs,
    agent_id: e.agentId || undefined,
    ctx_id: e.ctxId ?? undefined,
    derived_from: e.derivedFrom ?? [],
    registry_authority: e.registryAuthority || undefined,
    event_id: e.id,
  };
}

/**
 * Subscribes to a run's event stream.
 *
 * - **Active runs** tail the SSE relay (demo replays the recorded mock stream).
 * - **Terminal runs** (completed/failed/cancelled) finished before we connected,
 *   so we hydrate the full persisted timeline from the control-plane
 *   `/runs/{id}/events` history instead of opening a stream that no longer exists.
 */
export function useLiveRun(runId: string, runStatus?: RunStatus) {
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

    // ── Terminal run: hydrate the persisted history, no stream ────────────
    if (isTerminalRun(runStatus)) {
      let cancelled = false;
      const ended: LiveStatus = runStatus === 'failed' ? 'error' : 'complete';
      getCpRunEvents(runId, demoMode)
        .then((res) => {
          if (cancelled) return;
          // Demo keeps the richer recorded step stream; real mode maps CP events.
          const frames = demoMode ? getMockRunEvents(runId) : res.data.map(cpEventToStep);
          setEvents(frames.slice(-MAX_EVENTS));
          const carry = [...frames].reverse().find((f) => f.lineage_graph)?.lineage_graph;
          if (carry) setLineage(carry);
          setStatus(ended);
        })
        .catch(() => {
          if (!cancelled) setStatus(ended);
        });
      return () => {
        cancelled = true;
      };
    }

    // ── Demo replay (active run) ─────────────────────────────────────────
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

    // ── Real SSE (active run) ────────────────────────────────────────────
    let closed = false; // set on unmount
    let done = false; // set when the run ended cleanly (don't reconnect)
    let reconnecting = false; // guards against EventSource firing onerror repeatedly

    const connect = () => {
      if (closed || done) return;
      reconnecting = false;
      const es = new EventSource(`/api/stream/runs/${encodeURIComponent(runId)}`);
      esRef.current = es;

      es.onopen = () => {
        retriesRef.current = 0;
        setStatus('live');
      };

      es.onmessage = (e: MessageEvent) => {
        try {
          append(JSON.parse(e.data) as StepEvent);
        } catch {
          /* ignore non-JSON keepalive frames */
        }
      };

      es.addEventListener('end', () => {
        done = true;
        es.onerror = null; // a clean close must not be read as an error → reconnect
        setStatus((s) => (s === 'live' || s === 'connecting' ? 'complete' : s));
        es.close();
        esRef.current = null;
      });

      es.onerror = () => {
        es.onerror = null; // a closed socket can fire onerror repeatedly — detach
        es.close();
        esRef.current = null;
        if (closed || done || reconnecting) return;
        reconnecting = true;
        if (retriesRef.current >= MAX_RECONNECT) {
          setStatus('error');
          return;
        }
        const backoff = Math.min(1000 * 2 ** retriesRef.current, 15_000);
        retriesRef.current += 1;
        setStatus('connecting');
        timersRef.current.push(setTimeout(connect, backoff));
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
  }, [runId, runStatus, demoMode]);

  return { events, status, lineage };
}
