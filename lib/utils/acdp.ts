/**
 * ACDP-specific parsing helpers.
 * ctx_id form:  acdp://<authority>/<uuid>
 * agent DID:    did:web:<authority>:agents:<name>
 */
import type { StepEvent } from '@/lib/types';

export interface ParsedCtxId {
  authority: string;
  id: string;
  short: string;
}

export function parseCtxId(ctxId: string | null | undefined): ParsedCtxId | null {
  if (!ctxId) return null;
  const m = ctxId.match(/^acdp:\/\/([^/]+)\/(.+)$/);
  if (!m) return { authority: '', id: ctxId, short: ctxId };
  const [, authority, id] = m;
  return { authority, id, short: id.slice(0, 8) };
}

/** Compact display for a ctx_id: "acdp://registry-a…/f4a2". */
export function formatCtxId(ctxId: string | null | undefined): string {
  const p = parseCtxId(ctxId);
  if (!p) return '';
  if (!p.authority) return p.short;
  const authShort = p.authority.split('.')[0];
  return `acdp://${authShort}…/${p.short}`;
}

/** Extract the trailing readable name from a did:web agent identifier. */
export function formatAgentDid(did: string | null | undefined): string {
  if (!did) return '';
  if (!did.startsWith('did:web:')) return did;
  const parts = did.split(':');
  const name = parts[parts.length - 1];
  return `did:web:…${name}`;
}

/** Pull the authority host out of a did:web identifier. */
export function authorityFromDid(did: string | null | undefined): string {
  if (!did || !did.startsWith('did:web:')) return '';
  const parts = did.split(':');
  // did:web:<authority>:agents:<name>
  return parts[2] ?? '';
}

/** Short host label, e.g. "registry-a.playground.local" → "registry-a". */
export function shortAuthority(authority: string | null | undefined): string {
  if (!authority) return '';
  return authority.split('.')[0];
}

/** A run that hit the playground's LLM quota and fell back to mock responses. */
export interface LlmQuota {
  quota: string;
  limit: number | null;
  /** The raw RFC 3339 reset time; null when the quota store was unavailable. */
  resetsAt: string | null;
  /** How many LLM calls were answered by the mock; unknown from the event alone. */
  callsOnMock?: number;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function quotaFrom(denial: unknown, callsOnMock: unknown): LlmQuota | null {
  const d = asRecord(denial);
  if (!d || typeof d.quota !== 'string') return null;
  return {
    quota: d.quota,
    limit: typeof d.limit === 'number' ? d.limit : null,
    resetsAt: typeof d.resets_at === 'string' ? d.resets_at : null,
    callsOnMock: typeof callsOnMock === 'number' ? callsOnMock : undefined,
  };
}

/** A summary-shaped record (`RunResult.summary`, or `run.complete` itself). */
function quotaFromSummary(summary: unknown): LlmQuota | null {
  const s = asRecord(summary);
  if (!s || s.llm_quota_exceeded !== true) return null;
  // Flagged but without a readable denial: still never silent.
  return quotaFrom(s.llm_quota, s.llm_calls_on_mock) ?? { quota: 'unknown', limit: null, resetsAt: null };
}

/**
 * Whether a run fell back to the mock LLM because the playground's quota
 * refused a real call, and the details to show. Sources, most durable first:
 *
 * 1. `CpRun.result.summary` — the only source for a completed run hydrated
 *    from the control plane.
 * 2. `replaySummary` — the playground's replay frame (`RunResult`) when the
 *    stream reconnects after the run ended.
 * 3. The latest `run.complete` event carrying the summary fields.
 * 4. The `llm.quota_exceeded` event, which arrives mid-run, so the badge shows
 *    while the run is still going.
 *
 * `null` when no source reports it.
 */
export function runLlmQuota(
  run: { result?: Record<string, unknown> | null } | null | undefined,
  events: readonly StepEvent[] = [],
  replaySummary?: Record<string, unknown> | null,
): LlmQuota | null {
  const fromResult = quotaFromSummary(asRecord(run?.result)?.summary);
  if (fromResult) return fromResult;
  const fromReplay = quotaFromSummary(replaySummary);
  if (fromReplay) return fromReplay;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'run.complete') {
      const q = quotaFromSummary(ev);
      if (q) return q;
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'llm.quota_exceeded') {
      return quotaFrom(ev, undefined) ?? { quota: 'unknown', limit: null, resetsAt: null };
    }
  }
  return null;
}

/**
 * Whether a run reported `degraded: true` in its result summary. A degraded run
 * proved its offline core (signatures/receipts) but could not complete a live
 * round-trip — e.g. a *.playground.local DID that isn't DNS-hosted, so live
 * token issuance / did:web resolution can't succeed. The playground carries this
 * as `result.summary.degraded`; the control-plane persists the same shape.
 * Read defensively — `summary` is a free-form, per-scenario grab-bag.
 */
export function isRunDegraded(run: { result?: Record<string, unknown> | null } | null | undefined): boolean {
  const result = run?.result;
  if (!result || typeof result !== 'object') return false;
  const summary = (result as { summary?: unknown }).summary;
  if (!summary || typeof summary !== 'object') return false;
  return (summary as { degraded?: unknown }).degraded === true;
}
