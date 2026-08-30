import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from '@/lib/hooks/use-now';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useNow', () => {
  it('returns a timestamp close to Date.now() on first render', () => {
    const before = Date.now();
    const { result } = renderHook(() => useNow());
    expect(result.current).toBeGreaterThanOrEqual(before);
  });

  it('advances after the interval elapses', () => {
    const { result } = renderHook(() => useNow(30_000));
    const first = result.current;
    vi.setSystemTime(first + 30_000);
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBeGreaterThan(first);
  });

  it('honors a custom interval', () => {
    const { result } = renderHook(() => useNow(1_000));
    const first = result.current;
    vi.setSystemTime(first + 1_000);
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(first);
    vi.setSystemTime(first + 1_000);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeGreaterThan(first);
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { result, unmount } = renderHook(() => useNow(30_000));
    const first = result.current;
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    vi.setSystemTime(first + 60_000);
    act(() => vi.advanceTimersByTime(60_000));
    // No further update is observable post-unmount (the hook's own state is
    // detached), but clearing the interval is the behavior under test.
    expect(result.current).toBe(first);
  });
});
