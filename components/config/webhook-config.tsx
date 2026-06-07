'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { listWebhooks } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { timeAgo } from '@/lib/utils/format';

export function WebhookConfig() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading } = useQuery({
    queryKey: ['webhooks', demoMode],
    queryFn: () => listWebhooks(demoMode),
  });

  return (
    <Card>
      <CardHeader title="Outbound Webhooks" sub={`${data?.length ?? 0} configured`} />
      {isLoading ? (
        <div style={{ padding: 14 }}>
          <LoadingSkeleton rows={2} height={32} />
        </div>
      ) : data && data.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.map((wh) => (
              <tr key={wh.id}>
                <td className="did" style={{ maxWidth: 260 }}>
                  {wh.url}
                </td>
                <td>{wh.events.length === 0 ? 'all' : wh.events.join(', ')}</td>
                <td>
                  <Badge variant={wh.active ? 'complete' : 'neutral'}>{wh.active ? '● active' : '○ disabled'}</Badge>
                </td>
                <td style={{ color: 'var(--muted)' }}>{timeAgo(wh.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="No webhooks configured" description="Register an outbound webhook on the control plane to fan out events." />
      )}
    </Card>
  );
}
