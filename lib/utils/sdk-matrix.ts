import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';
import type { ProxyService } from '@/lib/types';

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
 * None of the three backend services (control-plane, playground,
 * registry-rs) expose a version field on /healthz or any other route today,
 * so a live version can never be derived — only reachability can. Rendering
 * MOCK_SDK_MATRIX's version string as if it were live-checked would let a
 * real operator see a stale or nonexistent version with no indication it
 * was never actually confirmed against the running service.
 */
export function buildSdkMatrixRows(
  demoMode: boolean,
  healthByService: ReadonlyMap<ProxyService, boolean | undefined>,
): SdkMatrixRowView[] {
  return MOCK_SDK_MATRIX.map((row) => {
    const service = SDK_MATRIX_ROW_SERVICE[row.component];

    if (demoMode) {
      return { component: row.component, version: row.version, versionIsLive: true, status: 'ok' };
    }

    if (!service) {
      return { component: row.component, version: row.version, versionIsLive: false, status: 'reference' };
    }

    const ok = healthByService.get(service);
    return {
      component: row.component,
      version: row.version,
      versionIsLive: false,
      status: ok === undefined ? 'unknown' : ok ? 'ok' : 'down',
    };
  });
}
