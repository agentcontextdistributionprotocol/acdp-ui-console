'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ContextCard } from '@/components/contexts/context-card';
import { searchContexts, getContext } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { RegistryAuthority } from '@/lib/types';

const REGISTRIES: { id: RegistryAuthority | 'both'; label: string }[] = [
  { id: 'a', label: 'Registry A' },
  { id: 'b', label: 'Registry B' },
  { id: 'both', label: 'Both' },
];

export default function ContextsPage() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [authority, setAuthority] = useState<RegistryAuthority | 'both'>('a');
  const [visibility, setVisibility] = useState('all');
  const [openCtx, setOpenCtx] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['context-search', submitted, authority, visibility, demoMode],
    queryFn: () => searchContexts(authority, submitted, visibility, demoMode),
  });

  const detail = useQuery({
    queryKey: ['context', openCtx, demoMode],
    queryFn: () => getContext(openCtx!, demoMode),
    enabled: !!openCtx,
  });

  const runSearch = () => setSubmitted(query);

  return (
    <div className="page">
      <SectionTitle icon={Boxes} title="Contexts" sub="Search across registries" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          className="form-input"
          placeholder="Search contexts…"
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <select
          className="form-input"
          style={{ width: 130 }}
          value={authority}
          onChange={(e) => setAuthority(e.target.value as RegistryAuthority | 'both')}
        >
          {REGISTRIES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ width: 130 }}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="all">All visibility</option>
          <option value="public">public</option>
          <option value="restricted">restricted</option>
        </select>
        <Button variant="primary" onClick={runSearch}>
          Search
        </Button>
      </div>

      {search.isLoading && <LoadingSkeleton rows={4} height={84} />}
      {search.error && <ErrorPanel message={String(search.error)} />}
      {search.data && search.data.matches.length === 0 && <EmptyState title="No contexts found" />}
      {search.data && search.data.matches.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {search.data.matches.map((hit) => (
            <ContextCard key={hit.ctx_id} hit={hit} onOpen={setOpenCtx} />
          ))}
        </div>
      )}

      <Modal open={!!openCtx} onClose={() => setOpenCtx(null)} title={detail.data?.body.title ?? 'Context'}>
        {detail.isLoading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>}
        {detail.data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="chip">{detail.data.body.type}</span>
              <span className="chip">{detail.data.body.visibility}</span>
              <span className="chip ok">{detail.data.registry_state.status}</span>
              <span className="chip">v{detail.data.body.version}</span>
            </div>
            <JsonViewer data={detail.data.body} style={{ maxHeight: 380 }} />
          </div>
        )}
      </Modal>
    </div>
  );
}
