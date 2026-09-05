'use client';

import { useEffect, useRef, useState } from 'react';
import { listCpEvents } from '@/lib/api/client';
import { confirmSessionOrRedirect } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpContextEvent } from '@/lib/types';

const MAX = 100;

function normalize(raw: Record<string, unknown>): CpContextEvent {
  const eventType = String(raw.eventType ?? raw.type ?? 'event');
  const eventTs = String(raw.eventTs ?? raw.created_at ?? raw.ts ?? new Date().toISOString());
  const runId = (raw.runId ?? raw.run_id) as string | undefined;
  const ctxId = (raw.ctxId ?? raw.ctx_id) as string | undefined;
  // Prefer a server id; otherwise derive a stable key from identifying fields so
  // the same logical event dedups across SSE + history and React keys are stable.
  const id = String(
    raw.id ?? raw.event_id ?? `${runId ?? ''}:${ctxId ?? ''}:${eventTs}:${eventType}`,
  );
  return {
    id,
    eventType,
    eventTs,
    runId,
    ctxId,
    lineageId: (raw.lineageId ?? raw.lineage_id) as string | undefined,
    agentId: String(raw.agentId ?? raw.agent_id ?? ''),
    contextType: (raw.contextType ?? raw.context_type) as string | undefined,
    visibility: raw.visibility as string | undefined,
    version: raw.version as number | undefined,
    registryAuthority: String(raw.registryAuthority ?? raw.registry_authority ?? ''),
    scenarioId: (raw.scenarioId ?? raw.scenario_id) as string | undefined,
    keyFingerprint: (raw.keyFingerprint ?? raw.key_fingerprint) as string | undefined,
    receiptPresent: (raw.receiptPresent ?? raw.receipt_present) as boolean | undefined,
  };
}

/**
 * Live global event feed. In demo mode it replays mock events on a timer; in
 * real mode it subscribes to the control-plane SSE relay.
 */
export function useGlobalEvents(enabled: boolean) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [events, setEvents] = useState<CpContextEvent[]>([]);
  const [connected, setConnected] = useState(false);
  // True once the browser has given up for good (readyState CLOSED) and this
  // hook — which never reconnects itself — will not open a new stream on its
  // own. Distinct from the ordinary "not yet connected" state (initial open,
  // or a transient blip the browser is still retrying at readyState
  // CONNECTING), so callers can avoid promising an automatic retry that
  // won't happen.
  const [dropped, setDropped] = useState(false);
  const live = enabled && connected;
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    if (demoMode) {
      let cancelled = false;
      listCpEvents({ limit: MAX }, true).then((res) => {
        if (cancelled) return;
        setEvents(res.data);
        setConnected(true);
      });
      return () => {
        cancelled = true;
        setConnected(false);
      };
    }

    const es = new EventSource('/api/stream/events');
    esRef.current = es;
    es.onopen = () => setConnected(true);
    const handle = (e: MessageEvent) => {
      try {
        const ev = normalize(JSON.parse(e.data));
        setEvents((prev) => [ev, ...prev].slice(0, MAX));
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onmessage = handle;
    // Named SSE events relayed by the control plane. Wire names are the
    // registry webhook body's snake_case `type` (serde `rename_all =
    // "snake_case"` on WebhookEvent), forwarded verbatim as the SSE `event:`
    // line — the dotted `context.retracted` form only ever appears in the
    // X-ACDP-Event HTTP header, never on the SSE stream.
    // `context_retracted` / `context_republished` are the RFC-ACDP-0013
    // lifecycle events (ACDP 0.3).
    [
      'context_published',
      'context_retrieved',
      'context_retracted',
      'context_republished',
      'search_executed',
    ].forEach((t) => es.addEventListener(t, handle as EventListener));
    es.onerror = () => {
      setConnected(false);
      // This hook never manually closes/reconnects — it relies on the
      // browser's own EventSource retry. A transient blip leaves readyState
      // CONNECTING (the browser is already retrying on its own); readyState
      // only lands on CLOSED when the browser has given up for good, which
      // is exactly what happens when the gate rejects the reconnect with a
      // fatal 401 because the operator's session expired mid-session. Only
      // that terminal case is worth a confirm request — and it's also the
      // only case where `dropped` should flip, since CONNECTING means a
      // retry genuinely is in flight.
      if (es.readyState === EventSource.CLOSED) {
        setDropped(true);
        void confirmSessionOrRedirect();
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
      setDropped(false);
    };
  }, [enabled, demoMode]);

  return { events, live, dropped };
}
