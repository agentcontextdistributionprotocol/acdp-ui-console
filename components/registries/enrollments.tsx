'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { listEnrollments, enrollRegistry } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { ApiError } from '@/lib/api/fetcher';
import { shortAuthority } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { RegistryEnrollment } from '@/lib/types';

type Editing = { mode: 'create' } | { mode: 'edit'; enrollment: RegistryEnrollment } | null;

export function Enrollments() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments', demoMode],
    queryFn: () => listEnrollments(demoMode),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['enrollments', demoMode] });

  // Toggling enabled is an upsert (POST /registries/enroll) — admin-only.
  const toggleMut = useMutation({
    mutationFn: (e: RegistryEnrollment) =>
      enrollRegistry(
        {
          authority: e.authority,
          tenantId: e.tenantId,
          baseUrl: e.baseUrl ?? undefined,
          registryDid: e.registryDid ?? undefined,
          enabled: !e.enabled,
        },
        demoMode,
      ),
    onSuccess: invalidate,
  });

  const toggleForbidden = toggleMut.error instanceof ApiError && toggleMut.error.status === 403;

  return (
    <Card>
      <CardHeader
        title="Registry Enrollments"
        sub={`${data?.length ?? 0} enrolled`}
        right={
          <Button variant="secondary" onClick={() => setEditing({ mode: 'create' })}>
            <Plus size={13} aria-hidden /> Enroll
          </Button>
        }
      />
      {(toggleForbidden || (toggleMut.error && !toggleForbidden)) && (
        <div style={{ padding: '0 14px' }}>
          <ErrorPanel
            message={
              toggleForbidden
                ? 'Enrollment changes require an admin API key (set it in Config).'
                : String(toggleMut.error)
            }
          />
        </div>
      )}
      {isLoading ? (
        <div style={{ padding: 14 }}>
          <LoadingSkeleton rows={2} height={32} />
        </div>
      ) : error ? (
        <div style={{ padding: 14 }}>
          <ErrorPanel message={String(error)} />
        </div>
      ) : data && data.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Authority</th>
              <th>Registry DID</th>
              <th>Base URL</th>
              <th>Tenant</th>
              <th>Status</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.authority}>
                <td>{shortAuthority(e.authority)}</td>
                <td className="did" style={{ maxWidth: 200 }}>
                  {e.registryDid ?? '—'}
                </td>
                <td className="did" style={{ maxWidth: 180 }}>
                  {e.baseUrl ?? '—'}
                </td>
                <td>{e.tenantId}</td>
                <td>
                  <button
                    className="pill"
                    aria-pressed={e.enabled}
                    style={{ width: 'fit-content' }}
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate(e)}
                    title="Toggle ingest enabled"
                  >
                    <span className={`dot ${e.enabled ? 'ok' : 'err'}`} />
                    {e.enabled ? 'enabled' : 'disabled'}
                  </button>
                </td>
                <td style={{ color: 'var(--muted)' }}>{e.updatedAt ? timeAgo(e.updatedAt) : timeAgo(e.createdAt)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="icon-btn"
                      aria-label={`Edit enrollment ${e.authority}`}
                      onClick={() => setEditing({ mode: 'edit', enrollment: e })}
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="No registries enrolled"
          description="Enroll a registry authority so the control plane accepts and federates its events."
          action={
            <Button variant="primary" onClick={() => setEditing({ mode: 'create' })}>
              <Plus size={13} aria-hidden /> Enroll registry
            </Button>
          }
        />
      )}

      {editing && (
        <EnrollForm editing={editing} demoMode={demoMode} onDone={() => setEditing(null)} onSaved={invalidate} />
      )}
    </Card>
  );
}

function EnrollForm({
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
  const existing = editing.mode === 'edit' ? editing.enrollment : null;
  const [authority, setAuthority] = useState(existing?.authority ?? '');
  const [registryDid, setRegistryDid] = useState(existing?.registryDid ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [tenantId, setTenantId] = useState(existing?.tenantId ?? '');
  const [secret, setSecret] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      enrollRegistry(
        {
          authority,
          ...(tenantId ? { tenantId } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(registryDid ? { registryDid } : {}),
          ...(secret ? { webhookSecret: secret } : {}),
          enabled: existing?.enabled ?? true,
        },
        demoMode,
      ),
    onSuccess: () => {
      onSaved();
      onDone();
    },
  });

  const forbidden = mut.error instanceof ApiError && mut.error.status === 403;
  const secretTooShort = secret.length > 0 && secret.length < 16;

  return (
    <Modal
      open
      onClose={onDone}
      title={editing.mode === 'create' ? 'Enroll registry' : `Edit ${shortAuthority(authority)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !authority || secretTooShort}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="config-form">
        <div className="form-row">
          <span className="form-label">Authority</span>
          <input
            className="form-input"
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="registry-a.example"
            disabled={editing.mode === 'edit'}
          />
        </div>
        <div className="form-row">
          <span className="form-label">Registry DID</span>
          <input
            className="form-input"
            value={registryDid}
            onChange={(e) => setRegistryDid(e.target.value)}
            placeholder="did:web:registry-a.example"
          />
        </div>
        <div className="form-row">
          <span className="form-label">Base URL</span>
          <input
            className="form-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://registry-a.example"
          />
        </div>
        <div className="form-row">
          <span className="form-label">Tenant</span>
          <input
            className="form-input"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="default"
          />
        </div>
        <div className="form-row">
          <span className="form-label">Webhook secret</span>
          <input
            className="form-input"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={existing ? 'unchanged' : 'min 16 chars (HMAC)'}
          />
        </div>
        {secretTooShort && (
          <div style={{ fontSize: 11, color: C.warning }}>Webhook secret must be at least 16 characters.</div>
        )}
      </div>
      {mut.error && (
        <div style={{ marginTop: 12, fontSize: 11, color: C.danger }}>
          {forbidden ? 'Enrollment requires an admin API key (set it in Config).' : String(mut.error)}
        </div>
      )}
    </Modal>
  );
}
