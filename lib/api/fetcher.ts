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

export async function fetchJson<T>(service: ProxyService, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(proxyUrl(service, path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new ApiError(response.status, message, service, path);
  }
  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

export async function fetchText(service: ProxyService, path: string): Promise<string> {
  const response = await fetch(proxyUrl(service, path), { cache: 'no-store' });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new ApiError(response.status, message, service, path);
  }
  return response.text();
}
