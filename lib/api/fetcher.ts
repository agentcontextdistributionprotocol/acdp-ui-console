import type { ProxyService } from '@/lib/types';

export class ApiError extends Error {
  readonly status: number;
  readonly service: ProxyService;
  readonly path: string;

  constructor(status: number, body: string, service: ProxyService, path: string) {
    super(body || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.service = service;
    this.path = path;
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
