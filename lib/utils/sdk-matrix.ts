import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import type { HealthResult, ProxyService } from '@/lib/types';

/**
 * Component -> backing proxy service, for the rows that map to a running
 * service this console can health-check. The remaining rows (protocol spec,
 * language bindings) aren't backed by any service this console talks to.
 */
export const SDK_MATRIX_ROW_SERVICE: Record<string, ProxyService> = {
  'Registry (Rust/axum)': 'registry-a',
  'Control Plane (NestJS)': 'control-plane',
  'Playground (FastAPI)': 'playground',
};

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
 * Demo mode's own `versionIsLive: true` branch just below is issue #69a's
 * defect (reference-ness reading as live-confirmed in demo mode), tracked
 * and fixed separately — this function's real-mode path below it is what
 * this phase corrects, and deliberately doesn't touch the demo branch.
 */
export function buildSdkMatrixRows(
  demoMode: boolean,
  healthByService: ReadonlyMap<ProxyService, HealthResult | undefined>,
): SdkMatrixRowView[] {
  return MOCK_SDK_MATRIX.map((row) => {
    const service = SDK_MATRIX_ROW_SERVICE[row.component];

    if (demoMode) {
      return { component: row.component, version: row.version, versionIsLive: true, status: 'ok' };
    }

    if (!service) {
      return { component: row.component, version: row.version, versionIsLive: false, status: 'reference' };
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
