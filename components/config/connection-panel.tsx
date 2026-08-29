'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';
import type { ProxyService } from '@/lib/types';

const ROWS: { service: ProxyService; label: string }[] = [
  { service: 'playground', label: 'Playground' },
  { service: 'control-plane', label: 'Control Plane' },
  { service: 'registry-a', label: 'Registry A' },
  { service: 'registry-b', label: 'Registry B' },
];

export function ConnectionPanel() {
  const { jaegerUrl, setJaegerUrl, demoMode, setDemoMode } = usePreferencesStore();
  const [results, setResults] = useState<Record<string, boolean | 'pending'>>({});
  const [saved, setSaved] = useState(false);

  // Jaeger is the only browser-editable value here; Save is an explicit
  // acknowledgement since it already persists live via the store.
  const save = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const testAll = async () => {
    const pending: Record<string, boolean | 'pending'> = {};
    ROWS.forEach((r) => (pending[r.service] = 'pending'));
    setResults(pending);
    await Promise.all(
      ROWS.map(async (r) => {
        const res = await pingHealth(r.service, demoMode);
        setResults((prev) => ({ ...prev, [r.service]: res.ok }));
      }),
    );
  };

  return (
    <Card>
      <CardHeader title="Service Connections" />
      <CardBody>
        <div className="config-form">
          <div className="form-row">
            <span className="form-label">Demo mode</span>
            <button
              type="button"
              className="pill"
              aria-pressed={demoMode}
              style={{ width: 'fit-content' }}
              onClick={() => setDemoMode(!demoMode)}
            >
              <span className={`dot ${demoMode ? 'warn' : 'ok'}`} />
              {demoMode ? 'On — using mock data' : 'Off — live backend'}
            </button>
          </div>
          {ROWS.map((r) => (
            <div key={r.service} className="form-row">
              <span className="form-label">{r.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.faint }}>server-configured</span>
                {results[r.service] !== undefined && (
                  <span
                    className={`dot ${results[r.service] === 'pending' ? 'warn' : results[r.service] ? 'ok' : 'err'}`}
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="form-row">
            <span className="form-label">Jaeger</span>
            <input className="form-input" value={jaegerUrl} onChange={(e) => setJaegerUrl(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="primary" onClick={save}>
            {saved ? 'Saved ✓' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={testAll}>
            Test All
          </Button>
          <span style={{ fontSize: 11, color: C.faint }}>
            Service URLs and the control-plane API key are server-side only (env vars read by the Next.js
            proxy) — nothing the browser sends can change them.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
