'use client';

import { Activity, ExternalLink, ArrowRight } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { HealthChecks } from '@/components/observability/health-checks';
import { MetricsPanel } from '@/components/observability/metrics-panel';
import { useRuns } from '@/lib/hooks/use-runs';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { elapsed } from '@/lib/utils/format';
import { C } from '@/lib/colors';

export default function ObservabilityPage() {
  const jaegerUrl = usePreferencesStore((s) => s.jaegerUrl);
  const { data: runsData } = useRuns({});
  const { data: scenarios } = useScenarios();
  const scenarioName = (id: string) => scenarios?.find((s) => s.id === id)?.name ?? id;
  const recent = (runsData?.data ?? []).slice(0, 5);
  const duration = (run: { startedAt: string; completedAt?: string | null }) =>
    run.completedAt ? elapsed(run.startedAt, run.completedAt) : 'running';

  return (
    <div className="page">
      <SectionTitle icon={Activity} title="Observability" />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
          Service Health
        </div>
        <HealthChecks />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader title="Prometheus Metrics (CP)" />
          <CardBody>
            <MetricsPanel />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traces" sub="Jaeger UI" />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recent.map((run) => (
                <a
                  key={run.runId}
                  href={`${jaegerUrl}/search?tags=${encodeURIComponent(JSON.stringify({ 'run.id': run.runId }))}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    background: C.panel2,
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.text }}>{run.runId}</div>
                    <div className="did">
                      {scenarioName(run.scenarioId)} · {duration(run)}
                    </div>
                  </div>
                  <ArrowRight size={12} color={C.muted} />
                </a>
              ))}
              <a
                href={jaegerUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  background: C.panel3,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: C.muted,
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Open Jaeger UI
                <ExternalLink size={11} />
              </a>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
