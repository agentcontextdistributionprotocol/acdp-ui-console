import { describe, expect, it } from 'vitest';
import { ALLOWED_ROUTES, matchRoute } from '@/lib/server/proxy-allowlist';
import type { ProxyService } from '@/lib/types';

const ADMIN = [
  ['GET', '/^\\/registries\\/enrollments$/'],
  ['POST', '/^\\/registries\\/enroll$/'],
  ['POST', '/^\\/registries\\/[^/]+\\/log-witness\\/ack$/'],
  ['GET', '/^\\/webhooks$/'],
  ['POST', '/^\\/webhooks$/'],
  ['PATCH', '/^\\/webhooks\\/[^/]+$/'],
  ['DELETE', '/^\\/webhooks\\/[^/]+$/'],
  ['GET', '/^\\/metrics$/'],
  ['GET', '/^\\/auth\\/revocations$/'],
];

describe('proxy allow-list access classes', () => {
  it('every entry declares access and limit explicitly', () => {
    for (const routes of Object.values(ALLOWED_ROUTES)) {
      for (const r of routes) {
        expect(['public', 'admin']).toContain(r.access);
        expect(['read', 'launch']).toContain(r.limit);
      }
    }
  });

  it('the admin set is exactly the nine control-plane pairs', () => {
    const admin = (Object.entries(ALLOWED_ROUTES) as [ProxyService, typeof ALLOWED_ROUTES.playground][]).flatMap(
      ([service, routes]) => routes.filter((r) => r.access === 'admin').map((r) => [service, r.method, String(r.pattern)]),
    );
    expect(admin.every(([service]) => service === 'control-plane')).toBe(true);
    expect(admin.map(([, m, p]) => [m, p]).sort()).toEqual([...ADMIN].sort());
  });

  it('only playground POST /runs spends a launch token', () => {
    const launch = Object.entries(ALLOWED_ROUTES).flatMap(([service, routes]) =>
      routes.filter((r) => r.limit === 'launch').map((r) => `${service} ${r.method} ${String(r.pattern)}`),
    );
    expect(launch).toEqual(['playground POST /^\\/runs$/']);
  });

  it('matchRoute is method- and path-exact', () => {
    expect(matchRoute('control-plane', 'GET', '/runs')?.access).toBe('public');
    expect(matchRoute('control-plane', 'GET', '/registries/enrollments')?.access).toBe('admin');
    expect(matchRoute('control-plane', 'POST', '/registries/a.example/log-witness/ack')?.access).toBe('admin');
    expect(matchRoute('control-plane', 'GET', '/registries/a.example/log-witness')?.access).toBe('public');
    expect(matchRoute('control-plane', 'POST', '/runs')).toBeUndefined();
    expect(matchRoute('registry-a', 'GET', '/admin')).toBeUndefined();
  });
});
