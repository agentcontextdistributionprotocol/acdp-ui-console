'use client';

import { useMemo } from 'react';
import { LayoutGrid, Boxes, Users, Database, Layers } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { RecentRunsTable } from '@/components/dashboard/recent-runs-table';
import { EventTicker } from '@/components/dashboard/event-ticker';
import { RegistryHealthBar } from '@/components/dashboard/registry-health-bar';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '@/lib/hooks/use-dashboard';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { formatNumber } from '@/lib/utils/format';

export default function DashboardPage() {
  const dash = useDashboard('24h');
  const { data: scenarios } = useScenarios();
  const { events, live } = useGlobalEvents(true);

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
        <SectionTitle icon={LayoutGrid} title="Dashboard" sub="Last 24 h · auto-refreshes every 30 s" />
        <LoadingPanel label="Loading dashboard…" />
      </div>
    );
  }
  if (dash.error || !dash.data) {
    return (
      <div className="page">
        <SectionTitle icon={LayoutGrid} title="Dashboard" />
        <ErrorPanel message={String(dash.error ?? 'Dashboard data unavailable.')} />
      </div>
    );
  }

  const d = dash.data;

  return (
    <div className="page">
      <SectionTitle icon={LayoutGrid} title="Dashboard" sub="Last 24 h · auto-refreshes every 30 s" />

      <div className="kpi-grid">
        <KpiCard label="Total Runs" value={formatNumber(d.totalRuns)} delta="↑ live demo" accent="var(--brand)" icon={<Layers size={28} />} />
        <KpiCard label="Contexts Published" value={formatNumber(d.totalContexts)} delta="↑ growing" accent="var(--info)" icon={<Boxes size={28} />} />
        <KpiCard label="Active Agents" value={formatNumber(d.totalAgents)} delta="— stable" deltaTone="muted" accent="var(--purple)" icon={<Users size={28} />} />
        <KpiCard label="Registries" value={formatNumber(d.totalRegistries)} delta="● all healthy" accent="var(--warning)" icon={<Database size={28} />} />
      </div>

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <Card>
          <CardHeader title="Recent Runs" sub="Most recent 5" />
          <RecentRunsTable runs={d.recentRuns} scenarioName={scenarioName} />
        </Card>
        <Card>
          <CardHeader title="Live Events" right={<Badge variant={live ? 'running' : 'neutral'}>{live ? '● live' : '○ idle'}</Badge>} />
          <EventTicker events={events} />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader title="Runs by Scenario" sub="Last 24 h" />
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
    </div>
  );
}
