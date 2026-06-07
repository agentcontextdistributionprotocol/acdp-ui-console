'use client';

import { useState } from 'react';
import { ShieldCheck, Clock, Database, GitBranch, FileJson, ChevronRight, ChevronDown } from 'lucide-react';
import { JsonViewer } from '@/components/ui/json-viewer';
import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { clockTime, timeAgo, shortId } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { FullContext } from '@/lib/types';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 11.5, lineHeight: 1.5 }}>
      <span style={{ color: C.faint, minWidth: 88, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.text, minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: C.muted,
          marginBottom: 6,
          textTransform: 'uppercase',
        }}
      >
        <Icon size={12} />
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

/**
 * Structured render of a full ACDP context — identity, producer signature,
 * lifecycle, classification, and data references — with a collapsible raw
 * JSON fallback. Reused by the contexts modal and the run-detail inspector.
 *
 * Note: the "signed" badge reflects the presence of a producer signature in
 * the body; it is NOT a client-side cryptographic verification.
 */
export function ContextDetail({ ctx, compact = false }: { ctx: FullContext; compact?: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const b = ctx.body;
  const fontSize = compact ? 10.5 : 11.5;

  const expired = b.expires_at ? new Date(b.expires_at).getTime() < Date.now() : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16, fontSize }}>
      {/* Identity */}
      <Group icon={GitBranch} title="Identity">
        <Field label="ctx_id">
          <span className="did" style={{ fontSize: 10.5 }}>
            {b.ctx_id}
          </span>
        </Field>
        <Field label="lineage">
          <span className="did" style={{ fontSize: 10.5 }}>
            {b.lineage_id}
          </span>
        </Field>
        <Field label="version">
          v{b.version}
          {b.supersedes ? (
            <span style={{ color: C.muted }}> · supersedes {formatCtxId(b.supersedes)}</span>
          ) : null}
        </Field>
        <Field label="agent">{formatAgentDid(b.agent_id)}</Field>
        {b.contributors && b.contributors.length > 0 && (
          <Field label="contributors">{b.contributors.map(formatAgentDid).join(', ')}</Field>
        )}
        <Field label="registry">{shortAuthority(b.origin_registry)}</Field>
      </Group>

      {/* Integrity / signature */}
      <Group icon={ShieldCheck} title="Integrity">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
          {b.signature ? (
            <span className="chip ok">signed · {b.signature.algorithm}</span>
          ) : (
            <span className="chip">unsigned</span>
          )}
          {b.acdp_version && <span className="chip">acdp v{b.acdp_version}</span>}
        </div>
        <Field label="content hash">
          <span className="did" style={{ fontSize: 10.5 }}>
            {b.content_hash}
          </span>
        </Field>
        {b.signature && (
          <>
            <Field label="key_id">
              <span className="did" style={{ fontSize: 10.5 }}>
                {b.signature.key_id}
              </span>
            </Field>
            <Field label="signature">
              <span className="did" style={{ fontSize: 10.5 }}>
                {shortId(b.signature.value, 16, 8)}
              </span>
            </Field>
          </>
        )}
      </Group>

      {/* Lifecycle */}
      <Group icon={Clock} title="Lifecycle">
        <Field label="created">
          {clockTime(b.created_at)} <span style={{ color: C.muted }}>({timeAgo(b.created_at)})</span>
        </Field>
        {b.expires_at && (
          <Field label="expires">
            {clockTime(b.expires_at)}{' '}
            <span className={expired ? 'chip' : 'chip ok'} style={{ marginLeft: 4 }}>
              {expired ? 'expired' : 'active'}
            </span>
          </Field>
        )}
        {b.data_period && (
          <Field label="data period">
            {clockTime(b.data_period.start)} → {clockTime(b.data_period.end)}
          </Field>
        )}
        <Field label="state">
          <span className="chip ok">{ctx.registry_state.status}</span>
        </Field>
      </Group>

      {/* Classification */}
      <Group icon={FileJson} title="Classification">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="chip">{b.type}</span>
          <span className={b.visibility === 'public' ? 'chip' : 'chip ok'}>{b.visibility}</span>
          {b.domain && <span className="chip mode-dual">{b.domain}</span>}
        </div>
        {b.tags && b.tags.length > 0 && <Field label="tags">{b.tags.join(', ')}</Field>}
        {b.audience && b.audience.length > 0 && (
          <Field label="audience">{b.audience.map(formatAgentDid).join(', ')}</Field>
        )}
        {b.schema_uri && (
          <Field label="schema">
            <a href={b.schema_uri} target="_blank" rel="noreferrer" style={{ color: C.info }}>
              {b.schema_uri}
            </a>
          </Field>
        )}
        {b.description && <Field label="description">{b.description}</Field>}
        {b.summary && <Field label="summary">{b.summary}</Field>}
      </Group>

      {/* Data references */}
      {b.data_refs && b.data_refs.length > 0 && (
        <Group icon={Database} title="Data references">
          {b.data_refs.map((ref, i) => (
            <Field key={i} label={ref.type}>
              <span className="did" style={{ fontSize: 10.5 }}>
                {ref.location}
              </span>
              {ref.encoding && <span style={{ color: C.muted }}> · {ref.encoding}</span>}
            </Field>
          ))}
        </Group>
      )}

      {b.derived_from && b.derived_from.length > 0 && (
        <Group icon={GitBranch} title="Derived from">
          {b.derived_from.map((d) => (
            <Field key={d} label="←">
              <span className="did" style={{ fontSize: 10.5 }}>
                {d}
              </span>
            </Field>
          ))}
        </Group>
      )}

      {/* Raw JSON fallback */}
      <div>
        <button
          type="button"
          onClick={() => setRawOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: C.muted,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Raw body
        </button>
        {rawOpen && <JsonViewer data={b} style={{ maxHeight: compact ? 200 : 340, marginTop: 8 }} />}
      </div>
    </div>
  );
}
