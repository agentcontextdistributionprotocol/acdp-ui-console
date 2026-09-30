'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  listRevocations,
  getRegistryJwks,
  getLogWitness,
  listLogWitnessAlerts,
} from '@/lib/api/client';
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

/**
 * The transparency-log alert worklist across every witnessed authority (#84).
 *
 * `includeAcknowledged` is in the query key: the two listings are different
 * responses from the same endpoint, and sharing a cache entry would serve the
 * filtered list to a caller that asked for the full one.
 *
 * **The parameter is REQUIRED, deliberately — it has no default.** Upstream,
 * acknowledging an alert does not resolve it: `acknowledgeAlert` writes
 * `acknowledgedAt`/`acknowledgedBy` and leaves `alerted = true`, and the row
 * only leaves the worklist when the underlying condition clears via
 * `advanceCursor`. So `false` hides alerts that are still outstanding, and
 * which of the two listings a surface wants is a judgement about what that
 * surface then CLAIMS about an empty result — never something to inherit
 * silently from a default. A caller must say which listing it means, and its
 * empty-state copy must match the answer.
 *
 * This is a thin wrapper by design, which is why `use-security.ts` may stay on
 * `vitest.config.mts`'s named hook-exclude list. Per `CLAUDE.md`, a hook here
 * that grows real aggregation logic comes OFF that list, as `use-trust.ts` did
 * — any filtering, sorting or counting of these rows belongs in the component
 * or in `lib/utils/`, not here.
 */
export function useLogWitnessAlerts(includeAcknowledged: boolean) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['log-witness-alerts', includeAcknowledged, demoMode],
    queryFn: () => listLogWitnessAlerts({ includeAcknowledged }, demoMode),
    retry: false,
  });
}
