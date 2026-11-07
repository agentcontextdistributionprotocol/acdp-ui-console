'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { elapsed, formatInstant } from '@/lib/utils/format';
import { shortAuthority, isRunDegraded, type LlmQuota } from '@/lib/utils/acdp';
import { C } from '@/lib/colors';
import type { CpRun } from '@/lib/types';
import type { LiveStatus } from '@/lib/hooks/use-live-run';

/**
 * The badge text for a run that fell back to mock LLM responses. Always says
 * why there is no reset time rather than dropping the parenthesis.
 */
export function llmQuotaChipText(q: LlmQuota): string {
  const when = q.resetsAt
    ? `resets ${formatInstant(q.resetsAt)}`
    : q.quota === 'quota_store_unavailable'
      ? 'quota store unavailable'
      : 'reset time not reported';
  return `LLM quota reached: mock responses (${when})`;
}

export function RunSummary({
  run,
  scenarioName,
  liveStatus,
  contextsCount,
  unobservedLabel,
  llmQuota,
}: {
  run: CpRun;
  scenarioName: string;
  liveStatus: LiveStatus;
  contextsCount: number;
  /** #197: replaces the count when nothing was observed but the run reported contexts. */
  unobservedLabel?: string | null;
  /** `runLlmQuota(...)`: the run hit the playground's LLM quota. */
  llmQuota?: LlmQuota | null;
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

  const degraded = isRunDegraded(run);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>{scenarioName}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
          {run.runId} · {run.registries.map(shortAuthority).join(' + ') || 'registry-a'} · {run.scenarioId}
        </div>
      </div>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {/* Text in the DOM, never a tooltip: the run's outputs came from the
            mock LLM, and an operator reading them must be told so. */}
        {llmQuota && (
          <span className="chip warn" role="status">
            {llmQuotaChipText(llmQuota)}
            {llmQuota.callsOnMock !== undefined && ` · ${llmQuota.callsOnMock} call${llmQuota.callsOnMock === 1 ? '' : 's'} on mock`}
          </span>
        )}
        {degraded && (
          <span
            className="chip warn"
            title="Offline core verified (signatures/receipts), but the live registry round-trip was unavailable in this environment — e.g. an unhosted *.playground.local DID. Not a failure."
          >
            Degraded
          </span>
        )}
        <StatusBadge status={status} />
      </span>
      <span style={{ fontSize: 12, color: C.muted }}>{elapsed(run.startedAt, running ? null : run.completedAt)}</span>
      <span style={{ fontSize: 12, color: unobservedLabel ? C.muted : C.text }}>
        {unobservedLabel ?? `${contextsCount} context${contextsCount === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
