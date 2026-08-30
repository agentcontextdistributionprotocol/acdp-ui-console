import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { useMounted } from '@/lib/hooks/use-mounted';

describe('useMounted', () => {
  it('reports true once the mount effect has run', () => {
    const { result } = renderHook(() => useMounted());
    expect(result.current).toBe(true);
  });

  it('stays true across re-renders', () => {
    const { result, rerender } = renderHook(() => useMounted());
    rerender();
    expect(result.current).toBe(true);
  });

  it('returns the server snapshot (false) when rendered to a string', () => {
    function Probe() {
      return String(useMounted());
    }
    expect(renderToString(createElement(Probe))).toBe('false');
  });
});
