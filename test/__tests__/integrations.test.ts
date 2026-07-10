import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUpstreamUrl,
  getIntegrationConfig,
  isProxyService,
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
  it('only the control-plane carries a server-side bearer token', () => {
    vi.stubEnv('CONTROL_PLANE_API_KEY', 'secret-token');
    const cp = getIntegrationConfig('control-plane');
    expect(cp.authHeaderName).toBe('authorization');
    expect(cp.authToken).toBe('secret-token');

    for (const reg of ['registry-a', 'registry-b'] as const) {
      const cfg = getIntegrationConfig(reg);
      expect(cfg.authHeaderName).toBeUndefined();
      expect(cfg.authToken).toBeUndefined();
    }
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
    vi.stubEnv('REGISTRY_A_BASE_URL', '');
    expect(getIntegrationConfig('registry-a').baseUrl).toBe('http://localhost:8100');
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
    vi.stubEnv('REGISTRY_B_BASE_URL', 'http://localhost:8200');
    expect(buildUpstreamUrl('registry-b', '/contexts/search')).toBe(
      'http://localhost:8200/contexts/search',
    );
  });
});

describe('production hardening', () => {
  it('throws rather than silently falling back when an upstream url is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYGROUND_BASE_URL', '');
    vi.resetModules();
    const mod = await import('@/lib/server/integrations');
    expect(() => mod.getIntegrationConfig('playground')).toThrow(/PLAYGROUND_BASE_URL is required/);
  });
});
