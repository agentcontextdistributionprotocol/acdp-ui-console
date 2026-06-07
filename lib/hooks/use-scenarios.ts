'use client';

import { useQuery } from '@tanstack/react-query';
import { listScenarios } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

export function useScenarios() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['scenarios', demoMode],
    queryFn: () => listScenarios(demoMode),
  });
}
