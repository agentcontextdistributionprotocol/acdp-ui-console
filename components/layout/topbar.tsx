'use client';

import { usePathname } from 'next/navigation';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { C } from '@/lib/colors';
import { ConnectionStatus } from './connection-status';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  scenarios: 'Scenarios',
  runs: 'Runs',
  events: 'Events',
  contexts: 'Contexts',
  lineage: 'Lineage',
  agents: 'Agents',
  registries: 'Registries',
  observability: 'Observability',
  config: 'Config',
};

function breadcrumb(pathname: string): React.ReactNode {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return 'Dashboard';
  const head = LABELS[segs[0]] ?? segs[0];
  if (segs.length === 1) return head;
  return (
    <>
      {head} <span>/ {segs.slice(1).join(' / ')}</span>
    </>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">{breadcrumb(pathname)}</div>
      <div className="topbar-pills">
        <ConnectionStatus label="Playground" service="playground" />
        <ConnectionStatus label="CP" service="control-plane" />
        <ConnectionStatus label="Reg A" service="registry-a" />
        <ConnectionStatus label="Reg B" service="registry-b" />
        <button
          className="pill"
          title="Refresh all data"
          aria-label="Refresh all data"
          onClick={() => qc.invalidateQueries()}
          style={{ color: C.muted }}
        >
          <RefreshCw size={12} className={fetching ? 'spin' : ''} aria-hidden />
        </button>
      </div>
    </header>
  );
}
