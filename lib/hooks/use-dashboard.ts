'use client';

import { useQuery } from '@tanstack/react-query';
import { getCpDashboard } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

export function useDashboard(window = '24h') {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['dashboard', window, demoMode],
    queryFn: () => getCpDashboard(window, demoMode),
    refetchInterval: 30_000,
  });
}
