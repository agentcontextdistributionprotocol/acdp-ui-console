'use client';

import { ShieldCheck, KeyRound, Ban } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useRevocations, useRegistryJwks } from '@/lib/hooks/use-security';
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
          <ErrorPanel message="The configured control-plane key is not an admin key. Set an admin API key in Config to view the revocation feed." />
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
    <div className="grid-3">
      <JwksCard authority="a" label="Registry A" />
      <JwksCard authority="b" label="Registry B" />
      <JwksCard authority="c" label="Registry C" />
    </div>
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
