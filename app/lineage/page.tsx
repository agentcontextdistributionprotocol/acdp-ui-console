'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { LineageDag } from '@/components/runs/lineage-dag-lazy';
import { ContextInspector } from '@/components/runs/context-inspector';
import { ContextDetail } from '@/components/contexts/context-detail';
import { LineageChain } from '@/components/contexts/lineage-chain';
import { useRuns } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { getRunLineageGraph, getLineage } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';
import type { FullContext, RegistryAuthority } from '@/lib/types';

type Mode = 'run' | 'lineage';

export default function LineagePage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [mode, setMode] = useState<Mode>('run');

  return (
    <div className="page">
      <SectionTitle
        icon={GitBranch}
        title="Lineage"
        sub="Cross-run context lineage explorer"
        right={
          <div className="topbar-pills">
            <button
              type="button"
              className={`pill${mode === 'run' ? ' active-pill' : ''}`}
              aria-pressed={mode === 'run'}
              onClick={() => setMode('run')}
            >
              By run
            </button>
            <button
              type="button"
              className={`pill${mode === 'lineage' ? ' active-pill' : ''}`}
              aria-pressed={mode === 'lineage'}
              onClick={() => setMode('lineage')}
            >
              By lineage_id
            </button>
          </div>
        }
      />
      {mode === 'run' ? <ByRun demoMode={demoMode} /> : <ByLineage demoMode={demoMode} />}
    </div>
  );
}

function ByRun({ demoMode }: { demoMode: boolean }) {
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
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <select className="form-input" style={{ width: 320 }} value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
          {runs.map((r) => (
            <option key={r.runId} value={r.runId}>
              {scenarioName(r.scenarioId)} · {r.runId}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <LoadingSkeleton rows={1} height={420} />}
      {!isLoading && runs.length === 0 && <EmptyState title="No runs with lineage yet" />}
      {runId && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-h) - 150px)' }}>
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
    </>
  );
}

function ByLineage({ demoMode }: { demoMode: boolean }) {
  const [input, setInput] = useState('');
  const [authority, setAuthority] = useState<RegistryAuthority>('a');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [openCtx, setOpenCtx] = useState<FullContext | null>(null);

  const chain = useQuery({
    queryKey: ['lineage-chain', submitted, authority, demoMode],
    queryFn: () => getLineage(submitted!, authority, demoMode),
    enabled: !!submitted,
  });

  const lookup = () => setSubmitted(input.trim());

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          className="form-input"
          placeholder="lineage_id (e.g. lin-cashflow-001)"
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
        />
        <select
          className="form-input"
          style={{ width: 130 }}
          value={authority}
          onChange={(e) => setAuthority(e.target.value as RegistryAuthority)}
        >
          <option value="a">Registry A</option>
          <option value="b">Registry B</option>
          <option value="c">Registry C</option>
        </select>
        <Button variant="primary" onClick={lookup}>
          Resolve
        </Button>
      </div>

      {demoMode && !submitted && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
          Try <code>lin-cashflow-001</code> for a multi-version chain.
        </div>
      )}

      {chain.isLoading && <LoadingSkeleton rows={3} height={72} />}
      {chain.error && <ErrorPanel message={String(chain.error)} />}
      {chain.data && chain.data.length === 0 && <EmptyState title="No contexts for this lineage_id" />}
      {chain.data && chain.data.length > 0 && (
        <LineageChain chain={chain.data} onOpen={(ctxId) => setOpenCtx(chain.data!.find((c) => c.body.ctx_id === ctxId) ?? null)} />
      )}

      <Modal open={!!openCtx} onClose={() => setOpenCtx(null)} title={openCtx?.body.title ?? 'Context'}>
        {openCtx && <ContextDetail ctx={openCtx} />}
      </Modal>
    </>
  );
}
