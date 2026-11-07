import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUpstreamUrl,
  getIntegrationConfig,
  isPlaygroundBacked,
  isProxyService,
  upstreamAuthHeaders,
} from '@/lib/server/integrations';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isProxyService', () => {
  it('accepts the four known services', () => {
    for (const s of ['playground', 'control-plane', 'registry-a', 'registry-b']) {
      expect(isProxyService(s)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    // registry-c was retired when the playground consolidated to two registries.
    expect(isProxyService('registry-c')).toBe(false);
    expect(isProxyService('')).toBe(false);
    expect(isProxyService('Control-Plane')).toBe(false);
  });
});

describe('getIntegrationConfig', () => {
  it('the control plane carries a bearer; the playground family carries the playground key', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'secret-token');
    vi.stubEnv('PLAYGROUND_API_KEY', 'pg-key');
    const cp = getIntegrationConfig('control-plane');
    expect(cp.authHeaderName).toBe('authorization');
    expect(cp.authToken).toBe('secret-token');

    for (const svc of ['playground', 'registry-a', 'registry-b'] as const) {
      const cfg = getIntegrationConfig(svc);
      expect(cfg.authHeaderName).toBe('x-api-key');
      expect(cfg.authToken).toBe('pg-key');
      expect(isPlaygroundBacked(svc)).toBe(true);
    }
    expect(isPlaygroundBacked('control-plane')).toBe(false);
  });

  it('the read credential uses CONTROL_PLANE_READ_API_KEY and never falls back to the admin key', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    expect(getIntegrationConfig('control-plane', 'read').authToken).toBe('read-key');
    expect(getIntegrationConfig('control-plane', 'admin').authToken).toBe('admin-key');
    expect(getIntegrationConfig('control-plane').authToken).toBe('admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', '');
    expect(getIntegrationConfig('control-plane', 'read').authToken).toBe('');
  });

  it('registries resolve to the playground passthrough, not a registry base URL', () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'https://pg.example.com/');
    vi.stubEnv('REGISTRY_A_BASE_URL', 'https://ignored.example.com');
    expect(getIntegrationConfig('registry-a').baseUrl).toBe('https://pg.example.com/registries/a');
    expect(getIntegrationConfig('registry-b').baseUrl).toBe('https://pg.example.com/registries/b');
  });

  it('defaults the control-plane token to empty string when unset', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', '');
    expect(getIntegrationConfig('control-plane').authToken).toBe('');
  });

  it('prefers the env override over the localhost fallback', () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'https://pg.example.com');
    expect(getIntegrationConfig('playground').baseUrl).toBe('https://pg.example.com');
  });

  it('falls back to localhost defaults outside production', () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', '');
    expect(getIntegrationConfig('registry-a').baseUrl).toBe('http://localhost:8000/registries/a');
  });
});

describe('buildUpstreamUrl', () => {
  it('joins base + path and appends the search string', () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
    expect(buildUpstreamUrl('control-plane', '/runs', '?limit=10')).toBe(
      'http://localhost:3001/runs?limit=10',
    );
  });

  it('strips a trailing slash on the base url', () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001/');
    expect(buildUpstreamUrl('control-plane', '/runs')).toBe('http://localhost:3001/runs');
  });

  it('adds a leading slash to a relative path', () => {
    vi.stubEnv('CONTROL_PLANE_BASE_URL', 'http://localhost:3001');
    expect(buildUpstreamUrl('control-plane', 'runs')).toBe('http://localhost:3001/runs');
  });

  it('omits search when none is given', () => {
    vi.stubEnv('PLAYGROUND_BASE_URL', 'http://localhost:8000');
    expect(buildUpstreamUrl('registry-b', '/contexts/search')).toBe(
      'http://localhost:8000/registries/b/contexts/search',
    );
  });
});

describe('upstreamAuthHeaders', () => {
  it('control plane: bearer for the chosen credential, no playground headers', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'admin-key');
    vi.stubEnv('CONTROL_PLANE_READ_API_KEY', 'read-key');
    expect(upstreamAuthHeaders('control-plane', { clientIp: '203.0.113.7' })).toEqual({
      authorization: 'Bearer admin-key',
    });
    expect(upstreamAuthHeaders('control-plane', { credential: 'read' })).toEqual({
      authorization: 'Bearer read-key',
    });
  });

  it('control plane: no authorization header when the key is empty', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', '');
    expect(upstreamAuthHeaders('control-plane')).toEqual({});
  });

  it('playground family: key plus one client IP literal, never an authorization header', () => {
    vi.stubEnv('PLAYGROUND_API_KEY', 'pg-key');
    for (const svc of ['playground', 'registry-a', 'registry-b'] as const) {
      expect(upstreamAuthHeaders(svc, { clientIp: '2001:db8::1' })).toEqual({
        'x-api-key': 'pg-key',
        'x-acdp-client-ip': '2001:db8::1',
      });
    }
  });

  it('playground family: no key header when PLAYGROUND_API_KEY is unset, no IP for the unknown bucket', () => {
    vi.stubEnv('PLAYGROUND_API_KEY', '');
    expect(upstreamAuthHeaders('playground', { clientIp: 'unknown' })).toEqual({});
    expect(upstreamAuthHeaders('playground', { clientIp: 'not-an-ip' })).toEqual({});
    expect(upstreamAuthHeaders('playground')).toEqual({});
  });
});

describe('production hardening', () => {
  it('no longer requires REGISTRY_A/B_BASE_URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYGROUND_BASE_URL', 'https://pg.example.com');
    vi.stubEnv('REGISTRY_A_BASE_URL', '');
    vi.stubEnv('REGISTRY_B_BASE_URL', '');
    vi.resetModules();
    const mod = await import('@/lib/server/integrations');
    expect(mod.getIntegrationConfig('registry-a').baseUrl).toBe('https://pg.example.com/registries/a');
  });

  it('throws rather than silently falling back when an upstream url is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYGROUND_BASE_URL', '');
    vi.resetModules();
    const mod = await import('@/lib/server/integrations');
    expect(() => mod.getIntegrationConfig('playground')).toThrow(/PLAYGROUND_BASE_URL is required/);
  });
});
