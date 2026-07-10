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
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';
import type { ContextSearchParams, RegistryAuthority } from '@/lib/types';

const REGISTRIES: { id: RegistryAuthority | 'all'; label: string }[] = [
  { id: 'a', label: 'Registry A' },
  { id: 'b', label: 'Registry B' },
  { id: 'c', label: 'Registry C' },
  { id: 'all', label: 'All' },
];

const TYPES = ['data_snapshot', 'analysis', 'prediction', 'alert'];

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

  const matches = search.data?.pages.flatMap((p) => p.matches) ?? [];
  const partial = search.data?.pages.some((p) => p.partial) ?? false;
  const total = search.data?.pages[0]?.total_estimate;

  const runSearch = () => setApplied(form);

  return (
    <div className="page">
      <SectionTitle icon={Boxes} title="Contexts" sub="Search across registries" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="form-input"
          placeholder="Search contexts…"
          style={{ flex: 1 }}
          value={form.q}
          onChange={(e) => set('q', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <select
          className="form-input"
          style={{ width: 130 }}
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
        <select className="form-input" style={{ width: 150 }} value={form.type} onChange={(e) => set('type', e.target.value)}>
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
          value={form.domain}
          onChange={(e) => set('domain', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <input
          className="form-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="tags (comma-separated)"
          value={form.tags}
          onChange={(e) => set('tags', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
      </div>

      {partial && (
        <div style={{ fontSize: 11, color: C.warning, marginBottom: 10 }}>
          ⚠ One registry did not respond — results may be incomplete.
        </div>
      )}

      {search.isLoading && <LoadingSkeleton rows={4} height={84} />}
      {search.error && <ErrorPanel message={String(search.error)} />}
      {search.data && matches.length === 0 && <EmptyState title="No contexts found" />}
      {matches.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
            {matches.length}
            {typeof total === 'number' && total > matches.length ? ` of ~${total}` : ''} context
            {matches.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map((hit) => (
              <ContextCard key={hit.ctx_id} hit={hit} onOpen={setOpenCtx} />
            ))}
          </div>
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
        </>
      )}

      <Modal open={!!openCtx} onClose={() => setOpenCtx(null)} title={detail.data?.body.title ?? 'Context'}>
        {detail.isLoading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>}
        {detail.error && <ErrorPanel message="Could not load context." />}
        {detail.data && <ContextDetail ctx={detail.data} />}
      </Modal>
    </div>
  );
}
