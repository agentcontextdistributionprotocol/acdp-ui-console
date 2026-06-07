'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { shortId, timeAgo, elapsed } from '@/lib/utils/format';
import { shortAuthority } from '@/lib/utils/acdp';
import { pressable } from '@/lib/utils/a11y';
import type { CpRun } from '@/lib/types';

export function RunsTable({ runs, scenarioName }: { runs: CpRun[]; scenarioName: (id: string) => string }) {
  const router = useRouter();
  if (runs.length === 0) return <EmptyState title="No runs match these filters" />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Scenario</th>
          <th>Status</th>
          <th>Contexts</th>
          <th>Registries</th>
          <th>Started</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId} {...pressable(() => router.push(`/runs/${run.runId}`), `Open run ${run.runId}`)}>
            <td className="did">{shortId(run.runId, 12, 4)}</td>
            <td>{scenarioName(run.scenarioId)}</td>
            <td>
              <StatusBadge status={run.status} />
            </td>
            <td>{run.contextsCount}</td>
            <td>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {run.registries.map((r) => (
                  <span key={r} className="chip">
                    {shortAuthority(r)}
                  </span>
                ))}
              </div>
            </td>
            <td style={{ color: 'var(--muted)' }}>{timeAgo(run.startedAt)}</td>
            <td style={{ color: 'var(--muted)' }}>
              {run.completedAt ? elapsed(run.startedAt, run.completedAt) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
