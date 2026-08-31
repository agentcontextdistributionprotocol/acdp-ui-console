import { describe, expect, it } from 'vitest';
import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import { SDK_MATRIX_ROW_SERVICE, buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import type { ProxyService } from '@/lib/types';

const SERVICE_BACKED = Object.keys(SDK_MATRIX_ROW_SERVICE);
const REFERENCE_ONLY = MOCK_SDK_MATRIX.map((r) => r.component).filter((c) => !SERVICE_BACKED.includes(c));

describe('buildSdkMatrixRows', () => {
  it('demo mode: every row is a live-looking ok, matching the mock version', () => {
    const rows = buildSdkMatrixRows(true, new Map());
    expect(rows).toHaveLength(MOCK_SDK_MATRIX.length);
    for (const row of rows) {
      expect(row.status).toBe('ok');
      expect(row.versionIsLive).toBe(true);
    }
  });

  it('live mode: service-backed rows never claim a live version, since no backend exposes one', () => {
    const health = new Map<ProxyService, boolean | undefined>(
      Object.values(SDK_MATRIX_ROW_SERVICE).map((s) => [s, true]),
    );
    const rows = buildSdkMatrixRows(false, health);
    for (const row of rows) {
      if (SERVICE_BACKED.includes(row.component)) {
        expect(row.versionIsLive).toBe(false);
      }
    }
  });

  it('live mode: service-backed row status reflects actual health, up/down/unknown', () => {
    const health = new Map<ProxyService, boolean | undefined>([
      ['registry-a', true],
      ['control-plane', false],
      // playground intentionally omitted -> still loading -> unknown
    ]);
    const rows = buildSdkMatrixRows(false, health);
    const byComponent = new Map(rows.map((r) => [r.component, r]));
    expect(byComponent.get('Registry (Rust/axum)')?.status).toBe('ok');
    expect(byComponent.get('Control Plane (NestJS)')?.status).toBe('down');
    expect(byComponent.get('Playground (FastAPI)')?.status).toBe('unknown');
  });

  it('live mode: rows with no backing service are always "reference", never "unknown"', () => {
    const rows = buildSdkMatrixRows(false, new Map());
    for (const component of REFERENCE_ONLY) {
      const row = rows.find((r) => r.component === component);
      expect(row?.status).toBe('reference');
      expect(row?.versionIsLive).toBe(false);
      expect(row?.version).toBe(MOCK_SDK_MATRIX.find((m) => m.component === component)?.version);
    }
  });

  it('every row from the catalog is represented, in order', () => {
    const rows = buildSdkMatrixRows(false, new Map());
    expect(rows.map((r) => r.component)).toEqual(MOCK_SDK_MATRIX.map((r) => r.component));
  });
});
