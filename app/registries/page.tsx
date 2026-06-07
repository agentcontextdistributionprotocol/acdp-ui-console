'use client';

import { Database } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { RegistryCard } from '@/components/registries/registry-card';
import { Enrollments } from '@/components/registries/enrollments';
import { useRegistries, useRegistryCapabilities } from '@/lib/hooks/use-registries';

export default function RegistriesPage() {
  const { data, isLoading, error } = useRegistries();
  const capsA = useRegistryCapabilities('a');
  const capsB = useRegistryCapabilities('b');

  return (
    <div className="page">
      <SectionTitle icon={Database} title="Registries" sub="Known registries + live capabilities" />

      {isLoading && <LoadingSkeleton rows={2} height={220} />}
      {error && <ErrorPanel message={String(error)} />}
      {data && data.length === 0 && <EmptyState title="No registries observed yet" />}
      {data && data.length > 0 && (
        <div className="grid-2">
          {data.map((reg, i) => (
            <RegistryCard
              key={reg.authority}
              registry={reg}
              capabilities={i === 0 ? capsA.data : i === 1 ? capsB.data : undefined}
            />
          ))}
        </div>
      )}

      <div style={{ height: 18 }} />
      <Enrollments />
    </div>
  );
}
