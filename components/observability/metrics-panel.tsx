'use client';

import { useQuery } from '@tanstack/react-query';
import { getCpMetrics } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber } from '@/lib/utils/format';

export function MetricsPanel() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading, error } = useQuery({
    queryKey: ['metrics', demoMode],
    queryFn: () => getCpMetrics(demoMode),
    refetchInterval: 20_000,
  });

  if (isLoading) return <LoadingSkeleton rows={5} height={28} />;
  if (error) return <ErrorPanel message={String(error)} />;
  if (!data || data.length === 0) return <EmptyState title="No metrics available" />;

  return (
    <div>
      {data.map((m) => (
        <div key={m.name} className="metric-row" title={m.help}>
          <span className="metric-name">{m.name}</span>
          <span className="metric-type">{m.type}</span>
          <span className="metric-val">{formatNumber(m.value)}</span>
        </div>
      ))}
    </div>
  );
}
