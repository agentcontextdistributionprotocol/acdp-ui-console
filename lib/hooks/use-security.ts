'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listRevocations, getRegistryJwks } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { RegistryAuthority } from '@/lib/types';

export function useRevocations() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useInfiniteQuery({
    queryKey: ['revocations', demoMode],
    queryFn: ({ pageParam }) => listRevocations({ since: pageParam, limit: 50 }, demoMode),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
}

export function useRegistryJwks(authority: RegistryAuthority) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['jwks', authority, demoMode],
    queryFn: () => getRegistryJwks(authority, demoMode),
    retry: false,
  });
}
