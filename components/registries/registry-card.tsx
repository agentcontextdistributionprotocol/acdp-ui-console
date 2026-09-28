'use client';

import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { formatNumber, timeAgo } from '@/lib/utils/format';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';

/**
 * The ids a registry may advertise — a local mirror of
 * `REGISTRY_ADVERTISABLE_PROFILES`
 * (`acdp-registry-rs/crates/acdp-registry-types/src/config.rs:332-340`), the
 * set `acdp-registry-server/src/main.rs:415-431` enforces at STARTUP, so a
 * registry advertising anything outside it does not boot.
 *
 * It is `as const` and it types the copy table below, which is the point:
 * "`PROFILE_INFO` has copy for exactly these seven ids" then stops being a
 * claim a test has to police and becomes a condition `tsc` enforces. An eighth
 * key is an excess-property error; a missing one is a missing-property error.
 * Six successive test-shaped guards failed to hold that line (the list, and the
 * authoritative count, are in `test/support/profile-copy-table.ts`'s header —
 * restating either here is how five files came to disagree about it); the type
 * system holds it for free.
 *
 * It is mirrored rather than imported because the shared mirror lives under
 * `test/`, and production code must not import from the test tree.
 * `registry-card-profiles.test.tsx` asserts the two mirrors are identical, so
 * they cannot drift.
 */
const ADVERTISABLE_PROFILE_IDS = [
  'acdp-registry-core',
  'acdp-registry-discovery',
  'acdp-registry-federated',
  'acdp-registry-receipts',
  'acdp-registry-head-receipts',
  'acdp-registry-transparency-log',
  'acdp-registry-lifecycle',
] as const;

type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];

/**
 * Tooltip copy for known registry profiles (registries/profiles.md). The
 * 0.3.0 trust profiles get an accent chip so they stand out in the list.
 *
 * Entries for `acdp-consumer` and `acdp-federated` were removed with #95: the
 * first is a profile a registry is forbidden to advertise and the second is not
 * a spec id at all, so copy for either was unreachable text that ratified two
 * invalid ids for whoever read it next. An id with no entry here still renders
 * — see `glossFor` and the fallback below — so removing them costs nothing if
 * one somehow reappears.
 *
 * **Not exported, and that is a fix rather than an oversight.** Exporting it so
 * a test could read `Object.keys` OPENED A ROUTE THAT DID NOT EXIST BEFORE: any
 * module could then `import { PROFILE_INFO }` and assign a key at module scope,
 * and because Vitest isolates module graphs per test file the guard went on
 * seeing a pristine seven while the app rendered the copy #95 deleted.
 *
 * WHAT GUARDS THIS, honestly, because five earlier versions of this comment
 * each over-claimed and the over-claim is how the next hole got missed:
 *
 *   - `tsc` bounds THE KEYS OF THIS OBJECT, via the type above. Exactly seven,
 *     exactly these. Nothing else is needed for that claim.
 *   - `assertNoCopyOutsideTable()` bounds THE REST OF THIS FILE: it walks the
 *     whole file, not just module scope, and refuses any other object literal
 *     carrying a `title`. A second lookup table, a gloss built inside the
 *     component, a parameter default, a nested component with its own table
 *     and a JSX-spread `{...{title}}` are all that shape. A module-scope-only
 *     guard shipped once and lost five kills the version before it had.
 *   - `assertModuleShape()` bounds WHAT MAY BE IMPORTED — by binding name, not
 *     just by module specifier. Allow-listing a specifier alone left four
 *     unbounded suppliers of copy: `import { PROFILE_GLOSS } from
 *     '@/lib/utils/format'` was on the allow-list. Binding names narrow WHICH
 *     suppliers remain unbounded; they do not close the channel, because a
 *     name says nothing about the value behind it. `timeAgo` could be edited
 *     to return copy. The render probes are what catch that.
 *   - `assertNoRuntimeCopyForms()` bounds the VERBS that attach copy with no
 *     property literal to find — `Object.assign`/`create`/`defineProperty`/
 *     `setPrototypeOf`, `Reflect.*`, `new Proxy`. A check like this existed
 *     two revisions ago and was deleted by a "fix"; an in-body Proxy get-trap
 *     went red to green on that commit.
 *   - `assertNoAlternateDisclosureChannel()` bounds `aria-*`, `data-*` and
 *     `dangerouslySetInnerHTML`. A comment used to assert the render probes
 *     read those. They read `title`, `className` and `textContent`.
 *   - The render probes bound WHAT REACHES THE SCREEN, across a matrix of both
 *     props. Neither prop axis may be fixed: copy conditioned on
 *     `registry.authority` was invisible to a probe that always passed
 *     registry-b, and that is exactly the defect #95 is — copy for an id one
 *     deployment cannot advertise. POSITION within `capabilities.profiles` is
 *     the third axis and was fixed for two rounds after the other two were
 *     varied: every probe rendered a one-element array, so a gloss gated on
 *     `i > 0` disclosed freely. All three vary now.
 *
 * Their honest residual: no test can quantify over every possible id string, so
 * the probe universe is a sample (the seven, the three forbidden ones, shape
 * variants, and the `Object.prototype` names). That gap is why the type bound
 * and the file bound exist, and why none of them is described as complete.
 */
const PROFILE_INFO: Record<AdvertisableProfileId, { title: string; accent?: boolean }> = {
  'acdp-registry-core': { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-discovery': { title: 'Search / discovery endpoints (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-federated': { title: 'Cross-registry federation (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-receipts': {
    title: 'Signed registry receipts at publish time (RFC-ACDP-0010, acdp 0.2.0)',
  },
  'acdp-registry-head-receipts': {
    title: 'Lineage-head receipts: signed serve-time head attestations (RFC-ACDP-0011, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-transparency-log': {
    title: 'Append-only transparency log with inclusion proofs (RFC-ACDP-0012, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-lifecycle': {
    title: 'Signed lifecycle events: retraction / republication (RFC-ACDP-0013, acdp 0.3.0)',
    accent: true,
  },
};

/**
 * The ONE place a profile chip's gloss may come from.
 *
 * A single choke point rather than an inline `PROFILE_INFO[p]`, for three
 * reasons.
 *
 * It gates on the ID LIST, not on the table, so the advertisable set decides
 * what may be glossed in the running app as well as at typecheck time. The two
 * cannot disagree — the list is the table's key type — but the gate is where a
 * future edit that breaks that would show up.
 *
 * It refuses an inherited property. `PROFILE_INFO['toString']` walks the
 * prototype chain and returns a FUNCTION, which is truthy, so a registry
 * advertising a profile called `constructor` or `toString` would have reached
 * `info.accent` on an object that is not copy at all.
 *
 * And a named lookup gives the render probes and `assertNoCopyOutsideTable()`
 * one thing to bound. A gloss appearing from anywhere else is then a visible,
 * checkable second source rather than one more expression among many.
 */
function glossFor(p: string): { title: string; accent?: boolean } | undefined {
  // `as readonly string[]` only to widen the `as const` tuple for `.includes`,
  // which otherwise refuses an arbitrary string — the runtime check is the
  // point and is not weakened by it.
  if (!(ADVERTISABLE_PROFILE_IDS as readonly string[]).includes(p)) return undefined;
  return PROFILE_INFO[p as AdvertisableProfileId];
}

export function RegistryCard({
  registry,
  capabilities,
}: {
  registry: KnownRegistry;
  capabilities?: RegistryCapabilities;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="ok" />
          <h2>{registry.authority}</h2>
        </div>
        <Badge variant="complete">● healthy</Badge>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="metric-row">
          <span className="metric-name">Event count</span>
          <span className="metric-val">{formatNumber(registry.eventCount)}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Base URL</span>
          <span className="did">{registry.baseUrl ?? '—'}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Last seen</span>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{timeAgo(registry.lastSeen)}</span>
        </div>
        {capabilities && (
          <>
            <div className="metric-row">
              <span className="metric-name">ACDP version</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>{capabilities.acdp_version}</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Algorithms</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {capabilities.supported_signature_algorithms.join(', ')}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Profiles</span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {capabilities.profiles.map((p) => {
                  const info = glossFor(p);
                  return (
                    <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>
                      {p}
                    </span>
                  );
                })}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Max payload</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {Math.round(capabilities.limits.max_payload_bytes / 1024)} KB
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Anon reads</span>
              <Badge variant={capabilities.anonymous_public_reads ? 'pub' : 'neutral'}>
                {capabilities.anonymous_public_reads ? 'enabled' : 'disabled'}
              </Badge>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
