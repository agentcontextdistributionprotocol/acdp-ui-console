import { describe, expect, it } from 'vitest';
import { LOGIN_ROUTE, PUBLIC_ROUTES, isPublicRoute } from '@/lib/routes';

describe('isPublicRoute', () => {
  it('treats the login route and its subtree as public', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/login/')).toBe(true);
    expect(isPublicRoute('/login/reset')).toBe(true);
  });

  it('does not treat a merely-prefixed path as public', () => {
    // Exact-or-subtree, not a bare startsWith: `/login-help` is a real page.
    expect(isPublicRoute('/login-help')).toBe(false);
  });

  it('treats every other page as non-public', () => {
    expect(isPublicRoute('/dashboard')).toBe(false);
    expect(isPublicRoute('/loginx')).toBe(false);
    expect(isPublicRoute('')).toBe(false);
  });

  it('LOGIN_ROUTE is the only public route today', () => {
    expect(PUBLIC_ROUTES).toEqual([LOGIN_ROUTE]);
  });
});
