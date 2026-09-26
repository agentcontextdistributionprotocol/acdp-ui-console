import { describe, expect, it } from 'vitest';
import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import { SDK_MATRIX_ROW_SERVICE, buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import type { HealthResult, ProxyService } from '@/lib/types';

const SERVICE_BACKED = Object.keys(SDK_MATRIX_ROW_SERVICE);
const REFERENCE_ONLY = MOCK_SDK_MATRIX.map((r) => r.component).filter((c) => !SERVICE_BACKED.includes(c));

// Several tests below are `for (const c of …) expect(…)` loops, which assert
// nothing at all over an empty list. Both lists are derived from production
// data, so a refactor really could empty one. Failing here, at import, turns
// every such loop red at once instead of leaving them silently green.
if (SERVICE_BACKED.length === 0) throw new Error('SDK_MATRIX_ROW_SERVICE is empty');
if (REFERENCE_ONLY.length === 0) throw new Error('MOCK_SDK_MATRIX has no reference-only rows');

/**
 * Derived, not hardcoded. These tests are about behaviour keyed on the backing
 * service, not about what the row is called — so a future relabel (this phase
 * did one: `Registry` → `Registry A`, because the row only ever probes
 * registry-a) should not be able to turn them red or, worse, green-but-vacuous
 * by silently matching nothing.
 *
 * Note what this does NOT do: the key-coverage test below guards the two
 * strings against drifting APART, which is a different claim from guarding
 * what the label says. Reverting both files together would satisfy it. The
 * label's content is pinned separately, in its own test.
 */
function rowFor(service: ProxyService): string {
  const component = SERVICE_BACKED.find((key) => SDK_MATRIX_ROW_SERVICE[key] === service);
  if (!component) throw new Error(`No SDK matrix row is backed by '${service}'`);
  return component;
}
const REGISTRY_ROW = rowFor('registry-a');

describe('buildSdkMatrixRows', () => {
  // REWRITTEN, not deleted (issue #69a). This test previously asserted
  // `versionIsLive: true` for every demo row, which locked the defect in: it
  // made reference data read as confirmed-against-a-running-service in the
  // console's DEFAULT mode. Demo mode never pings, so it has no live version
  // to report — `pingHealth`'s demo branch returns no `version` at all
  // (`client-demo.test.ts`). The two halves of the old assertion are now split
  // because they are different claims, and only one of them was wrong.
  it('demo mode: no row claims a live version — the probe is faked, provenance is not', () => {
    const rows = buildSdkMatrixRows(true, new Map());
    expect(rows).toHaveLength(MOCK_SDK_MATRIX.length);
    for (const row of rows) {
      expect(row.versionIsLive).toBe(false);
      expect(row.version).toBe(MOCK_SDK_MATRIX.find((m) => m.component === row.component)?.version);
    }
  });

  it('demo mode: service-backed rows stay ok, unbacked rows are reference', () => {
    // Demo did NOT go grey — `status: 'ok'` for a row with a backing service
    // is correct, because the demo is a story about a system that is up.
    // A row with no backing service in EITHER mode is not a service that is
    // up, and `reference` is what real mode already shows for those same rows.
    const byComponent = new Map(buildSdkMatrixRows(true, new Map()).map((r) => [r.component, r]));
    for (const component of SERVICE_BACKED) expect(byComponent.get(component)?.status).toBe('ok');
    for (const component of REFERENCE_ONLY) expect(byComponent.get(component)?.status).toBe('reference');
  });

  it('a row with no backing service is reference in BOTH modes — reference-ness is not a mode', () => {
    const demo = new Map(buildSdkMatrixRows(true, new Map()).map((r) => [r.component, r]));
    const live = new Map(buildSdkMatrixRows(false, new Map()).map((r) => [r.component, r]));
    for (const component of REFERENCE_ONLY) {
      expect(demo.get(component)).toEqual(live.get(component));
      expect(demo.get(component)?.status).toBe('reference');
    }
  });

  it('every SDK_MATRIX_ROW_SERVICE key exists as a MOCK_SDK_MATRIX component', () => {
    // The map key and the row label are one string in two files. If they drift
    // — a relabel that moves only one — the row silently degrades to
    // `reference` in real mode and stops being probed at all, with no test
    // failure anywhere else: the length/order guard below cannot see it.
    const components = MOCK_SDK_MATRIX.map((r) => r.component);
    for (const key of SERVICE_BACKED) expect(components).toContain(key);
  });

  it('the registry row names WHICH registry it probes, not "the registry"', () => {
    // The row is backed by registry-a alone (`SDK_MATRIX_ROW_SERVICE`), while
    // this console talks to two registries. A row labelled just "Registry"
    // would present registry-a's confirmed build id as THE registry version
    // with registry-b possibly running something else — a live claim wider
    // than the evidence, which is what issue #69 is about.
    //
    // The key-coverage test above cannot catch this: it only asserts the map
    // key and the mock row agree, so renaming BOTH back to "Registry" would
    // satisfy it. These two assertions pin the content instead — the property
    // (the label names the one registry actually probed), not the exact prose.
    //
    // A pair, because they catch opposite halves of the drift and neither
    // catches the other's.
    //
    // The regex requires WHITESPACE after the registry's name, which is not
    // pedantry: `\b` would admit `Registry A/B (…)` — '/' is a word boundary —
    // and that is exactly the relabel that restores the defect, a row named
    // for both registries while only registry-a is ever probed. Verified by
    // mutation: with `\b`, the A/B relabel passes this whole file.
    //
    // The second assertion catches the mirror image — someone wires registry-b
    // into the map and leaves the label alone. Note it is NOT interchangeable
    // with asserting `SDK_MATRIX_ROW_SERVICE[REGISTRY_ROW] === 'registry-a'`,
    // which is true by construction: `rowFor` selects the key on exactly that
    // predicate, so that assertion could never fail.
    expect(REGISTRY_ROW).toMatch(/^Registry A\s/);
    expect(Object.values(SDK_MATRIX_ROW_SERVICE)).not.toContain('registry-b');
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
    const row = rows.find((r) => r.component === REGISTRY_ROW);
    expect(row?.status).toBe('down');
    expect(row?.versionIsLive).toBe(false);
    expect(row?.version).toBe(MOCK_SDK_MATRIX.find((m) => m.component === REGISTRY_ROW)?.version);
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
    const row = rows.find((r) => r.component === REGISTRY_ROW);
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
    expect(byComponent.get(REGISTRY_ROW)?.status).toBe('ok');
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
