'use client';

import { Database } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { RegistryCard } from '@/components/registries/registry-card';
import { Enrollments } from '@/components/registries/enrollments';
import { useRegistries, useRegistryCapabilities } from '@/lib/hooks/use-registries';
import { shortAuthority } from '@/lib/utils/acdp';

export default function RegistriesPage() {
  const { data, isLoading, error } = useRegistries();
  const capsA = useRegistryCapabilities('a');
  const capsB = useRegistryCapabilities('b');
  // Registry C: the receipts / ACDP 0.3.0 trust-profile registry.
  const capsC = useRegistryCapabilities('c');
  // Match each observed registry to its capabilities by its short host label,
  // so ordering (or a 4th registry) can't misalign the cards.
  const capsByHost: Record<string, ReturnType<typeof useRegistryCapabilities>['data']> = {
    'registry-a': capsA.data,
    'registry-b': capsB.data,
    'registry-c': capsC.data,
  };

  return (
    <div className="page">
      <SectionTitle icon={Database} title="Registries" sub="Known registries + live capabilities" />

      {isLoading && <LoadingSkeleton rows={2} height={220} />}
      {error && <ErrorPanel message={String(error)} />}
      {data && data.length === 0 && <EmptyState title="No registries observed yet" />}
      {data && data.length > 0 && (
        <div className="grid-3">
          {data.map((reg) => (
            <RegistryCard
              key={reg.authority}
              registry={reg}
              capabilities={capsByHost[shortAuthority(reg.authority)]}
            />
          ))}
        </div>
      )}

      <div style={{ height: 18 }} />
      <Enrollments />
    </div>
  );
}
