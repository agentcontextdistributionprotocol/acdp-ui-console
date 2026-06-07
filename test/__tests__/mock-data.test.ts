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

describe('enrollment mocks', () => {
  it('every enrollment has an authority and tenant', () => {
    for (const e of MOCK_ENROLLMENTS) {
      expect(e.authority).toBeTruthy();
      expect(e.tenantId).toBeTruthy();
    }
  });
});
