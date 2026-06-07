'use client';

import { useQuery } from '@tanstack/react-query';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { ProxyService } from '@/lib/types';

const SERVICES: { service: ProxyService; name: string; port: string }[] = [
  { service: 'playground', name: 'Playground', port: ':8000' },
  { service: 'control-plane', name: 'Control Plane', port: ':3001' },
  { service: 'registry-a', name: 'Registry A', port: ':8100' },
  { service: 'registry-b', name: 'Registry B', port: ':8200' },
];

function HealthCard({ service, name, port }: { service: ProxyService; name: string; port: string }) {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading } = useQuery({
    queryKey: ['health', service, demoMode],
    queryFn: () => pingHealth(service, demoMode),
    refetchInterval: 15_000,
    retry: false,
  });
  const ok = data?.ok ?? false;
  return (
    <div className="health-card">
      <div className="health-name">{name}</div>
      <div className="health-url">{port}</div>
      <div className="health-status">
        <span className={`dot ${ok ? 'ok' : 'err'}`} />
        <span style={{ color: ok ? 'var(--success)' : 'var(--danger)' }}>
          {isLoading ? 'checking…' : ok ? 'healthy' : 'unreachable'}
        </span>
        {data?.latencyMs !== undefined && <span className="health-latency">{data.latencyMs} ms</span>}
      </div>
    </div>
  );
}

export function HealthChecks() {
  return (
    <div className="health-grid">
      {SERVICES.map((s) => (
        <HealthCard key={s.service} {...s} />
      ))}
    </div>
  );
}
