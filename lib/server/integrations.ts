import type { ProxyService } from '@/lib/types';
import { CLIENT_IP_HEADER, upstreamClientIp } from '@/lib/server/client-ip';

export type { ProxyService };

/**
 * Which control-plane key a request carries. `admin` (CONTROL_PLANE_API_KEY)
 * is what every request used before public mode, and what the operator uses.
 * `read` (CONTROL_PLANE_READ_API_KEY) is a non-admin key for anonymous
 * public-mode reads: CP's own `assertAdmin` refuses it, and CP throttles per
 * key, so visitor traffic does not share a bucket with the playground's run
 * notifications. It never silently becomes the admin key here; the caller
 * decides about a fallback.
 */
export type ControlPlaneCredential = 'admin' | 'read';

interface ServiceConfig {
  service: ProxyService;
  baseUrl: string;
  /** `authorization` (Bearer) for the control plane, `x-api-key` for the playground family. */
  authHeaderName?: 'authorization' | 'x-api-key';
  authToken?: string;
}

const isProduction = process.env.NODE_ENV === 'production';

// Registries are no longer reached directly: their public domains are being
// removed, so both go through the playground's key-gated, GET-only passthrough
// (acdp-playground `playground/api/registry_proxy.py`), which mirrors this
// console's registry route list. They stay separate services here so the
// `x-acdp-ui-proxy` stamp keeps naming the registry the call asked about.
const REGISTRY_PASSTHROUGH: Partial<Record<ProxyService, string>> = {
  'registry-a': '/registries/a',
  'registry-b': '/registries/b',
};

const DEFAULTS: Record<'playground' | 'control-plane', { envVar: string; fallback: string }> = {
  playground: { envVar: 'PLAYGROUND_BASE_URL', fallback: 'http://localhost:8000' },
  'control-plane': { envVar: 'CONTROL_PLANE_BASE_URL', fallback: 'http://localhost:3001' },
};

function resolveBaseUrl(service: 'playground' | 'control-plane'): string {
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

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** True for the services whose requests land on the playground (and so carry its key). */
export function isPlaygroundBacked(service: ProxyService): boolean {
  return service === 'playground' || service in REGISTRY_PASSTHROUGH;
}

export function getIntegrationConfig(
  service: ProxyService,
  credential: ControlPlaneCredential = 'admin',
): ServiceConfig {
  if (service === 'control-plane') {
    return {
      service,
      baseUrl: resolveBaseUrl('control-plane'),
      authHeaderName: 'authorization',
      authToken:
        (credential === 'read' ? process.env.CONTROL_PLANE_READ_API_KEY : process.env.CONTROL_PLANE_API_KEY) ?? '',
    };
  }
  const playground = trimSlash(resolveBaseUrl('playground'));
  return {
    service,
    baseUrl: `${playground}${REGISTRY_PASSTHROUGH[service] ?? ''}`,
    authHeaderName: 'x-api-key',
    authToken: process.env.PLAYGROUND_API_KEY ?? '',
  };
}

/**
 * The server-side headers a request to `service` carries, set deterministically
 * and never inherited from the client: the control plane's bearer for the
 * chosen credential, or the playground key plus the end user's IP for the
 * playground family. An empty token sends no credential header at all (the
 * playground accepts that while its enforcement is optional).
 */
export function upstreamAuthHeaders(
  service: ProxyService,
  opts: { credential?: ControlPlaneCredential; clientIp?: string } = {},
): Record<string, string> {
  const config = getIntegrationConfig(service, opts.credential);
  const headers: Record<string, string> = {};
  if (config.authHeaderName === 'authorization') {
    if (config.authToken) headers.authorization = `Bearer ${config.authToken}`;
    return headers;
  }
  if (config.authToken) headers['x-api-key'] = config.authToken;
  const ip = opts.clientIp === undefined ? undefined : upstreamClientIp(opts.clientIp);
  if (ip) headers[CLIENT_IP_HEADER] = ip;
  return headers;
}

export function isProxyService(value: string): value is ProxyService {
  return (
    value === 'playground' ||
    value === 'control-plane' ||
    value === 'registry-a' ||
    value === 'registry-b'
  );
}

export function buildUpstreamUrl(service: ProxyService, path: string, search?: string): string {
  const config = getIntegrationConfig(service);
  const base = trimSlash(config.baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}${search ?? ''}`;
}
