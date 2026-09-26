'use client';

import { useQuery } from '@tanstack/react-query';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { pingHealth } from '@/lib/api/client';
import type { ProxyService } from '@/lib/types';

export function ConnectionStatus({ label, service }: { label: string; service: ProxyService }) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data } = useQuery({
    queryKey: ['health', service, demoMode],
    queryFn: () => pingHealth(service, demoMode),
    refetchInterval: 15_000,
    retry: false,
  });
  const ok = data?.ok ?? false;
  // `detail` distinguishes "answered, and told us it is degraded" from "never
  // answered". Both are red; only one is unreachable.
  const state = ok ? 'healthy' : (data?.detail ?? 'unreachable');
  return (
    <div className={`pill${ok ? ' active-pill' : ''}`} title={`${label}: ${state}`}>
      <span className={`dot ${ok ? 'ok' : 'err'}${ok ? ' pulse' : ''}`} />
      {label}
    </div>
  );
}
