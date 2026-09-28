'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableScroll } from '@/components/ui/table-scroll';
import { timeAgo } from '@/lib/utils/format';
import { pressable } from '@/lib/utils/a11y';
import type { CpRun } from '@/lib/types';

export function RecentRunsTable({ runs, scenarioName }: { runs: CpRun[]; scenarioName: (id: string) => string }) {
  const router = useRouter();
  if (runs.length === 0) return <EmptyState title="No runs yet" description="Launch a scenario to see runs here." />;
  return (
    <TableScroll label="Recent runs, scrollable">
      <table className="data-table">
        <caption className="sr-only">Recent runs: scenario, status, context count and start time</caption>
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
            <tr key={run.runId} {...pressable(() => router.push(`/runs/${run.runId}`), `Open run ${run.runId}`)}>
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
    </TableScroll>
  );
}
