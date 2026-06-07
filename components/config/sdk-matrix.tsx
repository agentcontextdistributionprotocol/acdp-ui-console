'use client';

import { useQueries } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import type { ProxyService } from '@/lib/types';

// Map the service-backed rows to a proxy service so live mode can show real health.
const ROW_SERVICE: Record<string, ProxyService> = {
  'Registry (Rust/axum)': 'registry-a',
  'Control Plane (NestJS)': 'control-plane',
  'Playground (FastAPI)': 'playground',
};

export function SdkMatrix() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const services = Object.values(ROW_SERVICE);

  const healths = useQueries({
    queries: services.map((service) => ({
      queryKey: ['health', service, demoMode],
      queryFn: () => pingHealth(service, demoMode),
      refetchInterval: 20_000,
      retry: false,
    })),
  });
  const healthByService = new Map(services.map((s, i) => [s, healths[i].data?.ok]));

  return (
    <Card>
      <CardHeader title="SDK Matrix" sub={demoMode ? 'demo' : 'live status'} />
      <table className="data-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Version</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_SDK_MATRIX.map((row) => {
            const service = ROW_SERVICE[row.component];
            let ok: boolean | undefined = true;
            if (!demoMode) ok = service ? healthByService.get(service) : undefined;
            return (
              <tr key={row.component}>
                <td>{row.component}</td>
                <td className="did">{row.version}</td>
                <td>
                  {ok === undefined ? (
                    <Badge variant="neutral">— unknown</Badge>
                  ) : ok ? (
                    <Badge variant="complete">● ok</Badge>
                  ) : (
                    <Badge variant="failed">✗ down</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
