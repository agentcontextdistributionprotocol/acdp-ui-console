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
