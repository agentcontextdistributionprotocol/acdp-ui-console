'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ContextCard } from '@/components/contexts/context-card';
import { ContextDetail } from '@/components/contexts/context-detail';
import { searchContexts, getContext } from '@/lib/api/client';
import { ApiError } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { KEY_REVOCATION_TYPE } from '@/lib/utils/revocation';
import { C } from '@/lib/colors';
import type { ContextSearchParams, RegistryAuthority } from '@/lib/types';

const REGISTRIES: { id: RegistryAuthority | 'all'; label: string }[] = [
  { id: 'a', label: 'Registry A' },
  { id: 'b', label: 'Registry B' },
  { id: 'all', label: 'Both' },
];

// The interim spelling is deliberately NOT a separate option: `searchContexts`
// queries both for this one value, so offering two entries would present a
// storage detail as a choice and let an operator pick the narrower half.
const TYPES = ['data_snapshot', 'analysis', 'prediction', 'alert', KEY_REVOCATION_TYPE];

// Registry-derived status facet (RFC-ACDP-0004 §4 + RFC-ACDP-0013 'retracted').
const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'active' },
  { value: 'retracted', label: 'retracted' },
];

interface Criteria extends ContextSearchParams {
  authority: RegistryAuthority | 'all';
}

const EMPTY: Criteria = { authority: 'a', q: '', type: '', domain: '', tags: '', visibility: 'all', status: '' };

export default function ContextsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [form, setForm] = useState<Criteria>(EMPTY);
  const [applied, setApplied] = useState<Criteria>(EMPTY);
  const [openCtx, setOpenCtx] = useState<string | null>(null);

  const set = <K extends keyof Criteria>(key: K, value: Criteria[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const search = useInfiniteQuery({
    queryKey: ['context-search', applied, demoMode],
    queryFn: ({ pageParam }) => {
      const { authority, ...params } = applied;
      return searchContexts(authority, { ...params, cursor: pageParam }, demoMode);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor,
  });

  const detail = useQuery({
    queryKey: ['context', openCtx, demoMode],
    queryFn: () => getContext(openCtx!, demoMode),
    enabled: !!openCtx,
  });

  // The federation proxy's verifyCtxIdBinding check (fail-closed, 502) rejecting
  // this fetch is a worse signal than "not found" or "service down" — the
  // registry served a body that doesn't match its own claimed ctx_id — so it
  // gets a distinct, trust-hostile message rather than the generic one below.
  const bindingMismatch =
    detail.error instanceof ApiError &&
    (detail.error.errorCode === 'CONTEXT_ID_MISMATCH' || detail.error.errorCode === 'CONTEXT_BINDING_UNVERIFIABLE');

  // A hit the search index knows about but for which no body can be fetched.
  // Distinct from the generic failure because it is not a failure: the index
  // and the store legitimately disagree (a retracted-then-purged body, or — in
  // demo mode — the synthetic interim-form revocation hit, which has no signed
  // body by design). Saying "could not load" invites a retry that cannot help.
  const bodyUnavailable = detail.error instanceof ApiError && detail.error.isNotFound;

  const matches = search.data?.pages.flatMap((p) => p.matches) ?? [];
  const partial = search.data?.pages.some((p) => p.partial) ?? false;
  const total = search.data?.pages[0]?.total_estimate;
  // Whether the response was a client-side merge of several upstream queries —
  // read off the response rather than re-derived from the form, so the page and
  // `searchContexts` cannot disagree about which queries fan out. It covers BOTH
  // merges: the two revocation type spellings, and `authority === 'all'`.
  const merged = search.data?.pages[0]?.merged ?? false;

  const runSearch = () => setApplied(form);

  return (
    <div className="page">
      <SectionTitle icon={Boxes} title="Contexts" sub="Search across registries" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="form-input"
          placeholder="Search contexts…"
          aria-label="Search contexts"
          style={{ flex: 1 }}
          value={form.q}
          onChange={(e) => set('q', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <select
          className="form-input"
          style={{ width: 130 }}
          aria-label="Search registry"
          value={form.authority}
          onChange={(e) => set('authority', e.target.value as RegistryAuthority | 'all')}
        >
          {REGISTRIES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={runSearch}>
          Search
        </Button>
      </div>

      {/* Facets */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          className="form-input"
          style={{ width: 150 }}
          value={form.type}
          aria-label="Filter by type"
          onChange={(e) => set('type', e.target.value)}
        >
          <option value="">Any type</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ width: 140 }}
          value={form.status}
          aria-label="Filter by status"
          onChange={(e) => set('status', e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ width: 140 }}
          value={form.visibility}
          aria-label="Filter by visibility"
          onChange={(e) => set('visibility', e.target.value)}
        >
          <option value="all">All visibility</option>
          <option value="public">public</option>
          <option value="restricted">restricted</option>
          <option value="private">private</option>
        </select>
        <input
          className="form-input"
          style={{ width: 150 }}
          placeholder="domain"
          aria-label="Filter by domain"
          value={form.domain}
          onChange={(e) => set('domain', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <input
          className="form-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="tags (comma-separated)"
          aria-label="Filter by tags"
          value={form.tags}
          onChange={(e) => set('tags', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
      </div>

      {partial && (
        <div style={{ fontSize: 11, color: C.warning, marginBottom: 10 }}>
          {/* Not "one registry did not respond" any more: `partial` is now set
              by a failure on EITHER fan-out axis, and the type-spelling axis
              queries the same registry twice. Blaming a registry that is up
              would be this phase's own defect class in a warning banner. */}
          ⚠ One of the upstream queries did not respond — results may be incomplete.
        </div>
      )}

      {search.isLoading && <LoadingSkeleton rows={4} height={84} />}
      {search.error && <ErrorPanel message={String(search.error)} />}
      {/* Three distinct zero-match states, because they mean three different
          things and only one of them is "there are none".

          1. A live cursor. acdp-registry-core documents the short-page contract
             verbatim: a page consumed by the handler's visibility/tenant
             post-filters "can return FEWER than the requested `limit` rows
             while still emitting a non-`None` `next_cursor`. A short page is
             therefore NOT an end-of-results signal — clients MUST keep paging
             until `next_cursor` is `None`." This page used to answer that with
             "No contexts found" and no way forward.
          2. A MERGED response — the two revocation type spellings, or both
             registries, or both. A merge carries no cursor (see
             `searchContexts`), so `hasNextPage` is always false and case 1 can
             never catch it; falling through to the flat empty state would
             reinstate the very MUST violation above on exactly the queries
             where several upstream result sets were each truncated.
          3. Genuinely nothing, with the result set exhausted. Only here may the
             page say so. */}
      {search.data &&
        matches.length === 0 &&
        (search.hasNextPage ? (
          <EmptyState
            title="No matches on this page"
            description="The registry returned a short page — filtered rows still count against the page size — and more pages remain. Keep loading before concluding there are none."
          />
        ) : merged ? (
          <EmptyState
            title="No matches in this view"
            description="This is a merged view — several queries, each showing only its first page, with no way to page a merged result set coherently. It is not a statement that no such contexts exist."
          />
        ) : (
          <EmptyState title="No contexts found" />
        ))}
      {matches.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
            {matches.length}
            {typeof total === 'number' && total > matches.length ? ` of ~${total}` : ''} context
            {matches.length === 1 ? '' : 's'}
            {/* A merged response has no cursor, so a full page here is a CAP,
                not a total. Without this the count read "20 contexts" for a
                query that only ever saw the first page of each of its parts —
                the same claim-without-looking the empty states above avoid,
                surviving in the one case where results were actually found. */}
            {merged && ' · merged view: first page of each query, not the whole result set'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map((hit) => (
              <ContextCard key={hit.ctx_id} hit={hit} onOpen={setOpenCtx} />
            ))}
          </div>
        </>
      )}
      {/* Outside the `matches.length > 0` block on purpose — that gate is what
          made a fully-filtered short page a dead end. */}
      {search.hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <Button
            variant="secondary"
            onClick={() => search.fetchNextPage()}
            disabled={search.isFetchingNextPage}
          >
            {search.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <Modal open={!!openCtx} onClose={() => setOpenCtx(null)} title={detail.data?.body.title ?? 'Context'}>
        {detail.isLoading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>}
        {detail.error && bindingMismatch && (
          <ErrorPanel message="Registry served a context that doesn't match its own claimed id — this response cannot be trusted." />
        )}
        {detail.error && !bindingMismatch && bodyUnavailable && (
          <EmptyState
            title="No context body available"
            description="The registry index lists this context, but no body was returned for its id. Nothing here has failed verification — there is simply nothing to verify."
          />
        )}
        {detail.error && !bindingMismatch && !bodyUnavailable && <ErrorPanel message="Could not load context." />}
        {/* requestedCtxId is `openCtx` (the search hit the operator clicked), never
            `detail.data.body.ctx_id` — a genuine independent request/response pair,
            so the ctxIdBinding chip actually catches a registry serving the wrong
            context, not just the same value compared to itself. */}
        {openCtx && detail.data && <ContextDetail ctx={detail.data} requestedCtxId={openCtx} />}
      </Modal>
    </div>
  );
}
