'use client';

import { useHealth } from '@/lib/hooks/use-health';
import type { ProxyService } from '@/lib/types';

const SERVICES: { service: ProxyService; name: string; port: string }[] = [
  { service: 'playground', name: 'Playground', port: ':8000' },
  { service: 'control-plane', name: 'Control Plane', port: ':3001' },
  { service: 'registry-a', name: 'Registry A', port: ':8100' },
  { service: 'registry-b', name: 'Registry B', port: ':8200' },
];

function HealthCard({ service, name, port }: { service: ProxyService; name: string; port: string }) {
  // The `useQuery` config that was here was byte-identical to the one in
  // `components/layout/connection-status.tsx` — same key tuple, same
  // `refetchInterval`, same `retry: false` — and so was the `?? 'unreachable'`
  // word expression. Both now live in `useHealth`, which is also where the
  // word's meaning is documented. Two copies of a cache key are worse than
  // ordinary duplication: they share the cache entry, so changing one file's
  // config silently changed the other surface too.
  const view = useHealth(service);
  const ok = view.kind === 'healthy';
  return (
    <div className="health-card">
      <div className="health-name">{name}</div>
      <div className="health-url">{port}</div>
      <div className="health-status">
        {/* Three dots and three colours, not two. The word already said
            `checking…` here while the dot beside it said red — the card
            contradicted itself on the first render of every visit, and the dot
            is the part an operator scans. `warn` is the only one of the three
            that is not a verdict. */}
        <span className={`dot ${ok ? 'ok' : view.kind === 'checking' ? 'warn' : 'err'}`} />
        <span
          style={{
            color: ok ? 'var(--success)' : view.kind === 'checking' ? 'var(--muted)' : 'var(--danger)',
          }}
        >
          {view.word}
        </span>
        {/* The latency stays beside the word, and the word is why. A control
            plane whose database is down answers in milliseconds, so
            "unreachable · 8 ms" was a self-contradiction on the screen; with
            `degraded` there it reads as corroboration instead. `useHealth`
            carries `latencyMs` on both settled arms for this. */}
        {view.kind !== 'checking' && view.latencyMs !== undefined && (
          <span className="health-latency">{view.latencyMs} ms</span>
        )}
      </div>
    </div>
  );
}

export function HealthChecks() {
  return (
    <div className="health-grid">
      {SERVICES.map((s) => (
        <HealthCard key={s.service} {...s} />
      ))}
    </div>
  );
}
