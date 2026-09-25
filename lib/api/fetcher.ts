import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { ProxyService } from '@/lib/types';

// control-plane's GlobalExceptionFilter (src/errors/exception.filter.ts) formats
// structured errors as `{statusCode, errorCode, message, error: {code, message}}`
// with a top-level `errorCode` — `error.code` carries the same value, nested, as a
// fallback. Most call sites' bodies aren't JSON at all (plain text, an upstream's
// own error page), so a parse failure is expected, not exceptional — never let it
// mask the original HTTP error by throwing here.
function parseErrorCode(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { errorCode?: unknown; error?: { code?: unknown } };
    if (typeof parsed.errorCode === 'string') return parsed.errorCode;
    if (typeof parsed.error?.code === 'string') return parsed.error.code;
    return undefined;
  } catch {
    return undefined;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly service: ProxyService;
  readonly path: string;
  /**
   * Structured upstream error code, when the body carried one.
   *
   * **Not control-plane-exclusive.** The top-level `errorCode` is the control
   * plane's (SCREAMING_SNAKE — `CONTEXT_ID_MISMATCH`,
   * `FEDERATION_UPSTREAM_RATE_LIMITED`), but the nested `error.code` fallback
   * above also matches the registry's own RFC-ACDP-0007 §5 wire envelope
   * (`acdp-registry-types/src/error.rs:83-92`), so a direct registry call
   * populates this with lowercase snake_case (`schema_violation`,
   * `rate_limited`, `not_authorized`). The two vocabularies do not collide
   * today, but nothing enforces that — so anything keyed by this value must
   * match exactly and must not infer provenance from the code alone. See
   * `lib/utils/api-error-messages.ts`.
   */
  readonly errorCode?: string;

  constructor(status: number, body: string, service: ProxyService, path: string) {
    super(body || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.service = service;
    this.path = path;
    this.errorCode = parseErrorCode(body);
  }

  get isNotFound() {
    return this.status === 404;
  }
}

export function proxyUrl(service: ProxyService, path: string): string {
  return `/api/proxy/${service}${path.startsWith('/') ? path : `/${path}`}`;
}

// The proxy/stream gate (middleware.ts) returns 401 when the operator
// session is missing/invalid. Demo mode never reaches this: lib/api/client.ts
// returns mock data before touching fetchJson/fetchText, so this only fires
// in real mode.
//
// This runs outside any component (fetchJson/fetchText are plain module
// functions, often called from React Query's queryFn), so there's no
// `useRouter()` to reach for — a full navigation via `location.assign` is
// the correct tool here, not a lint smell.
function redirectToLoginOn401(status: number): void {
  if (status !== 401 || typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login');
}

export async function fetchJson<T>(service: ProxyService, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(proxyUrl(service, path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    redirectToLoginOn401(response.status);
    throw new ApiError(response.status, message, service, path);
  }
  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

export async function fetchText(service: ProxyService, path: string): Promise<string> {
  const response = await fetch(proxyUrl(service, path), { cache: 'no-store' });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    redirectToLoginOn401(response.status);
    throw new ApiError(response.status, message, service, path);
  }
  return response.text();
}

// A native EventSource's `onerror` carries no HTTP status, so a caller can't
// tell "the operator session expired mid-connection" (401 — should redirect
// to /login) from an ordinary network blip (should just keep retrying) from
// the error event alone. Callers use this to confirm AFTER an SSE error,
// never before connecting: a pre-flight check would spend a request on every
// happy-path SSE open to guard a case (cold-load 401) every page already
// handles via its own gated fetchJson call before the stream ever opens. It
// issues one cheap gated GET and lets fetchJson's existing
// `redirectToLoginOn401` do the redirect if (and only if) the session really
// has expired; any other failure (network blip, upstream down) is not this
// helper's concern, so it's swallowed.
export async function confirmSessionOrRedirect(): Promise<void> {
  // Demo mode has no proxy session to confirm and must never touch the
  // proxy. Guarded here — not just by caller discipline — so a future
  // caller can't accidentally fire a real request from demo mode.
  if (usePreferencesStore.getState().demoMode) return;
  try {
    await fetchJson('control-plane', '/healthz');
  } catch {
    /* fetchJson already redirected if this was a 401 */
  }
}
