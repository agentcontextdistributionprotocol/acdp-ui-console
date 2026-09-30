'use client';

import { usePathname } from 'next/navigation';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { C } from '@/lib/colors';
import { isPublicRoute } from '@/lib/routes';
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

  // The pills say NOTHING on the sign-in screen, and this is the same honesty
  // rule as everything else in this change rather than a cosmetic exception.
  //
  // `middleware.ts` gates `/api/proxy/*` behind the session cookie, so before
  // sign-in every probe is refused by THIS console — unstamped, so `pingHealth`
  // classifies it `unreachable`, which is correct for the field's definition
  // ("nothing beyond our boundary answered") and useless as a sentence here.
  // While the word lived in a `title` nobody saw it. Now that it is visible
  // text, a sign-in screen would accuse all four services of being unreachable
  // when the only thing that happened is that the operator has not logged in —
  // and the remedy the word implies (check the network, the URL, the process)
  // is wrong in every particular.
  //
  // `redirectToLoginOn401` already no-ops on this route for the same underlying
  // reason (`lib/api/fetcher.ts`), so this is that decision followed through to
  // the surface that renders it.
  const signedOut = isPublicRoute(pathname);

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">{breadcrumb(pathname)}</div>
      <div className="topbar-pills">
        {!signedOut && (
          <>
            <ConnectionStatus label="Playground" service="playground" />
            <ConnectionStatus label="CP" service="control-plane" />
            <ConnectionStatus label="Reg A" service="registry-a" />
            <ConnectionStatus label="Reg B" service="registry-b" />
          </>
        )}
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
