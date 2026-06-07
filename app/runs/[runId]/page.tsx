'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RunWorkbench } from '@/components/runs/run-workbench';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { useRun } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { C } from '@/lib/colors';

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { data: run, isLoading, error } = useRun(runId);
  const { data: scenarios } = useScenarios();

  const scenarioName = useMemo(() => {
    if (!run) return runId;
    return scenarios?.find((s) => s.id === run.scenarioId)?.name ?? run.scenarioId;
  }, [run, scenarios, runId]);

  return (
    <div className="page">
      <Link
        href="/runs"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, marginBottom: 12 }}
      >
        <ArrowLeft size={13} /> All runs
      </Link>

      {isLoading && <LoadingPanel label="Loading run…" />}
      {error && <ErrorPanel message={`Run not found: ${runId}`} />}
      {run && <RunWorkbench run={run} scenarioName={scenarioName} />}
    </div>
  );
}
