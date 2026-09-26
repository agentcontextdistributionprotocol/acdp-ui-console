'use client';

import { ShieldCheck, KeyRound, Ban, ScrollText } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { LogWitnessCard } from '@/components/registries/log-witness-card';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useRevocations, useRegistryJwks } from '@/lib/hooks/use-security';
import { useRegistries } from '@/lib/hooks/use-registries';
import { ApiError } from '@/lib/api/fetcher';
import { formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { timeAgo, clockTime, shortId } from '@/lib/utils/format';
import { C } from '@/lib/colors';
import type { RegistryAuthority } from '@/lib/types';

export default function SecurityPage() {
  return (
    <div className="page">
      <SectionTitle icon={ShieldCheck} title="Security" sub="Token revocations + registry signing keys" />
      <RevocationFeed />
      <div style={{ height: 18 }} />
      <SigningKeys />
      <div style={{ height: 18 }} />
      <LogWitness />
    </div>
  );
}

function RevocationFeed() {
  const revs = useRevocations();
  const entries = revs.data?.pages.flatMap((p) => p.entries) ?? [];
  const forbidden = revs.error instanceof ApiError && revs.error.status === 403;

  return (
    <div className="card">
      <div className="feed-header">
        <h2>
          <Ban size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Revocation feed
        </h2>
        <span className="card-sub">Cross-issuer revoked tokens · admin-only</span>
      </div>
      <div className="card-body">
        {revs.isLoading && <LoadingSkeleton rows={4} height={36} />}
        {forbidden && (
          <ErrorPanel message="The control-plane key configured server-side (CONTROL_PLANE_API_KEY) is not an admin key. This is set as a deployment environment variable, not from the console UI — ask whoever deployed this console to grant it admin scope." />
        )}
        {revs.error && !forbidden && <ErrorPanel message={String(revs.error)} />}
        {!revs.isLoading && !revs.error && entries.length === 0 && (
          <EmptyState title="No revocations recorded" />
        )}
        {entries.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Issuer</th>
                <th>JTI</th>
                <th>Revoked</th>
                <th>Original expiry</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.jti}>
                  <td className="did">{formatAgentDid(e.sub)}</td>
                  <td>{shortAuthority(e.iss)}</td>
                  <td className="did">{e.jti}</td>
                  <td>{timeAgo(e.revoked_at_ms)}</td>
                  <td style={{ color: C.muted }}>{clockTime(e.exp * 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {revs.hasNextPage && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <Button variant="secondary" onClick={() => revs.fetchNextPage()} disabled={revs.isFetchingNextPage}>
              {revs.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SigningKeys() {
  return (
    <div className="grid-2">
      <JwksCard authority="a" label="Registry A" />
      <JwksCard authority="b" label="Registry B" />
    </div>
  );
}

/**
 * Transparency-log witness quorum, one card per registry (RFC-ACDP-0012).
 *
 * The registry list comes from `useRegistries()` rather than the hardcoded
 * `a`/`b` pair `SigningKeys` uses, because this endpoint lives on the control
 * plane and is keyed by DNS authority, so the section grows on its own rather
 * than being edited. JWKS stays hardcoded because it is fetched from the two
 * proxied registry services directly.
 *
 * Note this is the OBSERVED list (`GET /registries`, populated by webhook
 * ingest), not the ENROLLED one (`/registries/enrollments`) — they are
 * different tables. So a registry that is enrolled but has never emitted an
 * event gets no card, and one that is observed without being enrolled does.
 * Observed is the right list here, because witness state only exists for a
 * registry the control plane has actually been talking to.
 *
 * Each card renders nothing at all when its authority has no witness state
 * (a 404), so the section can legitimately end up empty.
 */
function LogWitness() {
  const registries = useRegistries();
  const rows = registries.data ?? [];
  if (rows.length === 0) return null;

  return (
    <>
      <div className="feed-header" style={{ border: 'none', paddingBottom: 6 }}>
        <h2>
          <ScrollText size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Transparency-log witness
        </h2>
        <span className="card-sub">Witnessed checkpoints + cosignature quorum · RFC-ACDP-0012</span>
      </div>
      <div className="grid-2">
        {rows.map((r) => (
          <LogWitnessCard key={r.authority} authority={r.authority} />
        ))}
      </div>
    </>
  );
}

function JwksCard({ authority, label }: { authority: RegistryAuthority; label: string }) {
  const jwks = useRegistryJwks(authority);
  const keys = jwks.data?.keys ?? [];

  return (
    <div className="card">
      <div className="feed-header">
        <h2>
          <KeyRound size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {label} signing keys
        </h2>
        <span className="card-sub">/.well-known/jwks.json</span>
      </div>
      <div className="card-body">
        {jwks.isLoading && <LoadingSkeleton rows={2} height={48} />}
        {jwks.error && <ErrorPanel message="Could not load JWKS." />}
        {!jwks.isLoading && !jwks.error && keys.length === 0 && <EmptyState title="No published keys" />}
        {keys.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {keys.map((k, i) => (
              <div key={k.kid ?? i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  {k.kid && <span className="chip ok">{k.kid}</span>}
                  <span className="chip">{k.kty}</span>
                  {k.crv && <span className="chip mode-dual">{k.crv}</span>}
                  {k.alg && <span className="chip">{k.alg}</span>}
                  {k.use && <span className="chip">{k.use}</span>}
                </div>
                {(k.x || k.n) && (
                  <div className="did" style={{ fontSize: 10.5, color: C.muted }}>
                    {k.x ? `x: ${shortId(k.x, 18, 6)}` : `n: ${shortId(k.n, 18, 6)}`}
                    {k.y ? ` · y: ${shortId(k.y, 18, 6)}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
