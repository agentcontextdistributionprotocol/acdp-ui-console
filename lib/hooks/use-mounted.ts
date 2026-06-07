'use client';

import { useEffect, useState } from 'react';

/**
 * Returns false on the server / first client render, true after mount. Use to
 * gate UI that depends on persisted (localStorage) state so SSR and the first
 * client paint agree, avoiding hydration mismatches.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
