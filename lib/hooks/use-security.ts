'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listRevocations, getRegistryJwks, getLogWitness } from '@/lib/api/client';
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

/**
 * Transparency-log witness state for one DNS authority. Keyed by the authority
 * string rather than `RegistryAuthority` because this endpoint is
 * control-plane-side and covers every enrolled registry, not just the two the
 * console proxies directly.
 *
 * `retry: false` matters more than usual here: a 404 is the expected answer for
 * an authority with no witness state, and retrying it is pure waste.
 */
export function useLogWitness(authority: string) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['log-witness', authority, demoMode],
    queryFn: () => getLogWitness(authority, demoMode),
    retry: false,
  });
}
