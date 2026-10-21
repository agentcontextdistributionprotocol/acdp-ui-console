'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { RunWorkbench } from '@/components/runs/run-workbench';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { useRun } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { getRunLineageGraph } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data: run, isLoading, error } = useRun(runId);
  const { data: scenarios } = useScenarios();

  // Historical runs may have finished before we connected, so seed the DAG from
  // the persisted lineage rather than waiting for the (possibly absent) terminal
  // event to carry it.
  const { data: fallbackLineage } = useQuery({
    queryKey: ['run-lineage', runId, demoMode],
    queryFn: () => getRunLineageGraph(runId, demoMode),
    enabled: !!run,
  });

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
      {/* Not a `String(error)` site, and the same over-claim: this said
          `Run not found: <id>` for EVERY error — a 503, a console-minted 401, a
          network `TypeError` — so an operator was sent looking for a run that
          may exist and be perfectly reachable in a minute.

          No local `codes` map, because none is needed: a missing run now
          arrives coded. `GET /runs/:runId` throws
          `AppException(ErrorCode.RUN_NOT_FOUND)`
          (`src/storage/run.repository.ts:154` in acdp-control-plane), and
          `operatorErrorMessage` falls back to the shared
          `CONTROL_PLANE_ERROR_CODES` map, which carries `RUN_NOT_FOUND`. A code
          beats a status arm, so against a current control plane that sentence
          renders, not `notFound`. `notFound` stays as the fallback for a 404
          that carries no code (an older control plane, or a proxy-level 404),
          and it keeps the id in the sentence. */}
      {error && (
        <ErrorPanel
          message={operatorErrorMessage(error, 'Could not load this run', {
            notFound: `no run with id ${runId} exists on this control plane.`,
          })}
          details={errorDiagnostic(error)}
        />
      )}
      {run && <RunWorkbench run={run} scenarioName={scenarioName} fallbackLineage={fallbackLineage} />}
    </div>
  );
}
