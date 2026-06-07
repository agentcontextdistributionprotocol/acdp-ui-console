'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { timeAgo } from '@/lib/utils/format';
import type { CpRun } from '@/lib/types';

export function RecentRunsTable({ runs, scenarioName }: { runs: CpRun[]; scenarioName: (id: string) => string }) {
  const router = useRouter();
  if (runs.length === 0) return <EmptyState title="No runs yet" description="Launch a scenario to see runs here." />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Status</th>
          <th>Contexts</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId} onClick={() => router.push(`/runs/${run.runId}`)}>
            <td>{scenarioName(run.scenarioId)}</td>
            <td>
              <StatusBadge status={run.status} />
            </td>
            <td>{run.contextsCount}</td>
            <td style={{ color: 'var(--muted)' }}>{timeAgo(run.startedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
