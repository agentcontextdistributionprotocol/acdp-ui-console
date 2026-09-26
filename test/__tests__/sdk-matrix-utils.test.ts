import { describe, expect, it } from 'vitest';
import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import { SDK_MATRIX_ROW_SERVICE, buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import type { HealthResult, ProxyService } from '@/lib/types';

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

  it('live mode: a service-backed row claims a live version when /healthz actually returned one', () => {
    const health = new Map<ProxyService, HealthResult | undefined>(
      Object.values(SDK_MATRIX_ROW_SERVICE).map((s) => [s, { ok: true, version: `${s}-v9.9.9` }]),
    );
    const rows = buildSdkMatrixRows(false, health);
    for (const row of rows) {
      if (SERVICE_BACKED.includes(row.component)) {
        const service = SDK_MATRIX_ROW_SERVICE[row.component];
        expect(row.versionIsLive).toBe(true);
        expect(row.version).toBe(`${service}-v9.9.9`);
      }
    }
  });

  it('live mode: a healthy service-backed row with no version in the response falls back to the reference string, not live', () => {
    const health = new Map<ProxyService, HealthResult | undefined>(
      Object.values(SDK_MATRIX_ROW_SERVICE).map((s) => [s, { ok: true }]),
    );
    const rows = buildSdkMatrixRows(false, health);
    for (const row of rows) {
      if (SERVICE_BACKED.includes(row.component)) {
        expect(row.versionIsLive).toBe(false);
        expect(row.version).toBe(MOCK_SDK_MATRIX.find((m) => m.component === row.component)?.version);
      }
    }
  });

  it('live mode: a down service with no version falls back to the reference string', () => {
    const health = new Map<ProxyService, HealthResult | undefined>([['registry-a', { ok: false }]]);
    const rows = buildSdkMatrixRows(false, health);
    const row = rows.find((r) => r.component === 'Registry (Rust/axum)');
    expect(row?.status).toBe('down');
    expect(row?.versionIsLive).toBe(false);
    expect(row?.version).toBe(MOCK_SDK_MATRIX.find((m) => m.component === 'Registry (Rust/axum)')?.version);
  });

  it('live mode: a down service DOES report the version its own failure response carried', () => {
    // Deliberate behaviour change (issue #73 point 3). This test was previously
    // titled "a down service never claims a live version, even if one rode a
    // prior response" — but its fixture had no version field at all, so it
    // asserted nothing its title claimed and passed vacuously. The title would
    // have become false the moment `pingHealth` started reading the version off
    // a degraded body, while the test kept passing: a green test documenting
    // the opposite of the truth.
    //
    // `versionIsLive: true` is correct here. The version was observed live, on
    // this response — it is not a memory of an earlier success. A row that names
    // WHICH build is down is the more useful failure display, which is what the
    // issue asked for.
    const health = new Map<ProxyService, HealthResult | undefined>([
      ['registry-a', { ok: false, version: '0.1.4+gdeadbee' }],
    ]);
    const rows = buildSdkMatrixRows(false, health);
    const row = rows.find((r) => r.component === 'Registry (Rust/axum)');
    expect(row?.status).toBe('down');
    expect(row?.version).toBe('0.1.4+gdeadbee');
    expect(row?.versionIsLive).toBe(true);
  });

  it('live mode: a control plane reported unhealthy maps to a down row with its version', () => {
    // HALF of Phase 6's criterion 5, and only half: this hand-feeds an
    // already-reduced HealthResult, so it says nothing about HTTP 200 or
    // `extractHealthOk` and would pass byte-identically before that phase.
    // What it does pin is that `ok: false` + a version reaches the operator as
    // a `down` row naming the build. The wire-to-row half — the control
    // plane's in-band `200 {ok:false}` actually producing this HealthResult —
    // is `client.test.ts`'s "carries a control plane degraded at HTTP 200 from
    // the wire to a down matrix row".
    const health = new Map<ProxyService, HealthResult | undefined>([
      ['control-plane', { ok: false, version: '1.4.2' }],
    ]);
    const rows = buildSdkMatrixRows(false, health);
    const row = rows.find((r) => r.component === 'Control Plane (NestJS)');
    expect(row?.status).toBe('down');
    expect(row?.version).toBe('1.4.2');
    expect(row?.versionIsLive).toBe(true);
  });

  it('live mode: service-backed row status reflects actual health, up/down/unknown', () => {
    const health = new Map<ProxyService, HealthResult | undefined>([
      ['registry-a', { ok: true, version: '0.1.0' }],
      ['control-plane', { ok: false }],
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
