'use client';

import { useQueries } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { SDK_MATRIX_ROW_SERVICE, buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import { C } from '@/lib/colors';

export function SdkMatrix() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const services = Object.values(SDK_MATRIX_ROW_SERVICE);

  const healths = useQueries({
    queries: services.map((service) => ({
      queryKey: ['health', service, demoMode],
      queryFn: () => pingHealth(service, demoMode),
      refetchInterval: 20_000,
      retry: false,
    })),
  });
  const healthByService = new Map(services.map((s, i) => [s, healths[i].data?.ok]));
  const rows = buildSdkMatrixRows(demoMode, healthByService);

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
          {rows.map((row) => (
            <tr key={row.component}>
              <td>{row.component}</td>
              <td className="did">
                {row.versionIsLive ? (
                  row.version
                ) : (
                  <span title={`${row.version} (reference — not confirmed against the running service)`} style={{ color: C.muted }}>
                    {row.version}
                  </span>
                )}
              </td>
              <td>
                {row.status === 'reference' ? (
                  <Badge variant="neutral">◇ reference</Badge>
                ) : row.status === 'unknown' ? (
                  <Badge variant="neutral">— unknown</Badge>
                ) : row.status === 'ok' ? (
                  <Badge variant="complete">● ok</Badge>
                ) : (
                  <Badge variant="failed">✗ down</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
