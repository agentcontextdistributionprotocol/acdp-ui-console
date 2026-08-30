import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CpContextEvent } from '@/lib/types';

const listCpEvents = vi.fn();

vi.mock('@/lib/api/client', () => ({
  listCpEvents: (...args: unknown[]) => listCpEvents(...args),
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

  emitNamed(type: string, data: unknown) {
    (this.listeners[type] ?? []).forEach((cb) => cb(new MessageEvent(type, { data: JSON.stringify(data) })));
  }

  emitError() {
    this.onerror?.();
  }
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

describe('useGlobalEvents', () => {
  it('enabled: false opens no stream and live is false', () => {
    const { result } = renderHook(() => useGlobalEvents(false));
    expect(result.current.live).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('enabled: true opens a stream and live flips true on open', async () => {
    const { result } = renderHook(() => useGlobalEvents(true));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.live).toBe(false);

    act(() => FakeEventSource.instances[0].emitOpen());
    await waitFor(() => expect(result.current.live).toBe(true));
  });

  it('toggling enabled back to false closes the stream and returns live:false without a stale true frame', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useGlobalEvents(enabled), {
      initialProps: { enabled: true },
    });
    const es = FakeEventSource.instances[0];
    act(() => es.emitOpen());
    await waitFor(() => expect(result.current.live).toBe(true));

    rerender({ enabled: false });
    expect(result.current.live).toBe(false);
    expect(es.closed).toBe(true);
  });

  it('demo mode replays from listCpEvents without opening an EventSource', async () => {
    usePreferencesStore.setState({ demoMode: true });
    const events: CpContextEvent[] = [
      {
        id: 'e1',
        eventType: 'context_published',
        eventTs: '2026-01-01T00:00:00.000Z',
        agentId: 'agent-1',
        registryAuthority: 'a',
      } as CpContextEvent,
    ];
    listCpEvents.mockResolvedValue({ data: events, total: 1 });

    const { result } = renderHook(() => useGlobalEvents(true));
    await waitFor(() => expect(result.current.live).toBe(true));
    expect(result.current.events).toEqual(events);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('onerror leaves live false and does not throw', async () => {
    const { result } = renderHook(() => useGlobalEvents(true));
    const es = FakeEventSource.instances[0];
    act(() => es.emitOpen());
    await waitFor(() => expect(result.current.live).toBe(true));

    expect(() => act(() => es.emitError())).not.toThrow();
    await waitFor(() => expect(result.current.live).toBe(false));
  });

  it('normalizes and prepends incoming named events, capped at MAX (100)', async () => {
    const { result } = renderHook(() => useGlobalEvents(true));
    const es = FakeEventSource.instances[0];
    act(() => es.emitOpen());
    await waitFor(() => expect(result.current.live).toBe(true));

    act(() =>
      es.emitNamed('context_published', {
        eventType: 'context_published',
        eventTs: '2026-01-01T00:00:00.000Z',
        runId: 'run-1',
        agentId: 'agent-1',
      }),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].eventType).toBe('context_published');
  });
});
