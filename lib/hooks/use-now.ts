'use client';

import { useEffect, useState } from 'react';

/**
 * Current time in ms, refreshed on an interval. Use in place of `Date.now()`
 * during render — calling `Date.now()` directly in a render body is impure
 * (react-hooks/purity) and, worse, means staleness badges only re-evaluate
 * when something else happens to trigger a re-render.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
