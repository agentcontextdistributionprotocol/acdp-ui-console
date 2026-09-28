'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorDetail } from '@/components/ui/error-panel';
import { TableScroll } from '@/components/ui/table-scroll';
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type WebhookInput,
} from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { timeAgo } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { Webhook } from '@/lib/types';

type Editing = { mode: 'create' } | { mode: 'edit'; webhook: Webhook } | null;

export function WebhookConfig() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks', demoMode],
    queryFn: () => listWebhooks(demoMode),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['webhooks', demoMode] });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteWebhook(id, demoMode),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader
        title="Outbound Webhooks"
        sub={`${data?.length ?? 0} configured`}
        right={
          <Button variant="secondary" onClick={() => setEditing({ mode: 'create' })}>
            <Plus size={13} aria-hidden /> Add
          </Button>
        }
      />
      {isLoading ? (
        <div style={{ padding: 14 }}>
          <LoadingSkeleton rows={2} height={32} />
        </div>
      ) : data && data.length > 0 ? (
        <TableScroll label="Webhook subscriptions">
          <table className="data-table">
            <caption className="sr-only">Webhook subscriptions: URL, events, status, updated and actions</caption>
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.map((wh) => (
                <tr key={wh.id}>
                  <td className="did" style={{ maxWidth: 240 }}>
                    {wh.url}
                  </td>
                  <td>{wh.events.length === 0 ? 'all' : wh.events.join(', ')}</td>
                  <td>
                    <Badge variant={wh.active ? 'complete' : 'neutral'}>{wh.active ? '● active' : '○ disabled'}</Badge>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{timeAgo(wh.updatedAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="icon-btn"
                        aria-label={`Edit webhook ${wh.url}`}
                        onClick={() => setEditing({ mode: 'edit', webhook: wh })}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Delete webhook ${wh.url}`}
                        onClick={() => {
                          if (confirm(`Delete webhook ${wh.url}?`)) removeMut.mutate(wh.id);
                        }}
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <EmptyState
          title="No webhooks configured"
          description="Register an outbound webhook on the control plane to fan out events."
          action={
            <Button variant="primary" onClick={() => setEditing({ mode: 'create' })}>
              <Plus size={13} aria-hidden /> Add webhook
            </Button>
          }
        />
      )}

      {editing && (
        <WebhookForm editing={editing} demoMode={demoMode} onDone={() => setEditing(null)} onSaved={invalidate} />
      )}
    </Card>
  );
}

function WebhookForm({
  editing,
  demoMode,
  onDone,
  onSaved,
}: {
  editing: Exclude<Editing, null>;
  demoMode: boolean;
  onDone: () => void;
  onSaved: () => void;
}) {
  const existing = editing.mode === 'edit' ? editing.webhook : null;
  const [url, setUrl] = useState(existing?.url ?? '');
  const [events, setEvents] = useState((existing?.events ?? []).join(', '));
  const [secret, setSecret] = useState('');
  const [active, setActive] = useState(existing?.active ?? true);

  const mut = useMutation({
    mutationFn: () => {
      const eventList = events
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
      if (editing.mode === 'create') {
        const input: WebhookInput = { url, events: eventList, secret };
        return createWebhook(input, demoMode);
      }
      return updateWebhook(
        editing.webhook.id,
        { url, events: eventList, active, ...(secret ? { secret } : {}) },
        demoMode,
      );
    },
    onSuccess: () => {
      onSaved();
      onDone();
    },
  });

  return (
    <Modal
      open
      onClose={onDone}
      title={editing.mode === 'create' ? 'Add webhook' : 'Edit webhook'}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending || !url}>
            {mut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="config-form">
        <div className="form-row">
          <span className="form-label">URL</span>
          <input className="form-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="form-row">
          <span className="form-label">Events</span>
          <input
            className="form-input"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="comma-separated, empty = all"
          />
        </div>
        <div className="form-row">
          <span className="form-label">Secret</span>
          <input
            className="form-input"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={existing ? 'unchanged' : 'HMAC signing secret'}
          />
        </div>
        {editing.mode === 'edit' && (
          <div className="form-row">
            <span className="form-label">Active</span>
            <button
              type="button"
              className="pill"
              aria-pressed={active}
              style={{ width: 'fit-content' }}
              onClick={() => setActive((v) => !v)}
            >
              <span className={`dot ${active ? 'ok' : 'err'}`} />
              {active ? 'active' : 'disabled'}
            </button>
          </div>
        )}
      </div>
      {/* No 403 arm here, deliberately, and none should be added. Webhook CRUD
          is not admin-gated upstream — only `POST /registries/enroll` and the
          revocation feed are — so an admin-scope sentence on this surface would
          send an operator to have a key re-scoped for a permission that is not
          what refused them. Same mistake `log-witness-card.tsx:118-121`
          documents, and the same reason the sentence is a named constant rather
          than something a surface can reach for casually.

          It does get the disclosure, like every other error arm in this repo.
          `POST /webhooks` is `ValidationPipe`-checked, so the upstream's body
          is where "which field" lives — the single most useful thing on a
          failed save, and the status alone can never carry it. */}
      {mut.error && (
        <div style={{ marginTop: 12, fontSize: 11, color: C.danger }}>
          {operatorErrorMessage(mut.error, 'Could not save this webhook')}
          <ErrorDetail details={errorDiagnostic(mut.error)} />
        </div>
      )}
    </Modal>
  );
}
