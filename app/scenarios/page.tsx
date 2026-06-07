'use client';

import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ScenarioCard } from '@/components/scenarios/scenario-card';
import { LaunchModal } from '@/components/scenarios/launch-modal';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import type { ScenarioDef } from '@/lib/types';

const MODE_FILTERS = [
  { id: 'all', label: 'All modes' },
  { id: 'single', label: 'Single' },
  { id: 'dual', label: 'Dual' },
  { id: 'cross_org', label: 'Cross-org' },
];

export default function ScenariosPage() {
  const { data, isLoading, error } = useScenarios();
  const [selected, setSelected] = useState<ScenarioDef | null>(null);
  const [modeFilter, setModeFilter] = useState('all');

  const filtered = useMemo(() => {
    let list = data ?? [];
    if (modeFilter !== 'all') list = list.filter((s) => s.registry_mode === modeFilter);
    return list;
  }, [data, modeFilter]);

  return (
    <div className="page">
      <SectionTitle
        icon={FlaskConical}
        title="Scenarios"
        sub={`${data?.length ?? 0} runnable scenarios · click to launch`}
        right={
          <div className="topbar-pills">
            {MODE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`pill${modeFilter === f.id ? ' active-pill' : ''}`}
                aria-pressed={modeFilter === f.id}
                onClick={() => setModeFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading && <LoadingSkeleton rows={6} height={120} />}
      {error && <ErrorPanel message={String(error)} />}
      {!isLoading && !error && filtered.length === 0 && <EmptyState title="No scenarios match this filter" />}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="scenario-grid">
          {filtered.map((s) => (
            <ScenarioCard key={s.id} scenario={s} onLaunch={setSelected} />
          ))}
        </div>
      )}

      <LaunchModal scenario={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
