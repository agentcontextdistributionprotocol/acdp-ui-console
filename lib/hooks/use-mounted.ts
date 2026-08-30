'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Returns false on the server / first client render, true after mount. Use to
 * gate UI that depends on persisted (localStorage) state so SSR and the first
 * client paint agree, avoiding hydration mismatches.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
