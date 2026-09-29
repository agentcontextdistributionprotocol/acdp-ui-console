import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as MockCrypto from '@/lib/data/mock-crypto';
import {
  MOCK_SCENARIOS,
  MOCK_CONTEXT_EVENTS,
  MOCK_RUNS,
  MOCK_RUN_EVENTS,
  MOCK_LINEAGE,
  LIVE_RUN_ID,
  MOCK_DASHBOARD,
  MOCK_CONTEXTS,
  MOCK_LINEAGE_CHAINS,
  MOCK_REVOCATIONS,
  MOCK_JWKS,
  MOCK_ENROLLMENTS,
  MOCK_CAPABILITIES,
  MOCK_SDK_MATRIX,
  MOCK_AGENTS,
  SCENARIO_COUNT,
} from '@/lib/data/mock-data';
import * as MockData from '@/lib/data/mock-data';
import { scenarioNumber } from '@/components/scenarios/scenario-card';
import packageLock from '@/package-lock.json';
import { profileCopyTable } from '../support/profile-copy-table';
import {
  REGISTRY_ADVERTISABLE_PROFILES,
  NOT_ADVERTISABLE,
} from '../support/advertisable-profiles';

describe('mock scenarios', () => {
  it('covers the full catalog', () => {
    expect(MOCK_SCENARIOS.length).toBeGreaterThanOrEqual(19);
  });

  it('has unique ids', () => {
    const ids = new Set(MOCK_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(MOCK_SCENARIOS.length);
  });

  it('every scenario has a valid registry mode', () => {
    for (const s of MOCK_SCENARIOS) {
      expect(['single', 'dual', 'cross_org']).toContain(s.registry_mode);
    }
  });
});

describe('SDK matrix', () => {
  /**
   * The LOCKED acdp-wasm version — the lock, never `package.json`'s `^0.14.1`
   * range. The range is a floor; the lock is the fact, and it is what a
   * dependabot bump actually changes.
   */
  const lockedWasmVersion: string =
    packageLock.packages['node_modules/@agentcontextdistributionprotocol/acdp-wasm'].version;

  function rowVersion(component: string): string {
    const row = MOCK_SDK_MATRIX.find((r) => r.component === component);
    if (!row) throw new Error(`No SDK matrix row '${component}'`);
    return row.version;
  }

  // ── Version drift (issue #69c) ────────────────────────────────────────
  //
  // WHAT THESE THREE ROWS MEAN, because the guard is only as honest as that:
  // they name the ACDP library release this console's own pinned artifact was
  // cut from. All four — the `acdp` crate, the PyPI and npm bindings, and the
  // `acdp-wasm` this console bundles — are stamped from the same `acdp-rs`
  // release at publish time (its `*-release.yml` workflows), which is why npm
  // `acdp` and PyPI `acdp` both read 0.14.1 today, matching our lock. That
  // shared origin is the coupling; being "built against" all three would not be
  // true, since this repo has no acdp-node dependency and no Python at all.
  //
  // They do NOT claim to be the LATEST published version, and that distinction
  // is load-bearing: as of 2026-09-25 crates.io `acdp` is 0.14.2 while PyPI and
  // npm are still 0.14.1, so "the published SDK version" is not even a single
  // number. Pinning these rows to it would make the demo assert something this
  // repo cannot check and cannot keep true.
  //
  // 0.14.2 is NOT a trivial patch, and this comment previously called it
  // "CI-only", which was false. It carries an RFC-ACDP-0014 §5 security
  // regression fix (acdp-rs#301): a did:key producer could self-sign a
  // revocation of its own key via the §10 interim form and have it accepted,
  // on registries advertising `acdp_version` in [0.3.0, 0.5.0). This console
  // does not consume that crate, so the row is still right — but the reason is
  // "we do not ship it", not "nothing happened".
  //
  // What this repo CAN check is its own lockfile, so that is what the rows are
  // pinned to. Whether those published versions have moved on is genuinely
  // unanswerable from inside this repo — that is issue #83's scheduled
  // published-version check, deliberately not built here.
  //
  // The old test could not catch drift at all, for two reasons. It truncated
  // both sides to `major.minor`, so `0.8.3` vs `0.8.5` — the exact drift that
  // recurred — compared equal; and it only ever looked at `acdp-rs library`,
  // so the py and node rows sat at 0.8.0 through two lockfile bumps completely
  // uncovered. #63 patched these strings and #69 found them stale again six
  // days later.
  //
  // **This takes acdp-wasm bumps off the unattended-merge path, deliberately.**
  // Every dependabot acdp-wasm PR now goes RED until these three strings are
  // edited in that same PR. `auto-merge.yml` still ARMS native auto-merge; the
  // PR is blocked on the failing required check and merges by itself once the
  // strings are fixed. Note the shape: this reddens only on a PR that is
  // already changing the thing it guards, and the fix is three lines right
  // there — a different animal from a scheduled check that reddens on someone
  // else's timetable with no PR to fix it in.
  it.each(['acdp-rs library', 'acdp-py binding', 'acdp-node binding'])(
    'the %s row matches the exact acdp-wasm version this console locks',
    (component) => {
      expect(rowVersion(component)).toBe(lockedWasmVersion);
    },
  );

  it("registry-a's advertised protocol version agrees with its SDK matrix row", () => {
    // The two pages that show a version for the SAME demo registry:
    // /registries renders `MOCK_CAPABILITIES.a.acdp_version`, /config renders
    // this row. They said 0.3.0 and 0.4.0 respectively until this change, and
    // both were superseded — the real binary advertises 0.5.0 unconditionally.
    //
    // Scope: this guards the DEMO dataset against contradicting itself. Real
    // mode is a separate question and still open — /registries shows the live
    // capability document while /config shows the live /healthz BUILD version
    // or falls back to the reference string, which are different numbers by
    // design. That display question is #69a's, not this test's.
    const advertised = MOCK_CAPABILITIES.a.acdp_version;
    // Shape first. `startsWith` alone is a weak guard: an empty string is a
    // prefix of everything, and so are '0' and '0.5' — all three would pass
    // against '0.5.0 (external anchors)' while saying nothing. Requiring a full
    // dotted triple is what makes the prefix check mean "the numbers agree".
    expect(advertised).toMatch(/^\d+\.\d+\.\d+$/);
    // Then the coupling. Prefix rather than equality because the matrix row
    // carries a curated parenthetical the capability document does not, and
    // normalising that away would re-enable the string-merging #69 objected to
    // on the record. The row must START with the advertised version and then
    // either stop or continue with a space — so '0.5.0' does not match a row
    // reading '0.5.01'.
    // ORDER IS LOAD-BEARING: `advertised` is interpolated into a RegExp with
    // only dots escaped, which is safe ONLY because the shape assertion above
    // has already proved it is digits and dots. Move or delete that line and
    // dataset content becomes a regular expression.
    expect(rowVersion('Registry A (Rust/axum)')).toMatch(
      new RegExp(`^${advertised.replace(/\./g, '\\.')}( |$)`),
    );
  });

  it('the ACDP spec row is 0.4.0 Final (RFC-ACDP-0015 promoted 2026-08-28)', () => {
    const specRow = MOCK_SDK_MATRIX.find((r) => r.component === 'ACDP spec');
    expect(specRow?.version).toBe('0.4.0 Final');
  });

  it('every row has a non-empty component and version, and carries no status', () => {
    for (const row of MOCK_SDK_MATRIX) {
      expect(row.component.length).toBeGreaterThan(0);
      expect(row.version.length).toBeGreaterThan(0);
      // Status is computed by `buildSdkMatrixRows`, never stored here. This
      // assertion replaces one that required a static `status: 'ok'` on every
      // row — dead data the UI never read, and which could contradict the
      // computed status once reference-ness stopped depending on the mode.
      expect(row).not.toHaveProperty('status');
    }
  });
});

describe('mock scenarios > catalog parity', () => {
  it('the catalog has 34 scenarios matching the playground catalog', () => {
    expect(SCENARIO_COUNT).toBe(34);
  });

  it('includes s21_capabilities_p256, s33_anchors, and s34_embedded_content', () => {
    const ids = new Set(MOCK_SCENARIOS.map((s) => s.id));
    expect(ids.has('s21_capabilities_p256')).toBe(true);
    expect(ids.has('s33_anchors')).toBe(true);
    expect(ids.has('s34_embedded_content')).toBe(true);
  });

  it('s33_anchors matches playground catalog metadata (default_inputs, not a paraphrase)', () => {
    const s33 = MOCK_SCENARIOS.find((s) => s.id === 's33_anchors');
    expect(s33?.default_inputs).toEqual({ topic: 'anchored settlement snapshot' });
  });

  it('s34_embedded_content matches playground catalog metadata', () => {
    const s34 = MOCK_SCENARIOS.find((s) => s.id === 's34_embedded_content');
    expect(s34?.name).toBe('Embedded Content Integrity');
    expect(s34?.registry_mode).toBe('single');
    expect(s34?.agent_count).toBe(1);
    expect(s34?.framework).toBe('langchain');
    expect(s34?.default_inputs).toEqual({ topic: 'inline sensor snapshot' });
  });

  it('scenario ids are unique and contiguous s1..s34', () => {
    const ids = MOCK_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const numbers = ids
      .map((id) => {
        const m = id.match(/^s(\d+)_/);
        return m ? Number(m[1]) : NaN;
      })
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 34 }, (_, i) => i + 1));
  });
});

describe('scenarioNumber', () => {
  it('derives the S-number from id', () => {
    expect(scenarioNumber('s5_cross_registry')).toBe('S5');
    expect(scenarioNumber('s15_supersession_lineage')).toBe('S15');
  });
});

describe('mock runs and lineage', () => {
  it('the live run has a recorded event stream', () => {
    expect(MOCK_RUN_EVENTS[LIVE_RUN_ID].length).toBeGreaterThan(0);
  });

  it('the live run ends with a terminal event', () => {
    const events = MOCK_RUN_EVENTS[LIVE_RUN_ID];
    const last = events[events.length - 1];
    expect(['run.complete', 'run.error']).toContain(last.type);
  });

  it('every run id is unique', () => {
    const ids = new Set(MOCK_RUNS.map((r) => r.runId));
    expect(ids.size).toBe(MOCK_RUNS.length);
  });

  it('cross-registry lineage has an edge across authorities', () => {
    const g = MOCK_LINEAGE[LIVE_RUN_ID];
    expect(g.nodes.length).toBe(2);
    expect(g.edges.length).toBe(1);
    expect(g.nodes[0].registry_authority).not.toBe(g.nodes[1].registry_authority);
  });
});

describe('mock dashboard', () => {
  it('exposes KPI totals', () => {
    expect(MOCK_DASHBOARD.totalRuns).toBeGreaterThan(0);
    expect(MOCK_DASHBOARD.recentRuns.length).toBeGreaterThan(0);
  });
});

describe('rich context bodies', () => {
  it('every context carries a producer signature', () => {
    for (const c of MOCK_CONTEXTS) {
      expect(c.body.signature?.algorithm).toBeTruthy();
      expect(c.body.signature?.key_id).toContain('#');
    }
  });

  it('includes a key-revocation context (RFC-ACDP-0014), reachable via the search-hit facet', () => {
    const revocation = MOCK_CONTEXTS.find((c) => c.body.type === 'key-revocation');
    expect(revocation).toBeDefined();
    expect(revocation!.body.metadata?.revoked_key_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(revocation!.body.metadata?.compromised_since).toBeTruthy();
    // MOCK_SEARCH_HITS is MOCK_CONTEXTS-derived — the type filter demo mode
    // applies (search.type === h.type) only works if this hit's `type` field
    // actually carries 'key-revocation' through, not just the full body.
    const hit = MockData.MOCK_SEARCH_HITS.find((h) => h.ctx_id === revocation!.body.ctx_id);
    expect(hit?.type).toBe('key-revocation');
  });

  it('carries exactly one INTERIM-form revocation hit, and it stays bodyless', () => {
    // The fixture that makes the two-spelling fan-out reachable by a human.
    // Pinned on both halves: without the hit the union path is demo-invisible;
    // if someone later gives it a MOCK_CONTEXTS body, that body's `type` sits
    // inside the signed preimage, so the fixture would be publishing a
    // signature over content it did not sign.
    const interim = MockData.MOCK_SEARCH_HITS.filter((h) => h.type === 'acdp:key-revocation');
    expect(interim).toHaveLength(1);
    expect(MOCK_CONTEXTS.some((c) => c.body.ctx_id === interim[0].ctx_id)).toBe(false);
  });
});

describe('demo dashboard windows', () => {
  it('24h is the untouched fixture — existing readers have not moved', () => {
    expect(MockData.demoDashboardForWindow('24h')).toEqual({ ...MOCK_DASHBOARD, window: '24h' });
  });

  it('exactly one selectable window reaches the all-zero revocation payload', () => {
    // The dashboard's not-reported branch was unreachable in demo mode, which
    // is the "only correct in tests" gap this plan criticises elsewhere. One
    // window must reach it; the rest must not, or the demo would teach that
    // revocation is never reported.
    const windows = ['1h', '6h', '24h', '7d', '30d'];
    const allZero = windows.filter((w) => {
      const k = MockData.demoDashboardForWindow(w).keyRevocation!;
      return k.preCompromise === 0 && k.revokedAtOrAfter === 0 && k.revokedTimeUnverifiable === 0;
    });
    expect(allZero).toEqual(['1h']);
  });

  it('one window shows a non-zero count beside genuine zeros', () => {
    const k = MockData.demoDashboardForWindow('6h').keyRevocation!;
    expect(k.preCompromise).toBeGreaterThan(0);
    expect(k.revokedAtOrAfter).toBe(0);
    expect(k.revokedTimeUnverifiable).toBe(0);
  });

  it('aggregates grow monotonically with the window', () => {
    const runs = ['1h', '6h', '24h', '7d', '30d'].map((w) => MockData.demoDashboardForWindow(w).totalRuns);
    expect(runs).toEqual([...runs].sort((a, b) => a - b));
  });

  it('never advertises more recent runs than it counts', () => {
    for (const w of ['1h', '6h', '24h', '7d', '30d']) {
      const d = MockData.demoDashboardForWindow(w);
      expect(d.recentRuns.length).toBeLessThanOrEqual(d.totalRuns);
    }
  });

  it('every headline figure agrees with its own breakdown, in every window', () => {
    // The 24 h fixture holds these by construction; scaling the totals and the
    // breakdowns independently broke two of them (a scenario chart claiming
    // MORE runs than the Total Runs KPI at 6h, DID-method bars off by one
    // against Contexts Published at 1h and 7d). The picker exists so a human
    // looks at this page, so an incoherent window is a visible defect, not a
    // fixture detail.
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    for (const w of ['1h', '6h', '24h', '7d', '30d']) {
      const d = MockData.demoDashboardForWindow(w);
      expect(sum(d.byScenario.map((s) => s.run_count)), `byScenario @ ${w}`).toBe(d.totalRuns);
      expect(sum(d.byRegistry.map((r) => r.event_count)), `byRegistry @ ${w}`).toBe(d.totalContexts);
      expect(sum((d.didMethods ?? []).map((m) => m.publish_count)), `didMethods @ ${w}`).toBe(d.totalContexts);
      for (const r of d.receiptCoverage ?? []) {
        expect(r.receipt_count, `receipts ≤ publishes @ ${w}`).toBeLessThanOrEqual(r.publish_count);
      }
      // Runs without agents would be incoherent in the other direction.
      if (d.totalRuns > 0) expect(d.totalAgents, `agents @ ${w}`).toBeGreaterThan(0);
    }
  });

  // Cross-phase coherence (UI-2 Phases 4 + 5): every mock run's revoked-key
  // events reference sources[].ctxId as a narrative link to the context that
  // declared the revocation. Each phase's own tests were green in isolation,
  // but nothing checked that the referenced id isn't a dangling one, or that
  // the two independently-authored timestamps (a run's Postgres-style
  // `boundary` vs. the context's ISO `metadata.compromised_since`) actually
  // agree on the same instant.
  it('run-revoked-1\'s revoked-event sources resolve to a real context, boundary matching its compromised_since', () => {
    const ctxIds = new Set(MOCK_CONTEXTS.map((c) => c.body.ctx_id));
    const run = MOCK_RUNS.find((r) => r.runId === 'run-revoked-1');
    expect(run?.trust?.revoked?.length).toBeGreaterThan(0);
    for (const event of run!.trust!.revoked!) {
      for (const source of event.sources) {
        expect(ctxIds.has(source.ctxId)).toBe(true);
      }
    }
    const revocationCtx = MOCK_CONTEXTS.find((c) => c.body.type === 'key-revocation')!;
    const compromisedSince = revocationCtx.body.metadata?.compromised_since as string;
    for (const event of run!.trust!.revoked!) {
      expect(new Date(event.boundary).getTime()).toBe(new Date(compromisedSince).getTime());
    }
  });
});

describe('lineage chains', () => {
  it('the cashflow lineage is a multi-version chain ordered oldest → newest', () => {
    const chain = MOCK_LINEAGE_CHAINS['lin-cashflow-001'];
    expect(chain.length).toBe(2);
    expect(chain[0].body.version).toBe(1);
    expect(chain[1].body.version).toBe(2);
    expect(chain[1].body.supersedes).toBe(chain[0].body.ctx_id);
  });
});

describe('security mocks', () => {
  it('revocation entries have a subject and revoke timestamp', () => {
    expect(MOCK_REVOCATIONS.length).toBeGreaterThan(0);
    for (const r of MOCK_REVOCATIONS) {
      expect(r.sub).toContain('did:');
      expect(r.revoked_at_ms).toBeGreaterThan(0);
    }
  });

  it('both registries publish at least one signing key', () => {
    expect(MOCK_JWKS.a.keys.length).toBeGreaterThan(0);
    expect(MOCK_JWKS.b.keys.length).toBeGreaterThan(0);
  });
});

describe('receipts + degraded demo parity', () => {
  it('the catalog includes the ACDP 0.3 scenarios s27–s32', () => {
    const ids = new Set(MOCK_SCENARIOS.map((s) => s.id));
    for (const id of [
      's27_receipt_key_rotation',
      's28_lifecycle_retraction',
      's29_transparency_log',
      's30_head_receipt_freshness',
      's31_witness_cosigning',
      's32_key_revocation',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('at least one demo run reports degraded via result.summary.degraded', () => {
    const degraded = MOCK_RUNS.filter(
      (r) => (r.result as { summary?: { degraded?: unknown } } | null)?.summary?.degraded === true,
    );
    expect(degraded.length).toBeGreaterThan(0);
  });

  it('registry-a hosts the receipts profile in a two-registry topology (registry-c retired)', () => {
    expect(MOCK_CAPABILITIES.a.profiles).toContain('acdp-registry-receipts');
    // 0.5.0: what the real registry-rs binary advertises unconditionally, and
    // what the demo's own s33_anchors scenario requires (a publish carrying
    // `anchors` is rejected by a registry claiming less). Was 0.3.0, which gave
    // one registry two different versions on two pages. `profiles` is unchanged
    // — registry-rs's advertisable set has no version-specific entry, so the
    // two fields move independently.
    expect(MOCK_CAPABILITIES.a.acdp_version).toBe('0.5.0');
    expect(MOCK_CAPABILITIES).not.toHaveProperty('c');
  });
});

describe('enrollment mocks', () => {
  it('every enrollment has an authority and tenant', () => {
    for (const e of MOCK_ENROLLMENTS) {
      expect(e.authority).toBeTruthy();
      expect(e.tenantId).toBeTruthy();
    }
  });
});

describe('trust mocks (ACDP 0.2)', () => {
  it('includes the S22–S26 trust scenarios', () => {
    const ids = new Set(MOCK_SCENARIOS.map((s) => s.id));
    for (const id of ['s22_receipts', 's23_receipt_tamper', 's24_historical_key', 's25_did_key', 's26_divergence']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('every registry receipt binds cleanly to its served body', () => {
    const withReceipt = MOCK_CONTEXTS.filter((c) => c.registry_receipt);
    expect(withReceipt.length).toBeGreaterThan(0);
    for (const c of withReceipt) {
      const r = c.registry_receipt!;
      expect(r.ctx_id).toBe(c.body.ctx_id);
      expect(r.lineage_id).toBe(c.body.lineage_id);
      expect(r.origin_registry).toBe(c.body.origin_registry);
      // acdp-wasm 0.14.1's verifyReceipt cross-checks the receipt against the
      // served body's lineage_id/origin_registry/created_at (RFC-ACDP-0010 §8
      // step 3) — created_at is deliberately DERIVED from the receipt in
      // mock-data.ts (not an independent literal) so this can never silently
      // drift apart again; this assertion is what makes that regression loud.
      expect(r.created_at).toBe(c.body.created_at);
      expect(r.content_hash).toBe(c.body.content_hash);
      expect(r.key_fingerprint).toMatch(/^sha256:/);
      expect(r.signature.algorithm).toBeTruthy();
    }
  });

  it('every acdp:// id anywhere in the mock dataset conforms to the acdp-wasm 0.14.1 grammar (lowercase authority + lowercase v4 UUID)', () => {
    // acdp-wasm 0.14.1's verifyReceipt/verifyCtxIdBinding parse `expected_ctx_id`
    // via CtxId::parse rather than accepting an opaque string (acdp-rs
    // bindings/acdp-wasm/src/core.rs); a non-conforming ctx_id now throws
    // instead of producing a fail verdict. This walks the ENTIRE mock-data
    // module recursively (not just MOCK_CONTEXTS) so a non-conforming id
    // anywhere — a lineage node, a run event, a trust-flagged discrepancy —
    // fails loudly instead of only being caught if it happens to also be a
    // wasm-verified MOCK_CONTEXTS entry. A prior round of this fix left 11
    // such ids (short mnemonic suffixes like "d-101", "v1-super") unconverted
    // because the test only walked MOCK_CONTEXTS; this walk is what prevents
    // that class of gap from recurring.
    const CTX_ID_RE = /^acdp:\/\/[a-z0-9.-]+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const seen = new Set<unknown>();
    const offenders: string[] = [];
    function walk(value: unknown, path: string): void {
      if (typeof value === 'string') {
        if (value.startsWith('acdp://') && !CTX_ID_RE.test(value)) offenders.push(`${path} = ${value}`);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) return; // guard against shared-reference cycles (e.g. LIVE_LINEAGE.nodes[0] reused across exports)
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, `${path}.${k}`);
    }
    for (const [name, value] of Object.entries(MockData)) walk(value, name);
    expect(offenders).toEqual([]);
  });

  it('a running run has no verdict yet and exactly one run is flagged', () => {
    const live = MOCK_RUNS.find((r) => r.runId === LIVE_RUN_ID);
    expect(live?.trust).toBeNull();
    const flagged = MOCK_RUNS.filter((r) => (r.trust?.flagged.length ?? 0) > 0);
    expect(flagged.length).toBe(1);
    expect(flagged[0].trust!.flagged[0].discrepancies[0]).toContain('content_hash_mismatch');
  });

  it('surfaces a historically-authorized verdict (RFC-ACDP-0010 §9)', () => {
    const historical = MOCK_RUNS.find((r) => r.scenarioId === 's24_historical_key');
    expect(historical?.trust?.verifiedHistorical).toBe(1);
    expect(historical?.trust?.verified).toBe(0);
    expect(historical?.trust?.flagged.length).toBe(0);
  });

  it('every trust verdict accounts for all audited events', () => {
    for (const r of MOCK_RUNS) {
      const t = r.trust;
      if (!t) continue;
      const tallied =
        t.verified + t.verifiedHistorical + t.structural + t.noReceipt + t.errors + t.flagged.length;
      expect(tallied).toBe(t.audited);
    }
  });

  it('the dashboard exposes receipt coverage and DID-method breakdowns', () => {
    expect(MOCK_DASHBOARD.receiptCoverage?.length).toBeGreaterThan(0);
    for (const r of MOCK_DASHBOARD.receiptCoverage ?? []) {
      expect(r.receipt_count).toBeLessThanOrEqual(r.publish_count);
    }
    const methods = new Set((MOCK_DASHBOARD.didMethods ?? []).map((m) => m.method));
    expect(methods.has('did:web')).toBe(true);
    expect(methods.has('did:key')).toBe(true);
  });

  it('the dashboard exposes RFC-ACDP-0014 key-revocation counters (getCpDashboard demo passthrough)', async () => {
    expect(MOCK_DASHBOARD.keyRevocation).toBeDefined();
    const { preCompromise, revokedAtOrAfter, revokedTimeUnverifiable } = MOCK_DASHBOARD.keyRevocation!;
    for (const n of [preCompromise, revokedAtOrAfter, revokedTimeUnverifiable]) {
      expect(n).toBeGreaterThanOrEqual(0);
    }
    // NO LONGER a pass-through. `getCpDashboard`'s demo branch now goes through
    // `demoDashboardForWindow`, which is real field-mapping logic: it derives
    // every aggregate from its scaled parts and substitutes `keyRevocation`
    // wholesale on two windows. `'24h'` is the identity case by construction
    // (scale 1), which is what makes this assertion meaningful — and the
    // per-window behavior is covered in the `demo dashboard windows` block
    // above, not here. Do not read this test as evidence that the demo branch
    // is a spread.
    const { getCpDashboard } = await import('@/lib/api/client');
    const dash = await getCpDashboard('24h', true);
    expect(dash.keyRevocation).toEqual(MOCK_DASHBOARD.keyRevocation);
    const short = await getCpDashboard('1h', true);
    expect(short.keyRevocation).not.toEqual(MOCK_DASHBOARD.keyRevocation);
  });
});

describe('run-revoked-1: the RFC-ACDP-0014 fixture', () => {
  const revokedRun = MOCK_RUNS.find((r) => r.runId === 'run-revoked-1');

  it('carries one entry of each of the three verdict classes', () => {
    // Without all three, demo mode cannot reach the amber
    // `revoked_time_unverifiable` chip or the fail-closed-but-not-at-or-after
    // path at all — and MOCK_DASHBOARD.keyRevocation advertises exactly that
    // status, so its KPI led an operator to a run that did not contain one.
    const statuses = (revokedRun?.trust?.revoked ?? []).map((r) => r.status);
    expect(statuses).toContain('pre_compromise');
    expect(statuses).toContain('revoked_at_or_after');
    expect(statuses).toContain('revoked_time_unverifiable');
  });

  it("its own counters agree with its revoked[] rows", () => {
    // The counters and the rows are two independent representations of the
    // same fact on the wire. If a fixture edit updates one and not the other,
    // every assertion derived from either silently describes a state the
    // backend could never produce.
    const t = revokedRun?.trust;
    const rows = t?.revoked ?? [];
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    expect(t?.keyRevocationPreCompromise).toBe(count('pre_compromise'));
    expect(t?.keyRevocationRevokedAtOrAfter).toBe(count('revoked_at_or_after'));
    expect(t?.keyRevocationRevokedTimeUnverifiable).toBe(count('revoked_time_unverifiable'));
  });

  it('audits at least as many events as it has revocation verdicts', () => {
    // Revocation classification is per audited event, so more verdicts than
    // audited events is a fixture that could not exist upstream.
    expect(revokedRun?.trust?.audited ?? 0).toBeGreaterThanOrEqual((revokedRun?.trust?.revoked ?? []).length);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Demo registries advertise a profile set a real registry would BOOT with (#95).
//
// `MOCK_CAPABILITIES.b.profiles` was `['acdp-consumer', 'acdp-federated']`.
// Both are invalid, in two different ways, and a real `acdp-registry-rs`
// refuses to start with either — so the console's default mode depicted a
// registry that cannot exist, and anyone reading the fixture to learn what a
// profile id looks like learned two wrong ones.
//
//   `acdp-consumer`  — a real spec id, but a CONSUMER profile. The doc comment
//                      on `REGISTRY_ADVERTISABLE_PROFILES` excludes it by name:
//                      a registry is forbidden to advertise it.
//   `acdp-federated` — not a spec id at all. The real one is
//                      `acdp-registry-federated`.
//
// The guards below are the ones that would have caught it, and the second is
// deliberately about the CLASS of drift rather than this instance.
// ══════════════════════════════════════════════════════════════════════

// `REGISTRY_ADVERTISABLE_PROFILES` and `NOT_ADVERTISABLE` are imported from
// `test/support/advertisable-profiles.ts`, where the mirror's provenance and
// the precise limits of what a hand-copy can detect are written out. Shared
// because `registry-card-profiles.test.tsx` makes a DIFFERENT claim about the
// same seven strings, and two copies of a mirror can disagree.


/**
 * The acdp version each profile first appears in, for the version-coherence
 * guard. `core`/`discovery`/`federated` are the 0.1.0 baseline; receipts is
 * RFC-ACDP-0010 at 0.2.0; the three trust profiles are the 0.3.0 set
 * (RFC-ACDP-0011/0012/0013), as `registry-card.tsx`'s own tooltip copy records.
 */
const PROFILE_MIN_VERSION: Record<string, string> = {
  'acdp-registry-core': '0.1.0',
  'acdp-registry-discovery': '0.1.0',
  'acdp-registry-federated': '0.1.0',
  'acdp-registry-receipts': '0.2.0',
  'acdp-registry-head-receipts': '0.3.0',
  'acdp-registry-transparency-log': '0.3.0',
  'acdp-registry-lifecycle': '0.3.0',
};

function versionTuple(v: string): number[] {
  return v.split('.').map((n) => Number(n));
}
function atLeast(actual: string, required: string): boolean {
  const [a, b] = [versionTuple(actual), versionTuple(required)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

describe('demo registry profiles are ones a real registry would start with', () => {
  it('cannot be widened to launder any id a real registry refuses to boot with', () => {
    // NOT a staleness guard — see the mirror's own docblock; a local literal
    // compared to a local number observes nothing upstream, and the first
    // version of this test claimed otherwise. What it guards is the local
    // shortcut: the cheapest way to make an invalid fixture pass the subset
    // check below is to add the id here, and `NOT_ADVERTISABLE` is the list of
    // ids that would be added.
    //
    // The title named "the two" while the list held THREE — it was written
    // before `acdp-log-witness` joined, and a title that enumerates a set it
    // does not own goes stale silently. It now names the PROPERTY, which is
    // what the loop below actually delivers: whatever `NOT_ADVERTISABLE` holds,
    // none of it may be laundered in here.
    //
    // Still narrower than "no invalid id can get through", and deliberately so.
    // Round 2 of the gate measured the wider claim and found it false:
    // inventing a WELL-FORMED id and adding it to the mirror, the fixture,
    // `PROFILE_MIN_VERSION` and `PROFILE_INFO` together — four coordinated
    // edits — passes everything. Widening the mirror ALONE is caught; a
    // four-file conspiracy is not, and no test in this repo claims to catch
    // one.
    for (const id of NOT_ADVERTISABLE) expect(REGISTRY_ADVERTISABLE_PROFILES).not.toContain(id);
    // Every entry must look like a registry profile id. `acdp-consumer` fails
    // this on its own shape, which is the property that generalises: a consumer
    // or agent profile smuggled in later is caught without being named.
    for (const p of REGISTRY_ADVERTISABLE_PROFILES) expect(p).toMatch(/^acdp-registry-[a-z-]+$/);
    // And no duplicates, so `toHaveLength` elsewhere cannot be satisfied by a
    // repeated entry.
    expect(new Set(REGISTRY_ADVERTISABLE_PROFILES).size).toBe(REGISTRY_ADVERTISABLE_PROFILES.length);
  });

  it.each(Object.keys(MOCK_CAPABILITIES))(
    '%s advertises only advertisable profiles',
    (authority) => {
      const caps = MOCK_CAPABILITIES[authority as keyof typeof MOCK_CAPABILITIES];
      expect(caps.profiles.length).toBeGreaterThan(0);
      for (const p of caps.profiles) {
        expect(REGISTRY_ADVERTISABLE_PROFILES, `${authority} advertises ${p}`).toContain(p);
      }
    },
  );

  it('registry-b advertises exactly what the playground configures for it', () => {
    // Not a taste call. `acdp-playground/config/registry-b.toml:8` is
    // `["acdp-registry-core", "acdp-registry-discovery"]`, and this demo depicts
    // that playground — so the set is copied, and copied in order.
    //
    // TWO, not three. Issue #95's parenthetical says registry-b is configured
    // with `acdp-registry-federated` as well. It is not — re-read at
    // `registry-b.toml:8` while implementing this, and the line has exactly the
    // two ids above. The issue is wrong on that detail and this fixture follows
    // the config, so nobody re-litigates it from the issue text later.
    expect(MOCK_CAPABILITIES.b.profiles).toEqual([
      'acdp-registry-core',
      'acdp-registry-discovery',
    ]);
  });

  it('keeps registry-b on 0.1.0 and keeps it the simpler peer', () => {
    // The narrative the invalid ids were there to serve, preserved. B must stay
    // BELOW A or the demo stops exercising the console's version-aware
    // surfaces — which is the reason 0.1.0 is deliberate.
    expect(MOCK_CAPABILITIES.b.acdp_version).toBe('0.1.0');
    expect(MOCK_CAPABILITIES.b.profiles.length).toBeLessThan(MOCK_CAPABILITIES.a.profiles.length);
  });

  it('never advertises a profile that postdates its own acdp_version', () => {
    // The CLASS of drift, not this instance. Adding `acdp-registry-receipts`
    // to B would pass every assertion above — it is a real, advertisable id —
    // and still describe an impossible registry, because receipts arrived at
    // 0.2.0 and B claims 0.1.0.
    for (const [authority, caps] of Object.entries(MOCK_CAPABILITIES)) {
      for (const p of caps.profiles) {
        const min = PROFILE_MIN_VERSION[p];
        expect(min, `${p} has no minimum version recorded`).toBeDefined();
        expect(
          atLeast(caps.acdp_version, min),
          `${authority} claims acdp ${caps.acdp_version} but advertises ${p} (needs ${min})`,
        ).toBe(true);
      }
    }
  });

  it('records a minimum version for EXACTLY the advertisable profiles', () => {
    // Both directions. "Every advertisable profile has an entry" alone leaves
    // the table widenable: adding `'acdp-consumer': '0.1.0'` was green, which is
    // the same two-copies-that-may-disagree shape `advertisable-profiles.ts`
    // was created to remove — this was the last un-pinned copy of the seven.
    expect(Object.keys(PROFILE_MIN_VERSION).sort()).toEqual(
      [...REGISTRY_ADVERTISABLE_PROFILES].sort(),
    );
  });

  it('agrees with the version each profile chip already names on screen', () => {
    // The table above was, by itself, unfalsifiable: lowering
    // `acdp-registry-receipts` to '0.1.0' made the coherence guard vacuous and
    // killed no test, because no fixture sits at a version where receipts is the
    // deciding profile. A second source in this repo fixes that.
    //
    // `PROFILE_INFO` in `registry-card.tsx` puts the version in the operator's
    // tooltip — "(RFC-ACDP-0010, acdp 0.2.0)" — so the two files are now held to
    // each other and neither can be edited alone.
    //
    // Read with the TYPESCRIPT COMPILER, not by importing the object and not by
    // regex. An early version ran an unanchored, first-match-wins regex over the
    // RAW file, so a docblock line reading `'acdp-registry-receipts': { title:
    // 'baseline (acdp 0.1.0)' }` shadowed the real entry and let the table be
    // lowered to match. The version after that imported the object, which
    // required exporting it — and the export let any module mutate the table at
    // module scope, invisible to a guard in a different test file because Vitest
    // isolates module graphs. `profileCopyTable()` needs neither: it parses the
    // file and fails CLOSED on anything it cannot account for.
    const { entries: copy } = profileCopyTable();
    for (const p of REGISTRY_ADVERTISABLE_PROFILES) {
      const entry = copy.get(p);
      expect(entry, `no profile copy entry for ${p}`).toBeDefined();
      // Baseline profiles carry no version marker because they ARE the 0.1.0
      // baseline; anything later says so in the copy. The default is asserted,
      // not assumed — a marker appearing on a baseline profile is drift too.
      const named = /acdp (\d+\.\d+\.\d+)/.exec(entry!)?.[1] ?? '0.1.0';
      expect(named, `${p}: tooltip says acdp ${named}, PROFILE_MIN_VERSION says ${PROFILE_MIN_VERSION[p]}`).toBe(
        PROFILE_MIN_VERSION[p],
      );
    }
  });

  it('each tooltip names the RFC the pinned spec assigns that profile', () => {
    // The version half of every tooltip was cross-checked; the RFC half was
    // checked only against /RFC-ACDP-\d{4}/, so rewriting `RFC-ACDP-0012` to
    // `RFC-ACDP-0099` in operator-facing copy left the whole suite green.
    //
    // `acdp-spec-pinned/registries/profiles.md` carries the exact mapping, and
    // the three baseline profiles genuinely share RFC-ACDP-0001 §9.1 — the
    // later ones cite their own RFC first and RFC-ACDP-0001 §9.1 second, and
    // the tooltip names the FIRST, which is the one that describes the feature.
    const PROFILE_RFC: Record<string, string> = {
      'acdp-registry-core': 'RFC-ACDP-0001',
      'acdp-registry-discovery': 'RFC-ACDP-0001',
      'acdp-registry-federated': 'RFC-ACDP-0001',
      'acdp-registry-receipts': 'RFC-ACDP-0010',
      'acdp-registry-head-receipts': 'RFC-ACDP-0011',
      'acdp-registry-transparency-log': 'RFC-ACDP-0012',
      'acdp-registry-lifecycle': 'RFC-ACDP-0013',
    };
    // Pinned both ways, so the table cannot be silently narrowed to whatever
    // the tooltips happen to say.
    expect(new Set(Object.keys(PROFILE_RFC))).toEqual(new Set(REGISTRY_ADVERTISABLE_PROFILES));

    const { entries: copy } = profileCopyTable();
    for (const p of REGISTRY_ADVERTISABLE_PROFILES) {
      const title = copy.get(p);
      expect(title, `no copy entry for ${p}`).toBeDefined();
      const named = /(RFC-ACDP-\d{4})/.exec(title!)?.[1];
      expect(named, `${p}: tooltip names no RFC at all`).toBeDefined();
      expect(named, `${p}: tooltip says ${named}, spec says ${PROFILE_RFC[p]}`).toBe(PROFILE_RFC[p]);
    }
  });

  it('the version comparison is not string comparison', () => {
    // `'0.10.0' > '0.9.0'` is false as strings. Nothing in the fixture reaches
    // double digits today, which is exactly why this would rot unnoticed.
    expect(atLeast('0.10.0', '0.9.0')).toBe(true);
    expect(atLeast('0.3.0', '0.3.0')).toBe(true);
    expect(atLeast('0.1.0', '0.2.0')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// `MOCK_RUNS` is in `startedAt` order, and stayed otherwise identical (#85).
//
// `MOCK_DASHBOARD.recentRuns` is `MOCK_RUNS.slice(0, 5)` — so "recent" meant
// "the first five array positions", and two entries sat at the END of the array
// out of order. `iso(n)` is n SECONDS ago (`mock-data.ts:31-34`), so those two
// were `run-historical-1` at 150s — two and a half MINUTES ago, the second-most
// recent run in the entire dataset — and `run-revoked-1` at 1900s, about half an
// hour. The five that made it into "Recent Runs" ended at 3600s, a full hour.
//
// So the dashboard's Recent Runs table omitted the second-newest run in favour
// of one twenty-four times older, and the Runs table read out of time order.
//
// The second test here is the one that makes the reorder safe rather than just
// done. A multiset-of-ids assertion would NOT show that nothing else changed:
// it passes just as happily if a `status` or a `startedAt` were edited during
// the move. So the invariant is pinned per run, keyed by id, in a form that
// survives `iso()` being recomputed from `Date.now()` at every module load.
// ══════════════════════════════════════════════════════════════════════

/** Seconds before module-load time, which is what `iso(n)` encodes. */
function secondsAgo(ts: string | null | undefined): number | null {
  if (!ts) return null;
  return Math.round((Date.now() - Date.parse(ts)) / 1000);
}

/** `sha256(JSON.stringify(null))`, i.e. the digest meaning "this run has no such field". */
const ABSENT = '74234e98afe7';

/** Short digest of a nested field, so deep objects are pinned without transcribing them. */
function digest(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
}

/**
 * Every run's ENTIRE content as it was BEFORE the reorder, keyed by id, so the
 * reorder is provably position-only: an edit to any field of any run fails here
 * even though the ids and the ordering both still check out.
 *
 * THIS PINS ALL EIGHT RUNS AND ALL TEN FIELDS, and the first version did not —
 * it listed three runs and five fields, which left `tenantId`, `registries`,
 * `inputs`, `trust` and `result` unpinned on every run and the other five runs
 * unpinned entirely. Demonstrated, not theorised: editing `run-fan-3`'s
 * `startedAt`, `status` or `contextsCount` left the whole suite green, and
 * `contextsCount` is what feeds the `/lineage` default this phase went to
 * trouble to protect.
 *
 * The deep fields are pinned by DIGEST rather than transcribed. A literal copy
 * of `run-revoked-1.trust` is forty lines of fixture in a test that is not about
 * revocation, and a reader checking it would be diffing two copies of the same
 * thing; the digest is complete, and the failure message prints the live JSON so
 * a real mismatch is still readable.
 *
 * TIMES ARE PINNED RELATIVE TO THE FIRST RUN, EXACTLY, with no tolerance.
 * `iso(a) - iso(b)` is exactly `(b - a)` seconds whatever `Date.now()` was, so
 * every gap in the dataset is an exact integer. Only the anchor itself is
 * wall-clock-relative, so only the anchor gets a tolerance — one assertion
 * instead of sixteen. The previous version's ±30s applied to every timestamp and
 * exceeded the live run's own `iso(24)`, so that run's `startedAt` could have
 * more than doubled undetected.
 */
const RUNS_BEFORE_REORDER: Record<
  string,
  {
    scenarioId: string;
    status: string;
    startedAfterAnchor: number;
    completedAfterAnchor: number | null;
    contextsCount: number;
    tenantId: string;
    registries: string;
    inputs: string;
    trust: string;
    result: string;
  }
> = {
  [LIVE_RUN_ID]: { scenarioId: 's5_cross_registry', status: 'running', startedAfterAnchor: 0, completedAfterAnchor: null, contextsCount: 1, tenantId: 'default', registries: 'registry-a.playground.local,registry-b.playground.local', inputs: '12322baff342', trust: ABSENT, result: ABSENT },
  'run-historical-1': { scenarioId: 's24_historical_key', status: 'completed', startedAfterAnchor: 126, completedAfterAnchor: 114, contextsCount: 1, tenantId: 'default', registries: 'registry-a.playground.local', inputs: '2ff7435f503c', trust: 'd20bb0a63bf5', result: ABSENT },
  'run-a1b2c3d4': { scenarioId: 's1_single_publish', status: 'completed', startedAfterAnchor: 256, completedAfterAnchor: 247, contextsCount: 1, tenantId: 'default', registries: 'registry-a.playground.local', inputs: 'a002ce23cc3b', trust: 'e396627b2727', result: ABSENT },
  'run-c4d5e6f7': { scenarioId: 's10_tenant_isolation', status: 'completed', startedAfterAnchor: 696, completedAfterAnchor: 686, contextsCount: 1, tenantId: 'default', registries: 'registry-a.playground.local', inputs: '9915c01592d2', trust: 'b476f4c4514c', result: '7b28676d3dc2' },
  'run-9d8e7f6a': { scenarioId: 's15_supersession_lineage', status: 'failed', startedAfterAnchor: 1296, completedAfterAnchor: 1286, contextsCount: 1, tenantId: 'default', registries: 'registry-a.playground.local', inputs: '02cb67ee5095', trust: '49faf1d6eead', result: ABSENT },
  'run-revoked-1': { scenarioId: 's32_key_revocation', status: 'completed', startedAfterAnchor: 1876, completedAfterAnchor: 1826, contextsCount: 3, tenantId: 'default', registries: 'registry-a.playground.local', inputs: '3d66fa1d6152', trust: '56312ec9329b', result: ABSENT },
  'run-fan-3': { scenarioId: 's3_fanout', status: 'completed', startedAfterAnchor: 3576, completedAfterAnchor: 3556, contextsCount: 4, tenantId: 'default', registries: 'registry-a.playground.local', inputs: 'b2e094463307', trust: 'd50f5a52bf87', result: ABSENT },
  'run-cross-org-1': { scenarioId: 's8_cross_org', status: 'completed', startedAfterAnchor: 7176, completedAfterAnchor: 7146, contextsCount: 2, tenantId: 'default', registries: 'registry-a.playground.local,registry-b.playground.local', inputs: '473789a75cae', trust: '36ce9993ab88', result: ABSENT },
};

describe('MOCK_RUNS reads in time order', () => {
  it('is strictly descending by startedAt', () => {
    // Strictly, not `>=`: two runs sharing a start time would make "the five
    // most recent" ambiguous, which is the property `recentRuns` depends on.
    for (let i = 1; i < MOCK_RUNS.length; i++) {
      const prev = Date.parse(MOCK_RUNS[i - 1].startedAt);
      const cur = Date.parse(MOCK_RUNS[i].startedAt);
      expect(cur, `${MOCK_RUNS[i].runId} starts at or after ${MOCK_RUNS[i - 1].runId}`).toBeLessThan(prev);
    }
  });

  it('makes recentRuns actually the five most recent', () => {
    const byTime = [...MOCK_RUNS].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    expect(MOCK_DASHBOARD.recentRuns.map((r) => r.runId)).toEqual(
      byTime.slice(0, 5).map((r) => r.runId),
    );
    // The sharpest instance of the old defect: `run-historical-1` started 150
    // SECONDS ago — the second-newest run in the dataset — and was not in
    // "recent" at all, while a run from a full hour earlier was.
    expect(MOCK_DASHBOARD.recentRuns.map((r) => r.runId)).toContain('run-historical-1');
  });

  it('still leads with the live run', () => {
    // `iso(24)` is the most recent value in the set, so the active run stays at
    // index 0 and the dashboard still opens on the run that is happening now.
    expect(MOCK_RUNS[0].runId).toBe(LIVE_RUN_ID);
    expect(MOCK_RUNS[0].status).toBe('running');
    expect(MOCK_DASHBOARD.recentRuns[0].runId).toBe(LIVE_RUN_ID);
  });

  it('pins every run, so the fixture cannot describe a subset of it', () => {
    // The guard on the guard. With three of eight runs pinned, five runs could
    // be edited freely and the fixture still looked authoritative.
    expect(Object.keys(RUNS_BEFORE_REORDER).sort()).toEqual([...MOCK_RUNS].map((r) => r.runId).sort());
  });

  it('moved positions and nothing else', () => {
    // The assertion a set-of-ids check cannot make: it passes just as happily
    // when a `status` or a `startedAt` was edited during the move.
    const anchor = Date.parse(MOCK_RUNS.find((r) => r.runId === LIVE_RUN_ID)!.startedAt);
    const afterAnchor = (ts: string | null | undefined) =>
      ts ? Math.round((anchor - Date.parse(ts)) / 1000) : null;

    for (const [runId, before] of Object.entries(RUNS_BEFORE_REORDER)) {
      const run = MOCK_RUNS.find((r) => r.runId === runId);
      expect(run, `${runId} is missing`).toBeDefined();
      const actual = {
        scenarioId: run!.scenarioId,
        status: run!.status,
        startedAfterAnchor: afterAnchor(run!.startedAt),
        completedAfterAnchor: afterAnchor(run!.completedAt),
        contextsCount: run!.contextsCount,
        tenantId: run!.tenantId,
        registries: run!.registries.join(','),
        inputs: digest(run!.inputs),
        trust: digest(run!.trust),
        result: digest((run as unknown as { result?: unknown }).result),
      };
      // One `toEqual` over the whole row rather than ten assertions: the failure
      // message then shows every differing field at once, and a field added to
      // `CpRun` later cannot be silently omitted from the comparison.
      expect(
        actual,
        `${runId} changed. trust=${JSON.stringify(run!.trust)} inputs=${JSON.stringify(run!.inputs)} result=${JSON.stringify((run as unknown as { result?: unknown }).result)}`,
      ).toEqual(before);
    }
  });

  it('anchors the whole dataset near NOW, which is the one thing offsets cannot pin', () => {
    // Every gap above is exact and `Date.now()`-independent, so a uniform shift
    // of all eight timestamps would pass them all. This is the assertion that
    // catches it — and the only one that needs a tolerance, for the gap between
    // module import (where `iso()` evaluates) and here.
    expect(secondsAgo(MOCK_RUNS.find((r) => r.runId === LIVE_RUN_ID)!.startedAt)!).toBeGreaterThanOrEqual(24);
    expect(secondsAgo(MOCK_RUNS.find((r) => r.runId === LIVE_RUN_ID)!.startedAt)!).toBeLessThanOrEqual(39);
  });

  it('keeps all eight runs', () => {
    expect(MOCK_RUNS).toHaveLength(8);
    expect(new Set(MOCK_RUNS.map((r) => r.runId)).size).toBe(8);
  });

  it('keeps the lineage page opening on the live run', () => {
    // CORRECTION TO THE PLAN. It asserted that `app/lineage/page.tsx` "defaults
    // to `LIVE_RUN_ID`, a named lookup, not an index, so it is unaffected".
    // That is wrong in its premise: the page defaults to
    // `runId ?? runs[0]?.runId`, where `runs` is the run list filtered to
    // `contextsCount > 0`. It IS order-sensitive, and reordering this fixture
    // could have changed which run the page opens on.
    //
    // The conclusion survives for a different reason, which is the one worth
    // asserting: the live run is the most recent AND has contexts, so it is
    // still first after the filter. Asserted on the DATA, because that is where
    // the dependency actually lives — a source grep for `LIVE_RUN_ID` would
    // have passed while the page silently changed which run it showed.
    const withContexts = MOCK_RUNS.filter((r) => r.contextsCount > 0);
    expect(withContexts[0]?.runId).toBe(LIVE_RUN_ID);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The lifecycle narrative sits on the fixture clock, not on wall-clock now (#85).
//
// The attested context's `created_at` is DERIVED from its frozen registry
// receipt (`MOCK_CRYPTO.attested.registry_receipt.created_at`) because
// acdp-wasm's `verifyReceipt` cross-checks the two (RFC-ACDP-0010 §8 step 3) —
// they must be structurally identical, not coincidentally equal. Meanwhile the
// three events describing that context were dated `iso(140)`, `iso(110)`,
// `iso(80)` — seconds before NOW. So the feed dated an 81-day-old context to
// "two minutes ago", and the gap grew by a day every day.
//
// WHICH ASSERTION ACTUALLY GATES THIS. A lower bound (`event >= created_at`)
// does NOT: the defect is that the events were far too RECENT, so `>=` passed
// before the change and passes after. The gating assertion is the UPPER bound —
// every one of these events is within 24 hours of the receipt clock — and it is
// the one that fails on a revert.
//
// The receipt-bearing set is DERIVED from `MOCK_CRYPTO` — every entry carrying a
// `registry_receipt` — not listed. The first version of this block hardcoded the
// attested context's ctx_id while its comment claimed the pairs were derived,
// which was false twice over: it also hardcoded the authority. A third
// receipt-bearing fixture added later is now covered without anyone remembering
// to extend anything, and the one documented exception is subtracted by name so
// that the exception is visible rather than implied.
// ══════════════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every fixture context that carries a registry receipt, derived. A receipt
 * names its own `ctx_id` and `created_at` (RFC-ACDP-0010 §8), so the pairing
 * comes out of the data with nothing to keep in sync.
 */
type ReceiptBearing = { name: string; ctxId: string; receiptTs: number };
const RECEIPT_BEARING: ReceiptBearing[] = Object.entries(MockCrypto.MOCK_CRYPTO)
  .map(([name, entry]) => {
    // A cast rather than a type predicate: `MOCK_CRYPTO`'s entries are a
    // heterogeneous union whose members do not all declare the key, and `in`
    // does not narrow across that. The shape is asserted at runtime below
    // (`receiptTs` finite, ctx_id resolves to a real fixture), which is the
    // check that would actually catch a change here.
    const receipt = (entry as { registry_receipt?: { ctx_id: string; created_at: string } }).registry_receipt;
    return receipt ? { name, ctxId: receipt.ctx_id, receiptTs: Date.parse(receipt.created_at) } : null;
  })
  .filter((r): r is ReceiptBearing => r !== null);

/**
 * `arcticSource` is the live run's own first node, and its wall-clock events are
 * a documented structural exception — see the `ev-1`/`ev-2` block below, which
 * proves the exception is still needed rather than assuming it. Everything else
 * with a receipt is held to the receipt clock.
 */
const CLOCK_EXCEPTIONS = ['arcticSource'];
const ON_RECEIPT_CLOCK = RECEIPT_BEARING.filter((r) => !CLOCK_EXCEPTIONS.includes(r.name));

/**
 * Every fixture context that has a `created_at` at all, deduplicated by ctx_id.
 * `MOCK_CONTEXTS` is not the whole set — `CASHFLOW_V2` exists only inside
 * `MOCK_LINEAGE_CHAINS`, and it was one of the three timestamps #85's second
 * half had to move, so a guard reading only `MOCK_CONTEXTS` would have missed it.
 */
const ALL_FIXTURE_CONTEXTS = [...new Map(
  [...MOCK_CONTEXTS, ...Object.values(MOCK_LINEAGE_CHAINS).flat()].map((c) => [c.body.ctx_id, c]),
).values()];

describe('the receipt-bearing contexts and the events describing them share a clock', () => {
  it('derives more than one receipt-bearing context, and fences exactly one', () => {
    // Without this the loops below could go quiet: a rename in `mock-crypto.ts`
    // that broke the `registry_receipt` shape would empty the derived list and
    // every assertion keyed off it would pass by describing nothing.
    expect(RECEIPT_BEARING.length).toBeGreaterThanOrEqual(2);
    expect(ON_RECEIPT_CLOCK.length).toBeGreaterThanOrEqual(1);
    expect(RECEIPT_BEARING.length - ON_RECEIPT_CLOCK.length).toBe(1);
    for (const r of RECEIPT_BEARING) expect(Number.isFinite(r.receiptTs)).toBe(true);
  });

  it.each(ON_RECEIPT_CLOCK)('$name: created_at IS its receipt clock', ({ ctxId, receiptTs }) => {
    // The premise everything below rests on, now asserted per context rather
    // than once for a hardcoded one. If a derivation were ever replaced by a
    // literal, `verifyReceipt`'s cross-check (RFC-ACDP-0010 §8 step 3) would
    // break while these tests kept measuring against the wrong thing.
    const ctx = MOCK_CONTEXTS.find((c) => c.body.ctx_id === ctxId);
    expect(ctx, `no fixture context for ${ctxId}`).toBeDefined();
    expect(Date.parse(ctx!.body.created_at)).toBe(receiptTs);
  });

  it.each(ON_RECEIPT_CLOCK)('$name: every event about it is within a day of that clock', ({ ctxId, receiptTs }) => {
    // THE GATING ASSERTION. Fails on `iso(140)` / `iso(110)` / `iso(80)`, which
    // sit weeks away from the receipt. (Deliberately not a figure: the gap is
    // wall-clock-dependent and grows every day, so any number written here is
    // wrong tomorrow. It was '81 days' and is over 83 now.)
    const referencing = MOCK_CONTEXT_EVENTS.filter((e) => e.ctxId === ctxId);
    expect(referencing.length).toBeGreaterThan(0);
    for (const e of referencing) {
      const drift = Math.abs(Date.parse(e.eventTs) - receiptTs);
      expect(drift, `${e.id} is ${Math.round(drift / DAY_MS)} days from the receipt clock`).toBeLessThanOrEqual(DAY_MS);
    }
  });
});

const ATTESTED_CTX = ON_RECEIPT_CLOCK[0].ctxId;

describe('the attested context and the events describing it share a clock', () => {
  const receiptTs = ON_RECEIPT_CLOCK[0].receiptTs;
  const attested = MOCK_CONTEXTS.find((c) => c.body.ctx_id === ATTESTED_CTX)!;

  it('is the fixture with the three-event lifecycle the phase moved', () => {
    // The 24h bound and the created_at derivation are asserted for EVERY
    // receipt-bearing context above; what is specific to this one is that it
    // carries the publish/retract/republish triple, which is what the rest of
    // this block is about. Asserting the count here keeps the loops below from
    // going quiet if the triple is ever split across contexts.
    expect(attested).toBeDefined();
    expect(MOCK_CONTEXT_EVENTS.filter((e) => e.ctxId === ATTESTED_CTX)).toHaveLength(3);
    expect(Number.isFinite(receiptTs)).toBe(true);
  });

  it('orders publish < retract < republish strictly', () => {
    const at = (id: string) => Date.parse(MOCK_CONTEXT_EVENTS.find((e) => e.id === id)!.eventTs);
    // Strictly: equal timestamps would make the lifecycle order depend on array
    // position, which is exactly the class of bug Phase 13 fixed next door.
    expect(at('ev-7')).toBeLessThan(at('ev-8'));
    expect(at('ev-8')).toBeLessThan(at('ev-9'));
  });

  it('keeps the two renderings of the same fact byte-identical', () => {
    // The retract/republish pair exists TWICE: in the events feed, and in the
    // context's own `registry_state.lifecycle_events`, which
    // `context-detail.tsx` renders on the same card that shows `created_at`.
    // Moving only the feed would have traded one visible contradiction for a
    // subtler one — two surfaces disagreeing about when the same event happened.
    const lifecycle = attested.registry_state!.lifecycle_events!;
    const mirror = (type: string) => lifecycle.find((l) => l.event_type === type)!.occurred_at;
    const feed = (id: string) => MOCK_CONTEXT_EVENTS.find((e) => e.id === id)!.eventTs;
    expect(mirror('retracted')).toBe(feed('ev-8'));
    expect(mirror('republished')).toBe(feed('ev-9'));
  });

  it('keeps EVERY lifecycle mirror equal to its feed event, not just this one', () => {
    // The class, derived. `ev-10`/the cashflow retraction is the second such
    // pair and was moved in the same commit; a third context added with a
    // lifecycle mirror is covered with nothing to extend.
    //
    // Matched on (ctx_id, event_type) because that is the identity the two
    // surfaces share — the feed's `id` is a control-plane event id and the
    // mirror's `event_id` is a registry lifecycle id, so they are not the same
    // key and never will be.
    const FEED_TYPE: Record<string, string> = {
      retracted: 'context_retracted',
      republished: 'context_republished',
    };
    let pairs = 0;
    for (const ctx of ALL_FIXTURE_CONTEXTS) {
      for (const l of ctx.registry_state?.lifecycle_events ?? []) {
        const wanted = FEED_TYPE[l.event_type];
        expect(wanted, `no feed eventType known for lifecycle '${l.event_type}'`).toBeDefined();
        const feed = MOCK_CONTEXT_EVENTS.filter(
          (e) => e.ctxId === ctx.body.ctx_id && e.eventType === wanted,
        );
        expect(feed.length, `${ctx.body.ctx_id}: ${l.event_type} appears ${feed.length}x in the feed`).toBe(1);
        expect(l.occurred_at, `${ctx.body.ctx_id} ${l.event_type}: mirror vs feed`).toBe(feed[0].eventTs);
        pairs++;
      }
    }
    // Three today: the attested retract/republish, and the cashflow retraction.
    expect(pairs).toBeGreaterThanOrEqual(3);
  });

  it('derives the dates rather than hardcoding them', () => {
    // Comments STRIPPED first. The explanatory comment above these values has
    // to name the date in order to state the rule, so a whole-file grep would
    // be failed by its own explanation — the same trap this plan hit once
    // already in the profiles phase.
    const src = readFileSync(join(process.cwd(), 'lib/data/mock-data.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('2026-07-06');
    // And the derivation really is from the receipt. The whole-file
    // `toContain` that used to stand here was false comfort: it was satisfied by
    // an unrelated occurrence further down the file, so replacing the base with
    // `new Date(1783339020000).toISOString()` — the same instant, expressed as a
    // magic number — decoupled the events from the receipt and killed no test.
    // Behaviourally identical today, and stale the moment the receipt fixture is
    // regenerated. So the assertion is on the DECLARATION, not the file.
    const decl = /const ATTESTED_RECEIPT_TS\s*=\s*([^;]+);/.exec(code)?.[1];
    expect(decl, 'ATTESTED_RECEIPT_TS is not declared as a single const').toBeDefined();
    expect(decl).toContain('MOCK_CRYPTO.attested.registry_receipt.created_at');
    // The three event timestamps are offsets FROM that base, not independent
    // values that happen to land nearby.
    for (const name of ['ATTESTED_PUBLISHED_TS', 'ATTESTED_RETRACTED_TS', 'ATTESTED_REPUBLISHED_TS']) {
      const rhs = new RegExp(`const ${name}\\s*=\\s*([^;]+);`).exec(code)?.[1];
      expect(rhs, `${name} is not declared as a single const`).toBeDefined();
      expect(rhs, `${name} does not derive from the receipt base`).toContain('ATTESTED_RECEIPT_TS');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// The CLASS, not the instance (#85 symptom 2: "lifecycle events contradict
// their own context").
//
// The first version of this phase guarded one context and its comment claimed to
// guard the class. Writing the derived guard the plan asked for immediately found
// a second live instance the scoped one could not see: the cashflow v1 snapshot
// was `created_at: iso(272)` and RETRACTED at `iso(3600)` — fifty-five minutes
// before it existed — in both the feed and its own lifecycle mirror. And its
// revision, `CASHFLOW_V2`, was dated `iso(86400)`: a day-old v2 superseding a
// four-minute-old v1, so the version chain on /lineage read backwards. Both are
// fixed in the same commit as this guard, which is the point — a guard that only
// covers the instance you already knew about has not established anything.
// ══════════════════════════════════════════════════════════════════════
describe('no event is dated before the context it describes', () => {
  it('covers every fixture context, derived, not a list', () => {
    expect(ALL_FIXTURE_CONTEXTS.length).toBeGreaterThanOrEqual(5);
    // `CASHFLOW_V2` lives only in `MOCK_LINEAGE_CHAINS`, and it is exactly the
    // fixture a `MOCK_CONTEXTS`-only guard would have missed.
    const inContexts = new Set(MOCK_CONTEXTS.map((c) => c.body.ctx_id));
    expect(ALL_FIXTURE_CONTEXTS.some((c) => !inContexts.has(c.body.ctx_id))).toBe(true);
    for (const c of ALL_FIXTURE_CONTEXTS) expect(Number.isFinite(Date.parse(c.body.created_at))).toBe(true);
  });

  it('holds for the events feed', () => {
    // No exception list is needed here, which is worth stating: `ev-1`/`ev-2`
    // are the documented wall-clock exception for the UPPER bound only — they
    // are dated NOW against an 81-day-old context, so they are comfortably
    // AFTER it. The lower bound is unconditional.
    const createdAt = new Map(ALL_FIXTURE_CONTEXTS.map((c) => [c.body.ctx_id, Date.parse(c.body.created_at)]));
    let checked = 0;
    for (const e of MOCK_CONTEXT_EVENTS) {
      const created = e.ctxId ? createdAt.get(e.ctxId) : undefined;
      if (created === undefined) continue;
      const lag = Math.round((Date.parse(e.eventTs) - created) / 1000);
      expect(lag, `feed ${e.id} (${e.eventType}) on ${e.ctxId} is ${-lag}s BEFORE created_at`).toBeGreaterThanOrEqual(0);
      checked++;
    }
    // Without this the loop above is vacuous the day `ctxId` is renamed.
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('holds for the lifecycle mirrors', () => {
    let checked = 0;
    for (const ctx of ALL_FIXTURE_CONTEXTS) {
      const created = Date.parse(ctx.body.created_at);
      for (const l of ctx.registry_state?.lifecycle_events ?? []) {
        const lag = Math.round((Date.parse(l.occurred_at) - created) / 1000);
        expect(
          lag,
          `lifecycle ${l.event_type} on ${ctx.body.ctx_id} is ${-lag}s BEFORE created_at`,
        ).toBeGreaterThanOrEqual(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('serves every version chain oldest-first, which is how it is labelled', () => {
    // `MOCK_LINEAGE_CHAINS` is documented "oldest → newest" and
    // `lineage-chain.tsx` renders it in array order, so the array order IS the
    // claim. The cashflow chain violated it: v2 predated v1 by a day.
    //
    // `<=` rather than `<` because two versions of one context CAN share a
    // second in principle; what cannot happen is a later version dated earlier.
    let multi = 0;
    for (const [lineageId, chain] of Object.entries(MOCK_LINEAGE_CHAINS)) {
      for (let i = 1; i < chain.length; i++) {
        const prev = Date.parse(chain[i - 1].body.created_at);
        const cur = Date.parse(chain[i].body.created_at);
        expect(prev, `${lineageId}: version ${i + 1} predates version ${i}`).toBeLessThanOrEqual(cur);
        multi++;
      }
      // And `supersedes`, where present, points BACK down the chain rather than
      // being a second, contradicting statement of the same order.
      for (let i = 1; i < chain.length; i++) {
        const sup = (chain[i].body as { supersedes?: string | null }).supersedes;
        if (sup) expect(chain.slice(0, i).map((c) => c.body.ctx_id)).toContain(sup);
      }
    }
    expect(multi, 'no chain has two versions, so the ordering claim is untested').toBeGreaterThanOrEqual(1);
  });
});

describe('ev-1 and ev-2 are a KNOWN, DOCUMENTED exception', () => {
  // Not scope-trimming — a structural fact about the dataset.
  //
  // `arcticSource` is `LIVE_LINEAGE.nodes[0]`: the LIVE run's own first node.
  // The live run is `status: 'running'`, started seconds ago. So a run happening
  // now published a context whose signed `created_at` is months old, and that
  // contradiction is not in the events feed — it is in the shape of the dataset.
  //
  // Moving ev-1/ev-2 onto the fixture clock would make the events feed agree
  // with the context card while leaving the live run's OWN step timeline
  // (`MOCK_RUN_EVENTS`) contradicting both: a run that started 24 seconds ago
  // with steps dated just as far back. That trades one visible contradiction for a
  // subtler one, which is the defect class this phase exists to remove.
  //
  // The honest fix is to DECOUPLE — the live run should publish a context with
  // no frozen receipt, and the receipt-bearing `arcticSource` should belong to
  // an older completed run. That moves LIVE_LINEAGE, MOCK_RUN_EVENTS,
  // MOCK_CONTEXT_EVENTS, MOCK_CONTEXTS and every trust fixture keyed off
  // `LIVE_LINEAGE.nodes[0].ctx_id` together, gated by `wasm-fixtures.test.ts`.
  // Filed as a follow-up rather than attempted inside a timestamps phase.
  it('still points at the live run’s first node, so the exception cannot widen silently', () => {
    // Through the EXPORTED surface (`MOCK_LINEAGE[LIVE_RUN_ID]`), which is the
    // same object as the module-private `LIVE_LINEAGE`. Exporting an internal
    // just so a test can reach it would widen the module's API for no runtime
    // consumer.
    const arctic = MOCK_LINEAGE[LIVE_RUN_ID].nodes[0].ctx_id;
    for (const id of ['ev-1', 'ev-2']) {
      const e = MOCK_CONTEXT_EVENTS.find((ev) => ev.id === id)!;
      expect(e.ctxId, `${id} no longer references the live run's first node`).toBe(arctic);
      expect(e.runId).toBe(LIVE_RUN_ID);
    }
  });

  it('is still on wall-clock time, which is what makes it an exception', () => {
    // If someone "fixes" these to the receipt clock without doing the decoupling,
    // this fails and points them at the comment above. The exception is recorded
    // as a fact, not as an absence.
    const arcticReceipt = Date.parse(MockCrypto.MOCK_CRYPTO.arcticSource.registry_receipt.created_at);
    const ev1 = Date.parse(MOCK_CONTEXT_EVENTS.find((e) => e.id === 'ev-1')!.eventTs);
    expect(Math.abs(ev1 - arcticReceipt)).toBeGreaterThan(DAY_MS);
  });
});

// ══════════════════════════════════════════════════════════════════════
// An agent's summary row agrees with the agent's own events.
//
// The gate on the phase above found `MOCK_AGENTS[DID_KEY]` still carrying
// `iso(140)` — the value ev-7 had BEFORE this phase moved it onto the receipt
// clock. `/agents` renders `First seen` / `Last active` directly above that
// agent's RECENT ACTIVITY list (`app/agents/page.tsx:88-89` and `:111`), so the
// card claimed the agent was last active two minutes ago immediately above its
// only recorded activity, dated ~83 days back. That is symptom (1) of #85 —
// one surface contradicting another about the same fact — created by the fix
// for symptom (2).
//
// The lesson from this phase's earlier gate rounds is that the guard has to
// cover the CLASS, not the instance: moving ANY event can strand the agent row
// keyed to it, in either direction. So this derives both ends from the feed
// rather than pinning literals. Run against the pre-fix fixture it fails on
// three rows, only one of which was the reported one:
//
//   DID_KEY  — lastSeen ~83 days AFTER its only event    (the gate's finding)
//   DID_SOLO — lastSeen 30s BEFORE its latest event       (this phase's ev-10
//              move; missed by the gate, same defect, same diff)
//   DID_B    — lastSeen 18s BEFORE its latest event       (pre-existing)
//
// `contextCount` is deliberately NOT asserted: it is a registry-wide total, so
// it neither equals nor bounds the number of demo events.
// ══════════════════════════════════════════════════════════════════════
describe('every agent row agrees with that agent’s own event feed', () => {
  /**
   * The same selection `listCpEvents({ agentId })` makes — SUBSTRING, not
   * equality (`lib/api/client.ts`: `e.agentId.includes(filter.agentId!)`).
   * Mirrored rather than approximated: an earlier version of this helper used
   * `===` under a comment claiming it was "exactly" the client's filter, which
   * happened to select the same rows only because no DID in `MOCK_AGENTS` is a
   * substring of another event's `agentId`. That is a property of today's
   * fixture, not of the code, so the helper now does what the client does.
   */
  function eventsOf(did: string) {
    return MOCK_CONTEXT_EVENTS.filter((e) => e.agentId.includes(did)).map((e) => ({
      id: e.id,
      ts: Date.parse(e.eventTs),
    }));
  }

  const WITH_EVENTS = MOCK_AGENTS.filter((a) => eventsOf(a.agentDid).length > 0);

  it('covers most of the roster, so the per-agent checks are not vacuous', () => {
    // If a rename silently emptied every filter, the `it.each` below would pass
    // by iterating over nothing. Measured: 4 of 4 rows carry at least one event.
    expect(MOCK_AGENTS.length).toBeGreaterThanOrEqual(4);
    expect(WITH_EVENTS.length).toBe(MOCK_AGENTS.length);
  });

  it.each(WITH_EVENTS.map((a) => [a.agentDid, a] as const))(
    '%s: firstSeen is at or before its earliest event, lastSeen IS its latest',
    (_did, agent) => {
      const evs = eventsOf(agent.agentDid);
      const earliest = Math.min(...evs.map((e) => e.ts));
      const latest = Math.max(...evs.map((e) => e.ts));
      const ids = evs.map((e) => e.id).join(', ');

      // `firstSeen` keeps a one-sided bound. It legitimately predates the feed:
      // DID_A has been seen for two days and publishes 12 contexts, of which
      // the demo feed carries one, so equality would be wrong here.
      expect(
        Date.parse(agent.firstSeen),
        `firstSeen postdates ${agent.agentDid}'s earliest event (${ids})`,
      ).toBeLessThanOrEqual(earliest);

      // `lastSeen` is pinned to EQUALITY, not a floor. A floor is what the
      // round-3 gate broke: moving an event BACKWARDS leaves the row ahead of
      // it and still passes, so `/agents` can render "Last active 8 s ago"
      // above a ten-minute-old activity list — the same contradiction, pointed
      // the other way. The floor also made the commit message's claim ("moving
      // any event carries the agent row with it") false in one direction.
      //
      // Equality is defensible where the `firstSeen` bound is not, because the
      // feed is the agent's RECENT activity in full: `listCpEvents` returns
      // every event this fixture has for the DID, newest first, and that newest
      // row is what the card renders directly under "Last active". If a future
      // fixture genuinely needs an agent last seen after its newest event, the
      // card needs to say so first.
      expect(
        Date.parse(agent.lastSeen),
        `lastSeen must equal ${agent.agentDid}'s newest event (${ids}) — the /agents card ` +
          `renders them adjacently, so any gap in either direction reads as a contradiction`,
      ).toBe(latest);
    },
  );

  it('the ephemeral did:key agent is pinned to the attested publish, not to a literal', () => {
    // The specific instance the gate caught, asserted against the same source
    // the event derives from rather than against a copied timestamp — so the
    // next move of the receipt clock carries this row with it instead of
    // stranding it again.
    const key = MOCK_AGENTS.find((a) => a.agentDid.startsWith('did:key:'));
    expect(key, 'the did:key agent row is what this asserts about').toBeTruthy();
    const ev7 = MOCK_CONTEXT_EVENTS.find((e) => e.id === 'ev-7');
    expect(ev7?.agentId).toBe(key!.agentDid);
    expect(key!.firstSeen).toBe(ev7!.eventTs);
    expect(key!.lastSeen).toBe(ev7!.eventTs);
  });
});

// ══════════════════════════════════════════════════════════════════════
// A retraction window may not swallow a signed instant about the same context.
//
// `MOCK_CRYPTO.attested` carries four frozen timestamps besides its receipt —
// `lineage_head_receipt.as_of` (with `head_status: 'active'`), the log
// checkpoint's `timestamp`, and two witness `witnessed_at` values — and
// `context-detail.tsx` renders all of them on the SAME card as the lifecycle
// strip. The first version of this phase moved the hold/restore pair onto the
// receipt clock at +1800/+5400 s, which put every one of those instants inside
// the retraction window: the card then read "head status: active, as of 12:34"
// directly above "retracted 12:27 · republished 13:27". `lib/types.ts`
// documents `head_status` as the registry's attestation of the head's status
// AT `as_of`, so that is a flat contradiction about one context on one screen.
//
// The guard is derived, not listed: it walks every ISO-8601 string anywhere in
// the crypto fixture, so a regenerated fixture that adds a fifth signed instant
// is covered without anyone remembering to add it here. Signed material cannot
// move, so the NARRATIVE is what has to stay clear of it.
// ══════════════════════════════════════════════════════════════════════
describe('no signed instant falls inside a retraction window for the same context', () => {
  /** Every ISO-8601 timestamp anywhere in a fixture, with its path. */
  function frozenInstants(node: unknown, path = ''): Array<{ path: string; ts: number }> {
    if (typeof node === 'string') {
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(node) ? [{ path, ts: Date.parse(node) }] : [];
    }
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        frozenInstants(v, path ? `${path}.${k}` : k),
      );
    }
    return [];
  }

  /** The [retracted, republished) windows the feed describes for one ctx_id. */
  function retractionWindows(ctxId: string): Array<{ from: number; to: number }> {
    const forCtx = MOCK_CONTEXT_EVENTS.filter((e) => e.ctxId === ctxId).sort(
      (a, b) => Date.parse(a.eventTs) - Date.parse(b.eventTs),
    );
    const out: Array<{ from: number; to: number }> = [];
    let openedAt: number | null = null;
    for (const e of forCtx) {
      if (e.eventType === 'context_retracted') openedAt = Date.parse(e.eventTs);
      else if (e.eventType === 'context_republished' && openedAt !== null) {
        out.push({ from: openedAt, to: Date.parse(e.eventTs) });
        openedAt = null;
      }
    }
    // A hold never lifted stays open to the end of time.
    if (openedAt !== null) out.push({ from: openedAt, to: Number.POSITIVE_INFINITY });
    return out;
  }

  const CASES = RECEIPT_BEARING.map((r) => {
    const entry = (MockCrypto.MOCK_CRYPTO as Record<string, unknown>)[r.name];
    return { name: r.name, ctxId: r.ctxId, windows: retractionWindows(r.ctxId), entry };
  });

  it('there is at least one receipt-bearing context that actually gets retracted', () => {
    // Otherwise every case below iterates over an empty window list and the
    // whole describe asserts nothing.
    const withWindows = CASES.filter((c) => c.windows.length > 0);
    expect(withWindows.length).toBeGreaterThanOrEqual(1);
    // …and that context has signed material to collide with.
    for (const c of withWindows) {
      expect(frozenInstants(c.entry).length, c.name).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s: every signed timestamp sits outside every retraction window',
    (_name, c) => {
      for (const w of c.windows) {
        for (const f of frozenInstants(c.entry)) {
          // `receipt.created_at` is the publish instant itself and is expected
          // to precede the window; the assertion is simply that nothing lands
          // strictly inside it.
          const inside = f.ts > w.from && f.ts < w.to;
          expect(
            inside,
            `${c.name}.${f.path} (${new Date(f.ts).toISOString()}) is inside the retraction window ` +
              `${new Date(w.from).toISOString()} → ${new Date(w.to).toISOString()} — the detail card ` +
              `renders both, so one of them is a lie`,
          ).toBe(false);
        }
      }
    },
  );

  it('the attested head receipt specifically attests ACTIVE, which is what makes the overlap a contradiction', () => {
    // If `head_status` were ever anything else, the guard above would still be
    // right but for a different reason. Pinned so the rationale stays true.
    const lhr = (MockCrypto.MOCK_CRYPTO.attested as Record<string, unknown>)
      .lineage_head_receipt as { as_of: string; head_status: string } | undefined;
    expect(lhr).toBeTruthy();
    expect(lhr!.head_status).toBe('active');
    const asOf = Date.parse(lhr!.as_of);
    const windows = retractionWindows(ATTESTED_CTX);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    for (const w of windows) expect(asOf < w.from || asOf >= w.to).toBe(true);
  });
});
