'use client';

import { useMemo, useState } from 'react';
import { EventFeed } from './event-feed';
import { LineageDag } from './lineage-dag-lazy';
import { ContextInspector } from './context-inspector';
import { RunSummary } from './run-summary';
import { RunTrustPanel } from './run-trust-panel';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useLiveRun } from '@/lib/hooks/use-live-run';
import { unobservedContextsLabel } from '@/lib/utils/run-contexts';
import { C } from '@/lib/colors';
import type { CpRun, LineageGraph } from '@/lib/types';

export function RunWorkbench({
  run,
  scenarioName,
  fallbackLineage,
}: {
  run: CpRun;
  scenarioName: string;
  fallbackLineage?: LineageGraph;
}) {
  const { events, status, lineage } = useLiveRun(run.runId, run.status);
  const [activeCtx, setActiveCtx] = useState<string | null>(null);

  const graph: LineageGraph = useMemo(() => {
    if (lineage && lineage.nodes.length > 0) return lineage;
    if (fallbackLineage) return fallbackLineage;
    // Derive a minimal graph from publish events seen so far.
    const nodes = events
      .filter((e) => e.type === 'acdp.publish' && e.ctx_id)
      .map((e, i) => ({
        ctx_id: e.ctx_id!,
        agent_id: e.agent_id ?? '',
        title: e.title ?? e.ctx_id!,
        context_type: 'context',
        registry_authority: e.registry_authority ?? '',
        step: i + 1,
      }));
    const edges = events
      .filter((e) => e.type === 'acdp.publish' && e.ctx_id && e.derived_from?.length)
      .map((e) => ({ src: e.derived_from![0], dst: e.ctx_id! }));
    return { nodes, edges };
  }, [lineage, fallbackLineage, events]);

  const contextsCount = graph.nodes.length;
  // #197: an empty observed graph next to a run that reported contexts is
  // labelled as such, never drawn from the self-reported list.
  const unobserved = unobservedContextsLabel(contextsCount, run);

  return (
    <>
      <RunSummary
        run={run}
        scenarioName={scenarioName}
        liveStatus={status}
        contextsCount={contextsCount}
        unobservedLabel={unobserved}
      />
      {run.trust && <RunTrustPanel trust={run.trust} />}
      <div className="workbench">
        <ErrorBoundary>
          <EventFeed events={events} status={status} onSelectCtx={setActiveCtx} />
        </ErrorBoundary>
        <div className="dag-panel">
          <div className="feed-header">
            <h2>Lineage DAG</h2>
            {!unobserved && (
              <span className="card-sub">
                {graph.nodes.length} context{graph.nodes.length === 1 ? '' : 's'} · {graph.edges.length} edge
                {graph.edges.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {unobserved ? (
            <div
              style={{
                flex: 1,
                minHeight: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 16,
                color: C.muted,
                fontSize: 12,
              }}
            >
              {unobserved}
            </div>
          ) : (
            <ErrorBoundary>
              <LineageDag graph={graph} activeCtx={activeCtx ?? undefined} onSelectCtx={setActiveCtx} />
            </ErrorBoundary>
          )}
          <ContextInspector ctxId={activeCtx} />
        </div>
      </div>
    </>
  );
}
