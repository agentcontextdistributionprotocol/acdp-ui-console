'use client';

import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { RunsTable } from '@/components/runs/runs-table';
import { useRuns } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import type { RunStatus } from '@/lib/types';

const STATUS_FILTERS: { id: 'all' | RunStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

export default function RunsPage() {
  const [status, setStatus] = useState<'all' | RunStatus>('all');
  const { data, isLoading, error } = useRuns(status === 'all' ? {} : { status });
  const { data: scenarios } = useScenarios();

  const scenarioName = useMemo(() => {
    const map = new Map((scenarios ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [scenarios]);

  return (
    <div className="page">
      <SectionTitle
        icon={Play}
        title="Runs"
        sub={`${data?.total ?? 0} runs`}
        right={
          <div className="topbar-pills">
            {STATUS_FILTERS.map((f) => (
              <div
                key={f.id}
                className={`pill${status === f.id ? ' active-pill' : ''}`}
                onClick={() => setStatus(f.id)}
              >
                {f.label}
              </div>
            ))}
          </div>
        }
      />

      {isLoading && <LoadingSkeleton rows={6} height={44} />}
      {error && <ErrorPanel message={String(error)} />}
      {data && (
        <Card>
          <RunsTable runs={data.data} scenarioName={scenarioName} />
        </Card>
      )}
    </div>
  );
}
