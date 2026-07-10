import type { ProxyService } from '@/lib/types';

export type { ProxyService };

interface ServiceConfig {
  service: ProxyService;
  baseUrl: string;
  authHeaderName?: string;
  authToken?: string;
}

const isProduction = process.env.NODE_ENV === 'production';

const DEFAULTS: Record<ProxyService, { envVar: string; fallback: string }> = {
  playground: { envVar: 'PLAYGROUND_BASE_URL', fallback: 'http://localhost:8000' },
  'control-plane': { envVar: 'CONTROL_PLANE_BASE_URL', fallback: 'http://localhost:3001' },
  'registry-a': { envVar: 'REGISTRY_A_BASE_URL', fallback: 'http://localhost:8100' },
  'registry-b': { envVar: 'REGISTRY_B_BASE_URL', fallback: 'http://localhost:8200' },
  'registry-c': { envVar: 'REGISTRY_C_BASE_URL', fallback: 'http://localhost:8300' },
};

function resolveBaseUrl(service: ProxyService): string {
  const { envVar, fallback } = DEFAULTS[service];
  const url = process.env[envVar];
  if (url) return url;
  if (isProduction) {
    throw new Error(
      `[ACDP UI] ${envVar} is required in production. Service '${service}' cannot fall back to ${fallback}.`,
    );
  }
  return fallback;
}

export function getIntegrationConfig(service: ProxyService): ServiceConfig {
  const baseUrl = resolveBaseUrl(service);
  if (service === 'control-plane') {
    return {
      service,
      baseUrl,
      authHeaderName: 'authorization',
      authToken: process.env.CONTROL_PLANE_API_KEY ?? '',
    };
  }
  return { service, baseUrl };
}

export function isProxyService(value: string): value is ProxyService {
  return (
    value === 'playground' ||
    value === 'control-plane' ||
    value === 'registry-a' ||
    value === 'registry-b' ||
    value === 'registry-c'
  );
}

export function buildUpstreamUrl(service: ProxyService, path: string, search?: string): string {
  const config = getIntegrationConfig(service);
  const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}${search ?? ''}`;
}
