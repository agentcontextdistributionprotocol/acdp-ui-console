'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, Boxes, Users, Database, Layers, ShieldAlert } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { RecentRunsTable } from '@/components/dashboard/recent-runs-table';
import { EventTicker } from '@/components/dashboard/event-ticker';
import { RegistryHealthBar } from '@/components/dashboard/registry-health-bar';
import { ReceiptCoverageBars, DidMethodBars } from '@/components/trust/coverage-bars';
import dynamic from 'next/dynamic';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '@/lib/hooks/use-dashboard';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { formatNumber } from '@/lib/utils/format';
import { dashboardRevocationReported } from '@/lib/utils/revocation';

// recharts is heavy; keep it out of the initial bundle.
const BarChartCard = dynamic(
  () => import('@/components/charts/bar-chart-card').then((m) => m.BarChartCard),
  { ssr: false, loading: () => <div className="skeleton" style={{ height: 200 }} /> },
);

// Exactly the set `DashboardOverviewQueryDto` accepts upstream (`IsIn`), so no
// selection here can produce a 400. The page hard-coded '24h' while captioning
// itself "window 24h", which made a window-scoped figure look absolute — and,
// with every revocation counter window-scoped too, left the Key Revocation
// card's not-reported state unreachable without editing code.
const WINDOWS: { value: string; label: string }[] = [
  { value: '1h', label: 'Last 1 h' },
  { value: '6h', label: 'Last 6 h' },
  { value: '24h', label: 'Last 24 h' },
  { value: '7d', label: 'Last 7 d' },
  { value: '30d', label: 'Last 30 d' },
];

export default function DashboardPage() {
  // NOT named `window` — that shadows the global, and this file's `dynamic()`
  // import is SSR-disabled precisely because it needs the real one.
  const [dashWindow, setDashWindow] = useState('24h');
  const dash = useDashboard(dashWindow);
  const { data: scenarios } = useScenarios();
  const { events, live } = useGlobalEvents(true);

  const windowLabel = WINDOWS.find((w) => w.value === dashWindow)?.label ?? dashWindow;
  const windowPicker = (
    <select
      className="form-input"
      style={{ width: 130 }}
      aria-label="Dashboard time window"
      value={dashWindow}
      onChange={(e) => setDashWindow(e.target.value)}
    >
      {WINDOWS.map((w) => (
        <option key={w.value} value={w.value}>
          {w.label}
        </option>
      ))}
    </select>
  );

  const scenarioName = useMemo(() => {
    const map = new Map((scenarios ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [scenarios]);

  const scenarioChart = useMemo(
    () =>
      (dash.data?.byScenario ?? []).map((s) => ({
        label: scenarioName(s.scenario_id),
        value: s.run_count,
      })),
    [dash.data, scenarioName],
  );

  if (dash.isLoading) {
    return (
      <div className="page">
        <SectionTitle icon={LayoutGrid} title="Dashboard" sub={`${windowLabel} · auto-refreshes every 30 s`} right={windowPicker} />
        <LoadingPanel label="Loading dashboard…" />
      </div>
    );
  }
  if (dash.error || !dash.data) {
    return (
      <div className="page">
        {/* The picker stays on the error path too — otherwise a window whose
            query failed is unrecoverable without a reload. */}
        <SectionTitle icon={LayoutGrid} title="Dashboard" right={windowPicker} />
        <ErrorPanel message={String(dash.error ?? 'Dashboard data unavailable.')} />
      </div>
    );
  }

  const d = dash.data;

  return (
    <div className="page">
      <SectionTitle icon={LayoutGrid} title="Dashboard" sub={`${windowLabel} · auto-refreshes every 30 s`} right={windowPicker} />

      <div className="kpi-grid">
        <KpiCard label="Total Runs" value={formatNumber(d.totalRuns)} delta={`window ${d.window}`} deltaTone="muted" accent="var(--brand)" icon={<Layers size={28} />} />
        <KpiCard label="Contexts Published" value={formatNumber(d.totalContexts)} accent="var(--info)" icon={<Boxes size={28} />} />
        <KpiCard label="Active Agents" value={formatNumber(d.totalAgents)} accent="var(--purple)" icon={<Users size={28} />} />
        <KpiCard label="Registries" value={formatNumber(d.byRegistry.length)} delta="● all healthy" accent="var(--warning)" icon={<Database size={28} />} />
      </div>

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <Card>
          {/* No "Most recent 0" — an empty window gets the table's own
              "No runs yet" empty state and no count to contradict it. */}
          <CardHeader
            title="Recent Runs"
            sub={d.recentRuns.length > 0 ? `Most recent ${d.recentRuns.length}` : undefined}
          />
          <RecentRunsTable runs={d.recentRuns} scenarioName={scenarioName} />
        </Card>
        <Card>
          <CardHeader title="Live Events" right={<Badge variant={live ? 'running' : 'neutral'}>{live ? '● live' : '○ idle'}</Badge>} />
          <EventTicker events={events} />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader title="Runs by Scenario" sub={windowLabel} />
          <CardBody>
            <BarChartCard data={scenarioChart} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Events by Registry" />
          <CardBody>
            <RegistryHealthBar byRegistry={d.byRegistry} />
          </CardBody>
        </Card>
      </div>

      {(d.receiptCoverage || d.didMethods) && (
        <div className="grid-2" style={{ marginTop: 12 }}>
          <Card>
            <CardHeader title="Receipt Coverage" sub="RFC-ACDP-0010 · receipts per publish" />
            <CardBody>
              <ReceiptCoverageBars coverage={d.receiptCoverage ?? []} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Producer DID Methods" sub="did:web vs did:key adoption" />
            <CardBody>
              <DidMethodBars methods={d.didMethods ?? []} />
            </CardBody>
          </Card>
        </div>
      )}

      {/* The card ALWAYS renders. A card that silently vanishes is
          indistinguishable from a backend that predates the feature, and the
          operator learns nothing either way — so when revocation was not
          reported, the card stays and says so in words instead of showing
          three confident zeros. */}
      <Card style={{ marginTop: 12 }}>
        <CardHeader
          title="Key Revocation"
          // Precise about the limitation rather than broad: upstream's
          // `docs/API.md` records that a retroactive re-audit deliberately
          // never touches `checked_at`, so an amendment to an event this
          // window has already scrolled past stays invisible here. An
          // amendment to an event still INSIDE the window IS reflected —
          // saying "a retroactive re-audit is not reflected" overstated it.
          sub="RFC-ACDP-0014 · window-scoped compromise-boundary checks · counted at audit time, so a re-audit amending an event older than this window is not reflected here"
          right={<ShieldAlert size={18} style={{ color: 'var(--danger)' }} />}
        />
        <CardBody>
          {!dashboardRevocationReported(d.keyRevocation) ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text)' }}>
                Revocation checking is not reported by this deployment.
              </strong>
              <br />
              No figures are shown rather than zeros: the control plane emits these counters
              whether or not the check ran, and the check is disabled by default — so a zero here
              would claim &ldquo;nothing is revoked&rdquo; without having looked. Figures appear as
              soon as anything is classified. Tracked upstream as{' '}
              <span className="did">acdp-control-plane#176</span>.
            </div>
          ) : (
            <div className="kpi-grid">
              <KpiCard
                label="Pre-compromise (authorized)"
                value={formatNumber(d.keyRevocation!.preCompromise)}
                accent="var(--success)"
                hint="Signed strictly before the compromise boundary — historically authorized"
              />
              <KpiCard
                label="Revoked at/after boundary"
                value={formatNumber(d.keyRevocation!.revokedAtOrAfter)}
                accent="var(--danger)"
                hint="Fails closed under the strict profile — not attributable to the producer"
              />
              <KpiCard
                label="Revoked time unverifiable"
                value={formatNumber(d.keyRevocation!.revokedTimeUnverifiable)}
                accent="var(--warning)"
                hint="No receipt-attested publish time to compare against the compromise boundary"
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
