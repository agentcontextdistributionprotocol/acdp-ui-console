'use client';

import { useQuery } from '@tanstack/react-query';
import { listRegistries, getRegistryCapabilities } from '@/lib/api/client';
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
