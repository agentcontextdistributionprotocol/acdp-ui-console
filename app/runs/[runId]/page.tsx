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

          No `codes` map, despite `RUN_NOT_FOUND` existing in the control
          plane's enum (`src/errors/error-codes.ts:2`): `GET /runs/:runId` lands
          in `src/storage/run.repository.ts:145`, which throws a bare
          `NotFoundException`, and Nest's default object body already carries an
          `error` key (the string `'Not Found'`), so `withAcdpEnvelope`
          (`exception.filter.ts:72`) leaves it alone and no `errorCode` is ever
          minted for this route. A map keyed on a code that
          cannot arrive would be copy no test could honestly exercise. The 404
          arm does the work instead, via `notFound`, which keeps the id in the
          sentence — the one genuinely useful part of the old string. */}
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
