// Types for scripts/smoke-checks.mjs (a zero-dependency Node script, so it
// ships no .d.ts of its own; tsconfig has allowJs: false). Kept under test/
// because only test/__tests__/smoke-checks.test.ts imports it — a compiled
// declaration outside test/ trips registry-card-profiles.test.tsx's
// unscanned-compiled-source guard.
declare module '@/scripts/smoke-checks.mjs' {
  export interface CheckResult {
    ok: boolean;
    reason: string;
  }
  export const PAGE_ROUTES: string[];
  export const GATE_PROBES: string[];
  export function classifyGateResponse(status: number, bodyText: string): CheckResult;
  export function checkPage(base: string, route: string, fetchImpl?: typeof fetch): Promise<CheckResult>;
  export function checkGate(base: string, path: string, fetchImpl?: typeof fetch): Promise<CheckResult>;
  export function runSmoke(
    base: string,
    opts?: {
      fetchImpl?: typeof fetch;
      log?: (s: string) => void;
      error?: (s: string) => void;
      expectPublicMode?: string;
      directBackendUrls?: string[];
    },
  ): Promise<number>;
  export type Classifier = (status: number, bodyText: string) => CheckResult;
  export const PUBLIC_OPEN_PROBES: string[];
  export const PUBLIC_ADMIN_PROBES: string[];
  export const PUBLIC_DENY_PROBES: string[];
  export const PUBLIC_TRAVERSAL_PROBE: string;
  export function classifyTraversal(status: number, bodyText: string): CheckResult;
  export function classifyPublicOpen(status: number): CheckResult;
  export function classifyAdminDenied(status: number, bodyText: string): CheckResult;
  export function classifyDenied(status: number): CheckResult;
  export const DEFAULT_EXPECTED_PUBLIC_MODE: string;
  export function detectMode(
    base: string,
    fetchImpl?: typeof fetch,
    expect?: string,
  ): Promise<CheckResult & { publicMode: boolean }>;
  export function probe(base: string, path: string, classify: Classifier, fetchImpl?: typeof fetch): Promise<CheckResult>;
  export function probesFor(publicMode: boolean): { path: string; classify: Classifier }[];
  export function checkDirectBackend(url: string, fetchImpl?: typeof fetch): Promise<CheckResult>;
}
