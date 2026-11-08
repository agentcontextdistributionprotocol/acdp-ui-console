import { useQuery } from '@tanstack/react-query';
import { getConsoleSession } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

/** Query-key prefix; invalidated on sign-in and sign-out. */
export const CONSOLE_SESSION_KEY = ['console-session'] as const;

/** The access mode and sign-in state the sidebar renders from. */
export function useConsoleSession() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  return useQuery({
    queryKey: [...CONSOLE_SESSION_KEY, demoMode],
    queryFn: () => getConsoleSession(demoMode),
    // Sign-in and sign-out invalidate it (the sidebar never remounts).
    staleTime: 0,
  });
}

/** True only for a public-mode visitor who is not signed in. */
export function isAnonymousVisitor(session: { publicMode: boolean; signedIn: boolean } | undefined): boolean {
  return session?.publicMode === true && session.signedIn === false;
}

/**
 * Whether operator-only sections may fetch and offer their controls.
 *
 * `anonymous` is true only for a signed-out public-mode visitor, whom the
 * console itself refuses on every admin route, so those sections render an
 * operator-only notice instead. `ready` is false until the session answer is
 * in: admin queries wait for it rather than firing a request that is certain
 * to be refused. A failed session read counts as ready and not anonymous, so
 * the section falls back to fetching and shows whatever the route answers.
 */
export function useOperatorAccess(): { ready: boolean; anonymous: boolean } {
  const session = useConsoleSession();
  const anonymous = isAnonymousVisitor(session.data);
  return { ready: session.isSuccess || session.isError, anonymous };
}
