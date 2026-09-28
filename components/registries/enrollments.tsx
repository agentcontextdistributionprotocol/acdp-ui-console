'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorDetail, ErrorPanel } from '@/components/ui/error-panel';
import { listEnrollments, enrollRegistry } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import {
  ADMIN_ROUTE_FORBIDDEN,
  errorDiagnostic,
  isUpstreamForbidden,
  operatorErrorMessage,
} from '@/lib/utils/api-error-messages';
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

  const toggleForbidden = isUpstreamForbidden(toggleMut.error);

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
      {/* Was `toggleForbidden || (toggleMut.error && !toggleForbidden)`, which
          is `toggleMut.error` with extra steps — and it hid that the two arms
          below are the same condition split, not two independent guards.

          The disclosure is NOT optional on the 403 arm. `ADMIN_ROUTE_FORBIDDEN`
          deliberately refuses to diagnose — the control plane has four reasons
          for a 403 here and sends a code for none of them — and it points the
          operator at this detail by name. A first cut left it off on the theory
          that a `<details>` above a table reflows it when opened; that is true,
          it is the operator's own click, and it is a trivial cost next to
          having no path at all to the reason the control plane gave. */}
      {toggleMut.error && (
        <div style={{ padding: '0 14px' }}>
          <ErrorPanel
            message={
              toggleForbidden
                ? `Enrollment changes are admin-gated. ${ADMIN_ROUTE_FORBIDDEN}`
                : operatorErrorMessage(toggleMut.error, 'Could not change this enrollment')
            }
            details={errorDiagnostic(toggleMut.error)}
          />
        </div>
      )}
      {isLoading ? (
        <div style={{ padding: 14 }}>
          <LoadingSkeleton rows={2} height={32} />
        </div>
      ) : error ? (
        <div style={{ padding: 14 }}>
          {/* The LIST query, which is a plain read and carries no 403 arm —
              `GET /registries/enrollments` is not admin-gated, only the enroll
              write is. This one does get a disclosure: it replaces the table
              rather than sitting above it, so nothing reflows. */}
          <ErrorPanel
            message={operatorErrorMessage(error, 'Could not load the registry enrollments')}
            details={errorDiagnostic(error)}
          />
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

  const forbidden = isUpstreamForbidden(mut.error);
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
            // NOT `placeholder="default"`. `default` is the control plane's
            // RESERVED untenanted sentinel: `assertNotReservedTenant`
            // (`src/tenant/request-tenant.ts:38`) refuses it with a 403, and it
            // is refused AFTER the admin check passes — so a placeholder
            // suggesting it handed the operator a one-click route to a refusal
            // that has nothing to do with the key they would then go and get
            // re-scoped. Blank means untenanted, which is what the field
            // already does: `tenantId` is spread in only when truthy.
            placeholder="blank = untenanted"
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
      {/* No `codes` map, and the reason is narrower than it first looks. The
          enroll handler
          (`acdp-control-plane/src/registries/registries.controller.ts:156-185`)
          raises `ForbiddenException`, `assertNotReservedTenant`'s, and
          `ValidationPipe`'s — all built-in Nest exceptions, whose default body
          already carries a STRING under `error`, so `withAcdpEnvelope`
          (`exception.filter.ts:72`) short-circuits and no `error.code` is
          minted at all. (It is not, as an earlier version of this comment said,
          that they default to `INTERNAL_ERROR`; that default applies to the
          string-bodied throws the filter DOES rewrite — a throttled enroll, or
          any 500 — which is also the reason "only those three" was wrong.) The
          upshot is unchanged: the only code this route can emit is
          `INTERNAL_ERROR`, which says nothing a status does not. Filed as
          acdp-control-plane#179.

          Inline text rather than an `ErrorPanel` — a bordered card with a 20px
          gutter is wrong inside a form — but it gets the same disclosure, for
          the same reason the toggle above does. */}
      {mut.error && (
        <div style={{ marginTop: 12, fontSize: 11, color: C.danger }}>
          {forbidden
            ? `Enrollment is admin-gated. ${ADMIN_ROUTE_FORBIDDEN}`
            : operatorErrorMessage(mut.error, 'Could not save this enrollment')}
          <ErrorDetail details={errorDiagnostic(mut.error)} />
        </div>
      )}
    </Modal>
  );
}
