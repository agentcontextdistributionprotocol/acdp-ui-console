'use client';

import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { RunsTable } from '@/components/runs/runs-table';
import { useRuns } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { C } from '@/lib/colors';
import type { RunStatus } from '@/lib/types';

const STATUS_FILTERS: { id: 'all' | RunStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];
const PAGE = 25;

export default function RunsPage() {
  const [status, setStatus] = useState<'all' | RunStatus>('all');
  const [visible, setVisible] = useState(PAGE);
  const { data, isLoading, error } = useRuns(status === 'all' ? {} : { status });
  const { data: scenarios } = useScenarios();

  useEffect(() => setVisible(PAGE), [status]);

  const scenarioName = useMemo(() => {
    const map = new Map((scenarios ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [scenarios]);

  const rows = data?.data ?? [];
  const shown = rows.slice(0, visible);

  return (
    <div className="page">
      <SectionTitle
        icon={Play}
        title="Runs"
        sub={`${data?.total ?? 0} runs`}
        right={
          <div className="topbar-pills">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`pill${status === f.id ? ' active-pill' : ''}`}
                aria-pressed={status === f.id}
                onClick={() => setStatus(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading && <LoadingSkeleton rows={6} height={44} />}
      {error && <ErrorPanel message={String(error)} />}
      {data && (
        <>
          <Card>
            <RunsTable runs={shown} scenarioName={scenarioName} />
          </Card>
          {visible < rows.length && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                Showing {shown.length} of {rows.length}
              </span>
              <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
