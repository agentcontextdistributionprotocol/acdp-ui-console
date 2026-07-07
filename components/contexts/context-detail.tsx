'use client';

import { useState } from 'react';
import {
  ShieldCheck,
  Clock,
  Database,
  GitBranch,
  FileJson,
  ChevronRight,
  ChevronDown,
  BadgeCheck,
  Ban,
  History,
  Stamp,
  ScrollText,
  Eye,
} from 'lucide-react';
import { JsonViewer } from '@/components/ui/json-viewer';
import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { clockTime, timeAgo, shortId } from '@/lib/utils/format';
import { C, statusChipClass } from '@/lib/colors';
import type { FullContext, LifecycleEvent } from '@/lib/types';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { MOCK_DID_DOCS } from '@/lib/data/mock-data';
import { useContextVerdicts } from '@/lib/verify/use-verdicts';
import type { Verdict } from '@/lib/verify/verify';

/**
 * Client-side verification verdict chip. Driven by the wasm verifier — a green
 * chip means the browser recomputed the hash / checked the signature itself.
 * `unavailable` ("material only") is honest about a missing signer key/DID doc
 * and is NEVER shown as a pass.
 */
function VerdictChip({ verdict, ready, label }: { verdict?: Verdict; ready: boolean; label?: string }) {
  if (!ready || !verdict) {
    return (
      <span className="chip" title="Running client-side verification…">
        {label ? `${label} · ` : ''}verifying…
      </span>
    );
  }
  const prefix = label ? `${label} · ` : '';
  if (verdict.status === 'verified')
    return (
      <span className="chip ok" title={verdict.detail}>
        ✓ {prefix}verified
      </span>
    );
  if (verdict.status === 'failed')
    return (
      <span className="chip bad" title={verdict.detail}>
        ✗ {prefix}verification failed
      </span>
    );
  return (
    <span className="chip warn" title={verdict.detail}>
      {prefix}material only
    </span>
  );
}

/** Small caption echoing the verdict's human-readable detail. */
function VerdictCaption({ verdict, ready }: { verdict?: Verdict; ready: boolean }) {
  const text = !ready || !verdict ? 'Verifying client-side…' : verdict.detail;
  const color = !ready || !verdict ? C.faint : verdict.status === 'failed' ? C.danger : C.faint;
  return <div style={{ fontSize: 10, color, marginTop: 2 }}>{text}</div>;
}

/** Latest lifecycle event of a given type (array order is authoritative). */
function latestEvent(events: LifecycleEvent[] | undefined, type: string): LifecycleEvent | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === type) return events[i];
  }
  return undefined;
}

/** Staleness threshold for lineage-head receipts (RFC-ACDP-0011 §6 freshness). */
const HEAD_RECEIPT_STALE_MS = 300_000;

/**
 * Freshness window for witness cosignatures (RFC-ACDP-0015 §7). Witnesses
 * re-observe the log on a periodic cadence — much slower than a serve-time head
 * receipt — so a wider window than HEAD_RECEIPT_STALE_MS is appropriate before a
 * cosignature reads as stale.
 */
const WITNESS_COSIG_STALE_MS = 21_600_000; // 6 h

/** A structural cross-field check between the receipt and the served body. */
function BindingChip({ label, ok }: { label: string; ok: boolean }) {
  return <span className={ok ? 'chip ok' : 'chip bad'}>{ok ? '✓' : '✗'} {label}</span>;
}

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
 * The trust surfaces (integrity, receipt, lineage-head receipt, transparency
 * log, witness cosignatures) carry REAL client-side cryptographic verdicts,
 * computed in-browser by the acdp-wasm verifier via `useContextVerdicts`.
 */
export function ContextDetail({ ctx, compact = false }: { ctx: FullContext; compact?: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const b = ctx.body;
  const fontSize = compact ? 10.5 : 11.5;

  // In demo mode the console supplies the mock did:web DID documents so the
  // did:web-signed surfaces can be verified offline; did:key surfaces verify
  // with no documents at all. In live mode no did:web docs are on hand, so
  // those surfaces honestly read "material only" (did:key still verifies).
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const didDocs = demoMode ? MOCK_DID_DOCS : undefined;
  const verdicts = useContextVerdicts(ctx, didDocs);

  const expired = b.expires_at ? new Date(b.expires_at).getTime() < Date.now() : false;

  const status = ctx.registry_state.status;
  const retracted = status === 'retracted';
  const lifecycleEvents = ctx.registry_state.lifecycle_events;
  const retraction = latestEvent(lifecycleEvents, 'retracted');

  const lhr = ctx.lineage_head_receipt;
  const lhrAgeMs = lhr ? Date.now() - new Date(lhr.as_of).getTime() : 0;
  const lhrStale = lhr ? lhrAgeMs > HEAD_RECEIPT_STALE_MS : false;

  const inclusion = ctx.log_inclusion;

  // RFC-ACDP-0015 §6.1 witness cosignatures ride as a sibling of log_checkpoint.
  const witnesses = inclusion?.witness_signatures ?? [];
  const cp = inclusion?.log_checkpoint;
  // N-witnessed count is over DISTINCT witness_id values (RFC-ACDP-0015 §8).
  const distinctWitnessCount = new Set(witnesses.map((w) => w.witness_id)).size;
  // Every cosignature's witnessed_checkpoint must bind to the served checkpoint's
  // (log_id, tree_size, root_hash) tuple — the tuple the N-witnessed count is over.
  const witnessesBindLog = cp ? witnesses.every((w) => w.witnessed_checkpoint.log_id === cp.log_id) : false;
  const witnessesBindSize = cp ? witnesses.every((w) => w.witnessed_checkpoint.tree_size === cp.tree_size) : false;
  const witnessesBindRoot = cp ? witnesses.every((w) => w.witnessed_checkpoint.root_hash === cp.root_hash) : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16, fontSize }}>
      {/* Retraction banner (RFC-ACDP-0013) */}
      {retracted && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px dashed rgba(240, 93, 122, 0.5)',
            background: 'rgba(240, 93, 122, 0.07)',
            color: C.danger,
          }}
        >
          <Ban size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 11.5 }}>
              This context has been retracted
              {retraction ? ` ${timeAgo(retraction.occurred_at)}` : ''} — do not rely on its content.
            </div>
            {retraction?.reason && (
              <div style={{ color: C.text, fontSize: 11, marginTop: 3 }}>{retraction.reason}</div>
            )}
            {retraction && (
              <div style={{ color: C.muted, fontSize: 10.5, marginTop: 3 }}>
                by {formatAgentDid(retraction.actor)} · {clockTime(retraction.occurred_at)}
                {retraction.signature ? ' · signed' : ''}
              </div>
            )}
          </div>
        </div>
      )}

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
          <VerdictChip verdict={verdicts.contentHash} ready={verdicts.ready} label="content_hash" />
          {b.signature ? (
            <VerdictChip verdict={verdicts.producerSignature} ready={verdicts.ready} label={`sig ${b.signature.algorithm}`} />
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

      {/* Registry receipt (RFC-ACDP-0010) */}
      {ctx.registry_receipt && (
        <Group icon={BadgeCheck} title="Registry receipt">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <VerdictChip verdict={verdicts.registryReceipt} ready={verdicts.ready} />
            <BindingChip label="ctx" ok={ctx.registry_receipt.ctx_id === b.ctx_id} />
            <BindingChip label="lineage" ok={ctx.registry_receipt.lineage_id === b.lineage_id} />
            <BindingChip label="origin" ok={ctx.registry_receipt.origin_registry === b.origin_registry} />
            <BindingChip label="content hash" ok={ctx.registry_receipt.content_hash === b.content_hash} />
          </div>
          <Field label="registry">
            <span className="did" style={{ fontSize: 10.5 }}>
              {ctx.registry_receipt.registry_did}
            </span>
          </Field>
          <Field label="fingerprint">
            <span className="did" style={{ fontSize: 10.5 }} title={ctx.registry_receipt.key_fingerprint}>
              {ctx.registry_receipt.key_fingerprint}
            </span>
          </Field>
          <Field label="issued">{clockTime(ctx.registry_receipt.created_at)}</Field>
          <Field label="sig">
            <span className="chip ok" style={{ marginRight: 4 }}>{ctx.registry_receipt.signature.algorithm}</span>
            <span className="did" style={{ fontSize: 10.5 }}>
              {shortId(ctx.registry_receipt.signature.value, 16, 8)}
            </span>
          </Field>
          <VerdictCaption verdict={verdicts.registryReceipt} ready={verdicts.ready} />
        </Group>
      )}

      {/* Lineage-head receipt (RFC-ACDP-0011) */}
      {lhr && (
        <Group icon={Stamp} title="Lineage-head receipt">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <VerdictChip verdict={verdicts.lineageHeadReceipt} ready={verdicts.ready} />
            <BindingChip label="lineage" ok={lhr.lineage_id === b.lineage_id} />
            <BindingChip label="head = this ctx" ok={lhr.head_ctx_id === b.ctx_id} />
            <BindingChip label="head version" ok={lhr.head_version === b.version} />
          </div>
          <Field label="registry">
            <span className="did" style={{ fontSize: 10.5 }}>
              {lhr.registry_did}
            </span>
          </Field>
          <Field label="head status">
            <span className={statusChipClass(lhr.head_status)}>{lhr.head_status}</span>
          </Field>
          <Field label="as of">
            {clockTime(lhr.as_of)} <span style={{ color: C.muted }}>({timeAgo(lhr.as_of)})</span>
            {lhrStale && (
              <span
                className="chip warn"
                style={{ marginLeft: 6 }}
                title="Head claim evaluated more than 300 s ago — the lineage head may have changed since."
              >
                stale · {Math.round(lhrAgeMs / 60_000)}m old
              </span>
            )}
          </Field>
          <Field label="sig">
            <span className="chip ok" style={{ marginRight: 4 }}>{lhr.signature.algorithm}</span>
            <span className="did" style={{ fontSize: 10.5 }}>
              {shortId(lhr.signature.value, 16, 8)}
            </span>
          </Field>
          <VerdictCaption verdict={verdicts.lineageHeadReceipt} ready={verdicts.ready} />
        </Group>
      )}

      {/* Transparency log (RFC-ACDP-0012) */}
      {inclusion && (
        <Group icon={ScrollText} title="Transparency log">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <VerdictChip verdict={verdicts.transparencyLog} ready={verdicts.ready} />
          </div>
          <Field label="log">
            <span className="did" style={{ fontSize: 10.5 }}>
              {inclusion.log_id}
            </span>
          </Field>
          <Field label="leaf">
            #{inclusion.leaf_index} <span style={{ color: C.muted }}>of {inclusion.tree_size} leaves</span>
          </Field>
          <Field label="audit path">
            {inclusion.inclusion_path.length} node hash{inclusion.inclusion_path.length === 1 ? '' : 'es'}
            {inclusion.inclusion_path.length > 0 && (
              <span className="did" style={{ fontSize: 10.5, marginLeft: 6 }} title={inclusion.inclusion_path[0]}>
                {shortId(inclusion.inclusion_path[0], 14, 6)}…
              </span>
            )}
          </Field>
          <Field label="root hash">
            <span className="did" style={{ fontSize: 10.5 }} title={inclusion.log_checkpoint.root_hash}>
              {shortId(inclusion.log_checkpoint.root_hash, 16, 8)}
            </span>
          </Field>
          <Field label="checkpoint">
            {clockTime(inclusion.log_checkpoint.timestamp)}{' '}
            <span style={{ color: C.muted }}>
              (tree size {inclusion.log_checkpoint.tree_size} · {timeAgo(inclusion.log_checkpoint.timestamp)})
            </span>
          </Field>
          <Field label="sig">
            <span className="chip ok" style={{ marginRight: 4 }}>{inclusion.log_checkpoint.signature.algorithm}</span>
            <span className="did" style={{ fontSize: 10.5 }}>
              {shortId(inclusion.log_checkpoint.signature.value, 16, 8)}
            </span>
          </Field>
          <VerdictCaption verdict={verdicts.transparencyLog} ready={verdicts.ready} />
        </Group>
      )}

      {/* Witness cosignatures (RFC-ACDP-0015) */}
      {inclusion && witnesses.length > 0 && (
        <Group icon={Eye} title="Witness cosignatures">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {verdicts.ready && verdicts.witnessQuorum ? (
              <VerdictChip
                verdict={{
                  ...verdicts.witnessQuorum,
                  detail: verdicts.witnessQuorum.detail,
                }}
                ready={verdicts.ready}
                label={`${verdicts.witnessQuorum.witnessedCount}-witnessed`}
              />
            ) : (
              <VerdictChip verdict={undefined} ready={false} label={`${distinctWitnessCount}-witnessed`} />
            )}
            <BindingChip label="log" ok={witnessesBindLog} />
            <BindingChip label="tree size" ok={witnessesBindSize} />
            <BindingChip label="root hash" ok={witnessesBindRoot} />
          </div>
          {witnesses.map((w, i) => {
            const ageMs = Date.now() - new Date(w.witnessed_at).getTime();
            const stale = ageMs > WITNESS_COSIG_STALE_MS;
            return (
              <div
                key={`${w.witness_id}-${i}`}
                style={{ display: 'flex', gap: 10, fontSize: 11.5, lineHeight: 1.5 }}
              >
                <span style={{ color: C.faint, minWidth: 88, flexShrink: 0 }}>witness</span>
                <span style={{ color: C.text, minWidth: 0, wordBreak: 'break-word' }}>
                  <span className="did" style={{ fontSize: 10.5 }} title={w.witness_id}>
                    {formatAgentDid(w.witness_id)}
                  </span>
                  <div style={{ color: C.muted, fontSize: 10.5, marginTop: 2 }}>
                    observed {clockTime(w.witnessed_at)} ({timeAgo(w.witnessed_at)})
                    {stale && (
                      <span
                        className="chip warn"
                        style={{ marginLeft: 6 }}
                        title="Cosignature observed outside the freshness window (RFC-ACDP-0015 §7) — the witness may not have re-observed the log recently."
                      >
                        stale · {Math.round(ageMs / 3_600_000)}h old
                      </span>
                    )}
                    <span className="chip ok" style={{ marginLeft: 6 }} title={w.signature.key_id}>
                      {w.signature.algorithm}
                    </span>
                  </div>
                </span>
              </div>
            );
          })}
          <VerdictCaption verdict={verdicts.witnessQuorum} ready={verdicts.ready} />
        </Group>
      )}

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
          <span className={statusChipClass(status)}>{status}</span>
        </Field>
      </Group>

      {/* Lifecycle events (RFC-ACDP-0013) */}
      {lifecycleEvents && lifecycleEvents.length > 0 && (
        <Group icon={History} title="Lifecycle events">
          {lifecycleEvents.map((ev) => (
            <div key={ev.event_id} style={{ display: 'flex', gap: 10, fontSize: 11.5, lineHeight: 1.5 }}>
              <span style={{ minWidth: 88, flexShrink: 0 }}>
                <span className={ev.event_type === 'retracted' ? 'chip bad' : ev.event_type === 'republished' ? 'chip warn' : 'chip'}>
                  {ev.event_type}
                </span>
              </span>
              <span style={{ color: C.text, minWidth: 0, wordBreak: 'break-word' }}>
                {clockTime(ev.occurred_at)} <span style={{ color: C.muted }}>({timeAgo(ev.occurred_at)})</span>
                <span style={{ color: C.muted }}> · by {formatAgentDid(ev.actor)}</span>
                {ev.signature && (
                  <span className="chip ok" style={{ marginLeft: 6 }} title={ev.signature.key_id}>
                    signed · {ev.signature.algorithm}
                  </span>
                )}
                {ev.reason && <div style={{ color: C.muted, fontSize: 10.5 }}>{ev.reason}</div>}
              </span>
            </div>
          ))}
        </Group>
      )}

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
