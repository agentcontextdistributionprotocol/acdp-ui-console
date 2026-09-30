// The single statement of which pages are public — no operator session is
// expected on them, so the topbar's health pills don't probe and a 401
// doesn't bounce the browser back to itself. Dependency-free so
// middleware.ts (edge runtime) could import it too, though nothing does yet.
export const LOGIN_ROUTE = '/login';
export const PUBLIC_ROUTES = [LOGIN_ROUTE] as const;

// Exact-or-subtree, not a bare startsWith: `/login-help` is a real page and
// must not be silently treated as public.
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
