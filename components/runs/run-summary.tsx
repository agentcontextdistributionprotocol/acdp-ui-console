'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { elapsed } from '@/lib/utils/format';
import { shortAuthority } from '@/lib/utils/acdp';
import { C } from '@/lib/colors';
import type { CpRun } from '@/lib/types';
import type { LiveStatus } from '@/lib/hooks/use-live-run';

export function RunSummary({
  run,
  scenarioName,
  liveStatus,
  contextsCount,
}: {
  run: CpRun;
  scenarioName: string;
  liveStatus: LiveStatus;
  contextsCount: number;
}) {
  const running = run.status === 'running' && liveStatus !== 'complete' && liveStatus !== 'error';
  const [, tick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // A persisted terminal run shows its true status; only a still-running run
  // reflects the live SSE transition to complete/error.
  const status =
    run.status !== 'running'
      ? run.status
      : liveStatus === 'error'
        ? 'failed'
        : liveStatus === 'complete'
          ? 'completed'
          : run.status;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>{scenarioName}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
          {run.runId} · {run.registries.map(shortAuthority).join(' + ') || 'registry-a'} · {run.scenarioId}
        </div>
      </div>
      <span style={{ marginLeft: 'auto' }}>
        <StatusBadge status={status} />
      </span>
      <span style={{ fontSize: 12, color: C.muted }}>{elapsed(run.startedAt, running ? null : run.completedAt)}</span>
      <span style={{ fontSize: 12, color: C.text }}>
        {contextsCount} context{contextsCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
