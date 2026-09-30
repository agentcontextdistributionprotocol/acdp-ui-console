'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

// Exported so tests build the exact same client the app runs, rather than a
// hand-rolled stand-in that could drift from these defaults.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: 1,
        // Without this option, React Query PAUSES a query while the browser
        // is reported offline instead of running it, fetching, and failing —
        // so every error branch below (`ErrorPanel`, `operatorErrorMessage`)
        // goes unreachable and the UI is stuck on its loading/empty state
        // instead of an honest error. `'always'` makes `canFetch` true
        // regardless of `onlineManager` and short-circuits that pause: the
        // fetch runs, throws, and the existing error branch renders.
        networkMode: 'always',
        // `refetchOnReconnect`'s default becomes `false` once the option
        // above is `'always'` (it exists to un-pause a paused query, and
        // nothing here pauses) — without restating it explicitly,
        // `/security`, enrollments, and webhooks would sit on a stale error
        // after the network actually comes back, instead of retrying.
        refetchOnReconnect: true,
      },
      mutations: {
        // The query-side option above does not reach mutations — a paused
        // mutation never settles (`isPending` forever), which is why
        // "Acknowledging…" and the enrollment actions would hang
        // indefinitely offline without restating it here.
        networkMode: 'always',
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
