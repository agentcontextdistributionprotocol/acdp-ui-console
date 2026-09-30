'use client';

import { useQuery } from '@tanstack/react-query';
import { failureKind, listRegistries, getRegistryCapabilities } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CapabilityAuthority } from '@/lib/types';

export function useRegistries() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['registries', demoMode],
    queryFn: () => listRegistries(demoMode),
  });
}

export function useRegistryCapabilities(authority: CapabilityAuthority) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: ['registry-capabilities', authority, demoMode],
    queryFn: () => getRegistryCapabilities(authority, demoMode),
    retry: false,
  });
}

/**
 * The one word `RegistryCard`'s header renders for a capabilities probe — #129.
 *
 * The card used to render `<StatusDot tone="ok" />` / `● healthy` unconditionally,
 * for every registry, including one outside the `a`/`b` capabilities map this
 * page happens to hold (`capabilities === undefined`, never probed at all). This
 * is the verdict, computed once beside the query that measured it, so the card
 * can render a prop value instead of a literal it has no evidence for.
 *
 * **`responding`, not `healthy`.** The evidence behind this word is a
 * capabilities-endpoint 200, not a `/healthz` verdict — `useHealth`
 * (`lib/hooks/use-health.ts`) is the wrong instrument here: it has no `enabled`
 * gate by design and probes a different endpoint for a different purpose
 * (service health, not registry capability advertisement). `lastSeen` on the
 * card is a separate, existing row; recency of a past control-plane event is not
 * the same claim as a live probe answering now.
 *
 * Takes the shape of a `UseQueryResult` rather than the hook itself, so a
 * caller can pass one of the two capabilities queries `app/registries/page.tsx`
 * already holds (`useRegistryCapabilities('a' | 'b')`) without this function
 * importing React Query or subscribing to anything itself.
 *
 * In demo mode, `getRegistryCapabilities` resolves for both `a` and `b`, so
 * both cards read `responding`; the `not probed`/`degraded`/`unreachable` arms
 * are reachable only in real mode (a registry outside the map, or an actual
 * probe failure) and in this function's own unit tests.
 */
export type RegistryProbeView = { tone: 'ok' | 'warn' | 'err'; variant: string; label: string };

export function registryProbeView(q?: {
  data?: unknown;
  error?: unknown;
  isPending?: boolean;
}): RegistryProbeView {
  if (!q) return { tone: 'warn', variant: 'neutral', label: 'not probed' };
  if (q.error) return { tone: 'err', variant: 'failed', label: failureKind(q.error) };
  if (q.data !== undefined) return { tone: 'ok', variant: 'complete', label: 'responding' };
  return { tone: 'warn', variant: 'neutral', label: 'checking…' };
}
