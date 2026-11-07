import { describe, expect, it } from 'vitest';
import { getClientIp, upstreamClientIp, UNKNOWN_CLIENT_IP } from '@/lib/server/client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('getClientIp — on Vercel (VERCEL=1)', () => {
  const env = { VERCEL: '1' };

  it('prefers x-real-ip', () => {
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1, 203.0.113.6' }), env)).toBe('203.0.113.5');
  });

  it('then the first x-vercel-forwarded-for entry', () => {
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' }), env)).toBe('203.0.113.7');
  });

  it('then the RIGHTMOST x-forwarded-for entry, never the client-controlled leftmost', () => {
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.8' }), env)).toBe('203.0.113.8');
  });

  it('skips a malformed x-real-ip rather than trusting it', () => {
    expect(getClientIp(h({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': '203.0.113.9' }), env)).toBe('203.0.113.9');
  });

  it('accepts IPv6 and strips a zone index', () => {
    expect(getClientIp(h({ 'x-real-ip': '2001:db8::1' }), env)).toBe('2001:db8::1');
    expect(getClientIp(h({ 'x-real-ip': 'fe80::1%eth0' }), env)).toBe('fe80::1');
  });

  it('is unknown with no usable header', () => {
    expect(getClientIp(h({}), env)).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(h({ 'x-forwarded-for': 'garbage' }), env)).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe('getClientIp — off Vercel', () => {
  it('trusts nothing when no header is named (fails closed to one shared bucket)', () => {
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.6' }), {})).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.5' }), { VERCEL: '0' })).toBe(UNKNOWN_CLIENT_IP);
  });

  it('trusts only the operator-named header, rightmost entry', () => {
    const env = { ACDP_UI_CLIENT_IP_HEADER: 'X-Forwarded-For' };
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.10', 'x-real-ip': '1.2.3.4' }), env)).toBe('203.0.113.10');
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.11' }), { ACDP_UI_CLIENT_IP_HEADER: 'x-real-ip' })).toBe('203.0.113.11');
  });

  it('is unknown when the named header is absent or malformed', () => {
    const env = { ACDP_UI_CLIENT_IP_HEADER: 'x-real-ip' };
    expect(getClientIp(h({}), env)).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(h({ 'x-real-ip': '999.1.1.1' }), env)).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe('upstreamClientIp', () => {
  it('sends nothing for the unknown bucket or a non-literal', () => {
    expect(upstreamClientIp(UNKNOWN_CLIENT_IP)).toBeUndefined();
    expect(upstreamClientIp('1.2.3.4, 5.6.7.8')).toBeUndefined();
    expect(upstreamClientIp('')).toBeUndefined();
  });

  it('sends one literal', () => {
    expect(upstreamClientIp('203.0.113.5')).toBe('203.0.113.5');
    expect(upstreamClientIp(' 2001:db8::2 ')).toBe('2001:db8::2');
  });
});
