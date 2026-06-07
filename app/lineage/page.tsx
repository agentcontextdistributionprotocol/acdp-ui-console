'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { LineageDag } from '@/components/runs/lineage-dag-lazy';
import { ContextInspector } from '@/components/runs/context-inspector';
import { useRuns } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { getRunLineageGraph } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

export default function LineagePage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data: runsData, isLoading } = useRuns({});
  const { data: scenarios } = useScenarios();
  const [runId, setRunId] = useState<string | null>(null);
  const [activeCtx, setActiveCtx] = useState<string | null>(null);

  const runs = useMemo(() => (runsData?.data ?? []).filter((r) => r.contextsCount > 0), [runsData]);

  useEffect(() => {
    if (!runId && runs.length > 0) setRunId(runs[0].runId);
  }, [runs, runId]);

  const scenarioName = (id: string) => scenarios?.find((s) => s.id === id)?.name ?? id;

  const lineage = useQuery({
    queryKey: ['lineage-graph', runId, demoMode],
    queryFn: () => getRunLineageGraph(runId!, demoMode),
    enabled: !!runId,
  });

  return (
    <div className="page">
      <SectionTitle
        icon={GitBranch}
        title="Lineage"
        sub="Cross-run context lineage explorer"
        right={
          <select className="form-input" style={{ width: 280 }} value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {scenarioName(r.scenarioId)} · {r.runId}
              </option>
            ))}
          </select>
        }
      />

      {isLoading && <LoadingSkeleton rows={1} height={420} />}
      {!isLoading && runs.length === 0 && <EmptyState title="No runs with lineage yet" />}
      {runId && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-h) - 110px)' }}>
          <div className="feed-header">
            <h2>Lineage Graph</h2>
            <span className="card-sub">
              {lineage.data?.nodes.length ?? 0} contexts · {lineage.data?.edges.length ?? 0} edges
            </span>
          </div>
          {lineage.error && <ErrorPanel message={String(lineage.error)} />}
          {lineage.data && (
            <LineageDag graph={lineage.data} activeCtx={activeCtx ?? undefined} onSelectCtx={setActiveCtx} />
          )}
          <ContextInspector ctxId={activeCtx} />
        </div>
      )}
    </div>
  );
}
