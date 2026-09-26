import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import type { HealthResult, ProxyService } from '@/lib/types';

/**
 * Component -> backing proxy service, for the rows that map to a running
 * service this console can health-check. The remaining rows (protocol spec,
 * language bindings) aren't backed by any service this console talks to.
 */
export const SDK_MATRIX_ROW_SERVICE: Record<string, ProxyService> = {
  // `registry-a` only — deliberately, and the label says so. This console
  // talks to two registries, and while this column was static reference text
  // that did not matter. Now that it is live, a row labelled "Registry" would
  // present registry-a's confirmed build id as THE registry version while
  // registry-b ran something else entirely. Showing both is a table-shape
  // change for a design pass; naming the one we actually probed is honest today.
  // NOTE: this key and the `component` string in MOCK_SDK_MATRIX must move
  // together or the row silently falls through to `reference` in real mode —
  // `sdk-matrix-utils.test.ts` asserts every key here exists there.
  'Registry A (Rust/axum)': 'registry-a',
  'Control Plane (NestJS)': 'control-plane',
  'Playground (FastAPI)': 'playground',
};

/**
 * The backing service for a row, or `undefined` for the four rows that have
 * none.
 *
 * Exists to make that `undefined` visible to the type checker. This repo runs
 * `strict` without `noUncheckedIndexedAccess`, so a direct
 * `SDK_MATRIX_ROW_SERVICE[component]` is typed `ProxyService` — non-nullable —
 * even though it really is `undefined` for four of seven rows. The
 * `if (!service)` branch below is now the load-bearing first decision of this
 * whole function, and against a non-nullable type TypeScript would believe
 * that branch can never fire, so deleting it would raise no error at all.
 * Declaring the `| undefined` here makes the guard load-bearing to the
 * compiler too: drop it and `healthByService.get(service)` stops typechecking.
 *
 * The exported map keeps its `Record` type so `Object.keys`/`Object.values`
 * stay usable by callers that legitimately want all of them.
 */
function backingServiceFor(component: string): ProxyService | undefined {
  return SDK_MATRIX_ROW_SERVICE[component];
}

export type SdkMatrixRowStatus = 'ok' | 'down' | 'unknown' | 'reference';

export interface SdkMatrixRowView {
  component: string;
  version: string;
  /** False when `version` is static reference data that isn't confirmed against the running service. */
  versionIsLive: boolean;
  status: SdkMatrixRowStatus;
}

/**
 * All three backend services (control-plane, playground, registry-rs) expose a
 * `version` field on /healthz today — this console just never read it. A row
 * only ever claims `versionIsLive: true` when a real /healthz response
 * actually carried a parseable version string; a service still loading, or
 * running an older deployment predating this field, falls back to
 * MOCK_SDK_MATRIX's static reference string, explicitly marked unconfirmed
 * (`versionIsLive: false`) rather than silently substituted.
 *
 * A DOWN service is not automatically in that fallback group. Both upstreams
 * with a failure path put `version` on the degraded body deliberately, and
 * `pingHealth` reads it there, so a down row typically names the build that is
 * down and reports it live — because it was observed live, on that very
 * response. (This paragraph is the correction: the docblock previously listed
 * "down" alongside loading and older-deployment as always falling back, which
 * stopped being true once the failure path learned to read the version. The
 * predicate below needed no change; only this description did.)
 *
 * **Reference-ness is a property of the ROW, not of the mode.** The four rows
 * with no entry in `SDK_MATRIX_ROW_SERVICE` — the spec and the three language
 * bindings — are not backed by anything this console can probe in *either*
 * mode, so they are `reference` in both. That check therefore runs FIRST, and
 * `demoMode` decides only what the health probe reports, which is the one
 * thing demo mode is entitled to fake.
 *
 * Demo mode claims no live version at all, for any row. It never pings, so it
 * has no live version to report: `pingHealth`'s demo branch returns no
 * `version` field (asserted in `client-demo.test.ts`), and a row asserting
 * `versionIsLive: true` beside a probe that demonstrably returned nothing is
 * incoherent whichever row it is. `status: 'ok'` for the service-backed rows
 * stays — the demo is a story about a system that is up, and faking the probe
 * is exactly what it is for. Faking *provenance* is not.
 */
export function buildSdkMatrixRows(
  demoMode: boolean,
  healthByService: ReadonlyMap<ProxyService, HealthResult | undefined>,
): SdkMatrixRowView[] {
  return MOCK_SDK_MATRIX.map((row) => {
    const service = backingServiceFor(row.component);

    // Row-intrinsic first: no backing service in any mode means `reference` in
    // any mode. Only below this does the mode get a say.
    if (!service) {
      return { component: row.component, version: row.version, versionIsLive: false, status: 'reference' };
    }

    if (demoMode) {
      return { component: row.component, version: row.version, versionIsLive: false, status: 'ok' };
    }

    const health = healthByService.get(service);
    const liveVersion = health?.version;
    return {
      component: row.component,
      version: liveVersion ?? row.version,
      versionIsLive: liveVersion !== undefined,
      status: health === undefined ? 'unknown' : health.ok ? 'ok' : 'down',
    };
  });
}
