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
} from '@/lib/data/mock-data';
import { scenarioNumber } from '@/components/scenarios/scenario-card';

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
      expect(r.content_hash).toBe(c.body.content_hash);
      expect(r.key_fingerprint).toMatch(/^sha256:/);
      expect(r.signature.algorithm).toBeTruthy();
    }
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
});
