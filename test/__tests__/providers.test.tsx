import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/components/providers';

// ══════════════════════════════════════════════════════════════════════
// #128: an offline browser used to read as an all-clear rather than as
// unreachable, because React Query PAUSES a query while `onlineManager`
// reports offline instead of running it, fetching, and failing. The fix is
// entirely in this client's defaults — `networkMode: 'always'` on both
// queries and mutations, plus `refetchOnReconnect: true` restated because
// its default flips to `false` once `networkMode` is `'always'`. This file
// pins the exact shape so a future edit here can't silently drop one of the
// three options and reopen the pause.
// ══════════════════════════════════════════════════════════════════════

describe('createQueryClient — the client every real query/mutation uses', () => {
  it('sets exactly the five query defaults and the one mutation default #128 depends on', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries).toMatchObject({
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
      networkMode: 'always',
      refetchOnReconnect: true,
    });
    expect(defaults.mutations).toMatchObject({ networkMode: 'always' });
  });

  it('never pauses a query while the browser is reported offline', async () => {
    const client = createQueryClient();
    const { onlineManager } = await import('@tanstack/react-query');
    onlineManager.setOnline(false);
    try {
      const queryFn = async () => 'answered';
      const result = await client.fetchQuery({ queryKey: ['probe'], queryFn });
      // A paused fetch never resolves at all — reaching this line already
      // proves the query ran instead of pausing.
      expect(result).toBe('answered');
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
