'use client';

import { useQuery } from '@tanstack/react-query';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { ProxyService } from '@/lib/types';

/**
 * What an operator is told about one service, as a discriminated union rather
 * than a bag of optional fields.
 *
 * `word` is the rendered text and it is part of the type, not derived at the
 * call site, because the whole defect this replaces was two components deriving
 * it separately and one of them getting it wrong. `kind` is what callers branch
 * on for styling; nobody needs to reconstruct "is this bad" from the word.
 *
 * `latencyMs` rides along on both settled arms and that is deliberate: a
 * `degraded` service answered, so its latency is real and worth showing beside
 * the word. On `failing` it is frequently the most informative thing on the
 * card — "degraded · 8 ms" and "unreachable · 30 ms" (a connection refused
 * fast) read very differently.
 *
 * `word` on the failing arm is typed as the closed union but carries whatever
 * string `detail` actually held; see the cast note in the hook.
 */
export type HealthView =
  | { kind: 'checking'; word: 'checking…' }
  | { kind: 'healthy'; word: 'healthy'; latencyMs?: number; version?: string }
  | { kind: 'failing'; word: 'degraded' | 'unreachable'; latencyMs?: number };

/**
 * The single definition of what an operator is told about one service's health.
 *
 * ## Why a hook and not `healthWord(result, isLoading)`
 *
 * A two-argument helper can be called in a state that does not exist.
 * `healthWord(undefined, false)` — no data, not loading — would have to answer
 * something, and the honest answer is "I have no idea"; every implementation
 * returns `'unreachable'` instead, which asserts a service is dead from the
 * absence of any evidence at all. That is the same over-claim as the tooltip
 * this hook replaces, just relocated. A hook that owns the query cannot be
 * asked the incoherent question: `data === undefined && !isLoading` is not
 * reachable from inside it for a query with no `enabled` gate.
 *
 * ## Why it also owns the query
 *
 * `connection-status.tsx` and `health-checks.tsx` held BYTE-IDENTICAL
 * `useQuery` configs — same key tuple `['health', service, demoMode]`, same
 * `refetchInterval: 15_000`, same `retry: false`. Two copies of a cache key are
 * a silent correctness hazard, not just duplication: they share a cache entry,
 * so a divergence in either config changes the other surface's behaviour
 * without touching its file.
 *
 * `retry: false` is kept, not inherited. A health probe that retries reports
 * the retry's outcome, and the operator is watching a 15-second poll — the next
 * honest answer is closer than a backoff.
 *
 * ## What does NOT use this
 *
 * `components/config/sdk-matrix.tsx` keeps its own `useQueries`. It probes four
 * services in one render, which `useHealth(service)` cannot express, and it
 * needs the raw `HealthResult` (it reads `version`, which only its table
 * shows). Do not "unify" them by calling this hook four times — that is four
 * independent subscriptions where one batched call does, and `useQueries`
 * exists precisely for that shape. It feeds `buildSdkMatrixRows` instead, which
 * carries `detail` onto the row.
 */
export function useHealth(service: ProxyService): HealthView {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const { data, isLoading } = useQuery({
    queryKey: ['health', service, demoMode],
    queryFn: () => pingHealth(service, demoMode),
    refetchInterval: 15_000,
    retry: false,
  });

  // `isLoading` is React Query's first-fetch-only flag, not "a fetch is in
  // flight". A service that was green and has just gone dark therefore reports
  // `unreachable`, NOT `checking…` — the 15-second refetch does not blank the
  // word it already has. That is the right way round: an operator watching a
  // service fail should see it fail, not see the display go coy.
  //
  // `data === undefined` is a NARROWING, not a second state. `pingHealth`
  // resolves a `HealthResult` on every path — its `catch` returns
  // `{ ok: false, detail: failureKind(err) }` rather than rethrowing
  // (`lib/api/client.ts:170-187`) — so this query has no error arm to reach and
  // "settled with no data" does not occur. The test suite pins that: a
  // rejecting probe is what a `healthWord(undefined, false)` helper would have
  // answered `unreachable` to, and the reason this is a hook.
  if (isLoading || data === undefined) return { kind: 'checking', word: 'checking…' };

  if (data.ok) {
    return { kind: 'healthy', word: 'healthy', latencyMs: data.latencyMs, version: data.version };
  }

  // `detail` is a closed union in TypeScript and an arbitrary string at
  // runtime — a newer backend, a hand-built fixture, a future `pingHealth`
  // arm. Surfacing whatever it holds is the conservative choice: an unfamiliar
  // word tells the operator something answered and said this, while
  // substituting `unreachable` for it would report a service that demonstrably
  // replied as one that never did. The `??` default covers a pre-`detail`
  // result, where `unreachable` was the only word these surfaces ever said.
  return {
    kind: 'failing',
    word: (data.detail ?? 'unreachable') as 'degraded' | 'unreachable',
    latencyMs: data.latencyMs,
  };
}
