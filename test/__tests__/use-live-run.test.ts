import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLiveRun } from '@/lib/hooks/use-live-run';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpContextEvent } from '@/lib/types';

const getCpRunEvents = vi.fn();
const getMockRunEvents = vi.fn();

vi.mock('@/lib/api/client', () => ({
  getCpRunEvents: (...args: unknown[]) => getCpRunEvents(...args),
  getMockRunEvents: (...args: unknown[]) => getMockRunEvents(...args),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: EventListener) {
    (this.listeners[type] ??= []).push(cb as (e: MessageEvent) => void);
  }

  removeEventListener(type: string, cb: EventListener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== (cb as unknown));
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  emitNamed(type: string, data?: unknown) {
    (this.listeners[type] ?? []).forEach((cb) =>
      cb(new MessageEvent(type, { data: data !== undefined ? JSON.stringify(data) : undefined })),
    );
  }

  emitError() {
    this.onerror?.();
  }
}

function cpEvent(overrides: Partial<CpContextEvent> = {}): CpContextEvent {
  return {
    id: 'ev-1',
    eventType: 'context_published',
    eventTs: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    agentId: 'agent-1',
    registryAuthority: 'a',
    ...overrides,
  } as CpContextEvent;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  usePreferencesStore.setState({ demoMode: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useLiveRun', () => {
  it('appends events received over the stream', async () => {
    const { result } = renderHook(() => useLiveRun('run-1'));
    const es = FakeEventSource.instances[0];
    expect(es).toBeDefined();

    act(() => es.emitMessage({ type: 'agent.started', run_id: 'run-1', ts: 't1' }));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].type).toBe('agent.started');
  });

  it('caps the event buffer at MAX_EVENTS (500)', async () => {
    const { result } = renderHook(() => useLiveRun('run-1'));
    const es = FakeEventSource.instances[0];

    act(() => {
      for (let i = 0; i < 510; i++) {
        es.emitMessage({ type: 'llm.thinking', run_id: 'run-1', ts: `t${i}` });
      }
    });
    await waitFor(() => expect(result.current.events).toHaveLength(500));
    // The oldest 10 were dropped — the buffer keeps the newest 500.
    expect(result.current.events[0].ts).toBe('t10');
    expect(result.current.events[499].ts).toBe('t509');
  });

  it('maps a terminal event type to a terminal status', async () => {
    const { result } = renderHook(() => useLiveRun('run-1'));
    const es = FakeEventSource.instances[0];

    act(() => es.emitMessage({ type: 'run.complete', run_id: 'run-1', ts: 't1' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));
  });

  it('changing runId resets events/status/lineage, closes the old stream, and opens a new one', async () => {
    const { result, rerender } = renderHook(({ runId }) => useLiveRun(runId), {
      initialProps: { runId: 'run-1' },
    });
    const firstEs = FakeEventSource.instances[0];
    act(() => firstEs.emitOpen());
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() =>
      firstEs.emitMessage({
        type: 'acdp.publish',
        run_id: 'run-1',
        ts: 't1',
        lineage_graph: { nodes: [], edges: [] },
      }),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.lineage).toBeDefined();

    rerender({ runId: 'run-2' });

    // Reset happens synchronously in render — visible immediately.
    expect(result.current.events).toEqual([]);
    expect(result.current.lineage).toBeUndefined();
    expect(result.current.status).toBe('connecting');

    expect(firstEs.closed).toBe(true);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toContain('run-2');
  });

  it('demo mode with a non-terminal run status is live from the very first render, no connecting flash', () => {
    usePreferencesStore.setState({ demoMode: true });
    getMockRunEvents.mockReturnValue([]);

    const { result } = renderHook(() => useLiveRun('run-1'));

    // Render-phase initial state — must be 'live' on frame one, not a one-frame
    // 'connecting' flash later corrected by the effect. No waitFor: this asserts
    // the synchronous value straight out of renderHook.
    expect(result.current.status).toBe('live');
  });

  it('a terminal runStatus hydrates from getCpRunEvents and opens no EventSource', async () => {
    getCpRunEvents.mockResolvedValue({
      data: [cpEvent({ id: 'a' }), cpEvent({ id: 'b' })],
    });

    const { result } = renderHook(() => useLiveRun('run-1', 'completed'));

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.events).toHaveLength(2);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('a failed runStatus resolves to the error terminal status', async () => {
    getCpRunEvents.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useLiveRun('run-1', 'failed'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('onerror leaves status non-terminal and does not throw', async () => {
    const { result } = renderHook(() => useLiveRun('run-1'));
    const es = FakeEventSource.instances[0];
    act(() => es.emitOpen());
    await waitFor(() => expect(result.current.status).toBe('live'));

    expect(() => act(() => es.emitError())).not.toThrow();
    await waitFor(() => expect(result.current.status).toBe('connecting'));
    expect(['connecting', 'live', 'error']).toContain(result.current.status);
  });

  it('a rejecting getCpRunEvents still resolves to a defined terminal state', async () => {
    getCpRunEvents.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLiveRun('run-1', 'cancelled'));
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.events).toEqual([]);
  });
});
