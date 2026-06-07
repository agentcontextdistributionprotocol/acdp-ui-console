'use client';

import { useQuery } from '@tanstack/react-query';
import { listCpRuns, getCpRun } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { ListRunsQuery } from '@/lib/types';

export function useRuns(query: ListRunsQuery = {}) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['runs', query, demoMode],
    queryFn: () => listCpRuns(query, demoMode),
  });
}

export function useRun(runId: string) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['run', runId, demoMode],
    queryFn: () => getCpRun(runId, demoMode),
  });
}
