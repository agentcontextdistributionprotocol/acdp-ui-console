import { describe, expect, it } from 'vitest';
import {
  MOCK_SCENARIOS,
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
  SCENARIO_COUNT,
} from '@/lib/data/mock-data';
import * as MockData from '@/lib/data/mock-data';
import { scenarioNumber } from '@/components/scenarios/scenario-card';
import packageLock from '@/package-lock.json';

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
  it("the acdp-rs row matches the version this console's wasm is locked to", () => {
    const wasmVersion: string =
      packageLock.packages['node_modules/@agentcontextdistributionprotocol/acdp-wasm'].version;
    const wasmMajorMinor = wasmVersion.split('.').slice(0, 2).join('.');
    const rustRow = MOCK_SDK_MATRIX.find((r) => r.component === 'acdp-rs library');
    expect(rustRow).toBeDefined();
    const rustMajorMinor = rustRow!.version.split('.').slice(0, 2).join('.');
    expect(rustMajorMinor).toBe(wasmMajorMinor);
  });

  it('the ACDP spec row is 0.4.0 Final (RFC-ACDP-0015 promoted 2026-08-28)', () => {
    const specRow = MOCK_SDK_MATRIX.find((r) => r.component === 'ACDP spec');
    expect(specRow?.version).toBe('0.4.0 Final');
  });

  it('every row has a non-empty component, version and ok status', () => {
    for (const row of MOCK_SDK_MATRIX) {
      expect(row.component.length).toBeGreaterThan(0);
      expect(row.version.length).toBeGreaterThan(0);
      expect(row.status).toBe('ok');
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
    expect(MOCK_CAPABILITIES.a.acdp_version).toBe('0.3.0');
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
    // getCpDashboard's demo branch (lib/api/client.ts) spreads MOCK_DASHBOARD
    // verbatim, so this fixture-level check is also the pass-through check —
    // no separate field-mapping logic exists that could drop the new field.
    const { getCpDashboard } = await import('@/lib/api/client');
    const dash = await getCpDashboard('24h', true);
    expect(dash.keyRevocation).toEqual(MOCK_DASHBOARD.keyRevocation);
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
