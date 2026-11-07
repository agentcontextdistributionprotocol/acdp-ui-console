'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableScroll } from '@/components/ui/table-scroll';
import { timeAgo } from '@/lib/utils/format';
import { pressable } from '@/lib/utils/a11y';
import type { CpRun } from '@/lib/types';
import { unobservedContextsLabel } from '@/lib/utils/run-contexts';
import { C } from '@/lib/colors';

export function RecentRunsTable({ runs, scenarioName }: { runs: CpRun[]; scenarioName: (id: string) => string }) {
  const router = useRouter();
  if (runs.length === 0) return <EmptyState title="No runs yet" description="Launch a scenario to see runs here." />;
  return (
    <TableScroll label="Recent runs">
      <table className="data-table">
        <caption className="sr-only">Recent runs: scenario, status, contexts and started</caption>
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
              <td>
                <ContextsCell run={run} />
              </td>
              <td style={{ color: 'var(--muted)' }}>{timeAgo(run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/** #197: the observed count, or the reported-but-unobserved label in its place. */
function ContextsCell({ run }: { run: CpRun }) {
  const label = unobservedContextsLabel(run.contextsCount, run);
  if (!label) return <>{run.contextsCount}</>;
  return <span style={{ fontSize: 11, color: C.muted }}>{label}</span>;
}
