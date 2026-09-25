// ══════════════════════════════════════════════════════════════════════
// /contexts: what a zero-match render is allowed to claim.
//
// `acdp-registry-core` documents the short-page contract verbatim: a page
// consumed by the handler's visibility/tenant post-filters "can return FEWER
// than the requested `limit` rows while still emitting a non-`None`
// `next_cursor`. A short page is therefore NOT an end-of-results signal —
// clients MUST keep paging until `next_cursor` is `None`."
//
// The console violated that MUST twice over: it rendered "No contexts found",
// and it hid "Load more" inside `{matches.length > 0 && …}` — so the operator
// was told there were none AND given no way forward.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResponse } from '@/lib/types';

const searchContexts = vi.fn();
const getContext = vi.fn();
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  searchContexts: (...a: unknown[]) => searchContexts(...a),
  getContext: (...a: unknown[]) => getContext(...a),
}));

// Every modal this file opens is an error branch, so `ContextDetail` never
// mounts today — but the moment a case here resolves `getContext`, it would,
// and its `useContextVerdicts` would try to initialise acdp-wasm under jsdom,
// fail, and paint an error banner ASYNCHRONOUSLY into assertions already
// running. That race cost a CI-reddening flake once already (see
// `context-error-parity.test.tsx`); the mock is here so it cannot cost one
// again the next time this file grows a success case.
vi.mock('@/lib/verify/use-verdicts', () => ({
  useContextVerdicts: () => ({ verdicts: {}, didDocs: {}, error: null, ready: true }),
}));

import ContextsPage from '@/app/contexts/page';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContextsPage />
    </QueryClientProvider>,
  );
}

const empty = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  matches: [],
  total_estimate: 0,
  ...over,
});

/** Apply a facet value and re-run the search, as an operator would. */
function selectTypeAndSearch(type: string) {
  fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: type } });
  fireEvent.click(screen.getByText('Search'));
}

beforeEach(() => {
  searchContexts.mockReset();
  getContext.mockReset();
});

afterEach(cleanup);

describe('/contexts — a zero-match page with more pages behind it', () => {
  it('offers "Load more" and does NOT claim there are no contexts', async () => {
    searchContexts.mockResolvedValue(empty({ next_cursor: 'p2' }));
    renderPage();

    expect(await screen.findByText('No matches on this page')).toBeInTheDocument();
    expect(screen.getByText('Load more')).toBeInTheDocument();
    expect(screen.queryByText('No contexts found')).toBeNull();
  });

  it('DISCRIMINATES: an exhausted zero-match search keeps the flat empty state', async () => {
    // The paired mirror. Without it the fix could have been "always say there
    // might be more", which would make every genuinely empty search look
    // paginated — a different false claim, not a fix.
    searchContexts.mockResolvedValue(empty());
    renderPage();

    expect(await screen.findByText('No contexts found')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(screen.queryByText('No matches on this page')).toBeNull();
  });

  it('pressing "Load more" through short pages terminates at the last cursor', async () => {
    const cursors = ['p2', 'p3', undefined];
    let call = 0;
    searchContexts.mockImplementation(() => Promise.resolve(empty({ next_cursor: cursors[call++] })));
    renderPage();

    await screen.findByText('Load more');
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(searchContexts).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(searchContexts).toHaveBeenCalledTimes(3));

    // Third page carries no cursor: the button goes away and the copy is
    // finally allowed to assert absence.
    await waitFor(() => expect(screen.queryByText('Load more')).toBeNull());
    expect(screen.getByText('No contexts found')).toBeInTheDocument();
  });
});

describe('/contexts — a MERGED response is exempt from the flat empty state', () => {
  // `searchContexts` marks any client-side merge — the two RFC-ACDP-0014 §10
  // type spellings, `authority === 'all'`, or both — with `merged: true`, and
  // a merge carries no cursor by design. So a merged zero-match render can
  // never reach the `hasNextPage` branch above, and falling through to the flat
  // empty state would reinstate the registry's short-page MUST violation on
  // exactly the queries where several upstream result sets were each truncated.
  // The page reads the flag off the response rather than re-deriving the rule,
  // which is why these tests set it the way the client does.
  it('says "not the whole result set" rather than "no contexts found"', async () => {
    searchContexts.mockResolvedValue(empty());
    renderPage();
    await screen.findByText('No contexts found');

    searchContexts.mockResolvedValue(empty({ merged: true }));
    selectTypeAndSearch('key-revocation');

    expect(await screen.findByText('No matches in this view')).toBeInTheDocument();
    expect(screen.queryByText('No contexts found')).toBeNull();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('covers the federated search too, not just the revocation facet', async () => {
    // `authority === 'all'` has always merged and always suppressed its cursor,
    // so it had the identical defect. Keying the exemption on the facet name
    // would have left it there.
    searchContexts.mockResolvedValue(empty({ merged: true }));
    renderPage();
    expect(await screen.findByText('No matches in this view')).toBeInTheDocument();
    expect(screen.queryByText('No contexts found')).toBeNull();
  });

  it('DISCRIMINATES: an unmerged query restores the flat empty state', async () => {
    // The exemption is a property of the response, not sticky state.
    searchContexts.mockResolvedValue(empty({ merged: true }));
    renderPage();
    await screen.findByText('No matches in this view');

    searchContexts.mockResolvedValue(empty());
    selectTypeAndSearch('analysis');
    expect(await screen.findByText('No contexts found')).toBeInTheDocument();
    expect(screen.queryByText('No matches in this view')).toBeNull();
  });

  it('a NON-empty merged result still says it is not the whole result set', async () => {
    // The gap the zero-match exemption alone left open: with the cursor
    // suppressed and "Load more" gone, a full page of merged hits read as a
    // complete count. That is the same claim-without-looking in the one case
    // where results were actually found.
    searchContexts.mockResolvedValue({
      matches: [
        {
          ctx_id: 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lineage_id: 'lin-1',
          agent_id: 'did:web:registry-a.playground.local:agents:solo',
          title: 'A revocation',
          type: 'key-revocation',
          created_at: '2026-05-28T00:00:00.000Z',
          status: 'active',
        },
      ],
      total_estimate: 40,
      merged: true,
    });
    renderPage();

    expect(
      await screen.findByText(/merged view: first page of each query, not the whole result set/),
    ).toBeInTheDocument();
    // The upstream estimate survives the merge, so the "of ~N" hedge fires.
    expect(screen.getByText(/of ~40/)).toBeInTheDocument();
  });
});

describe('/contexts — the partial-results banner', () => {
  it('does not blame a registry, because `partial` no longer means a registry is down', async () => {
    // `partial` is set by a failure on EITHER fan-out axis, and the
    // type-spelling axis queries one registry twice — so the old copy ("One
    // registry did not respond") could accuse a registry that is perfectly
    // healthy. Pinned because every other copy decision in this phase is, and
    // an unpinned string is how the previous wording survived the change that
    // made it false.
    searchContexts.mockResolvedValue(empty({ partial: true, merged: true }));
    renderPage();
    const banner = await screen.findByText(/did not respond/);
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).not.toContain('registry');
  });

  it('DISCRIMINATES: no banner at all when nothing failed', async () => {
    searchContexts.mockResolvedValue(empty());
    renderPage();
    await screen.findByText('No contexts found');
    expect(screen.queryByText(/did not respond/)).toBeNull();
  });
});

describe('/contexts — a search hit whose body cannot be fetched', () => {
  it('renders an unavailable state instead of crashing the modal', async () => {
    // The demo dataset's synthetic interim-form revocation hit has no signed
    // body on purpose (adding one would need its crypto regenerated, and a
    // fabricated body would render failed verification chips for a fixture).
    // Opening it must therefore be a defined state, not an unhandled throw.
    const { ApiError } = await import('@/lib/api/fetcher');
    searchContexts.mockResolvedValue({
      matches: [
        {
          ctx_id: 'acdp://registry-a.playground.local/7e9b0c12-33a4-4d55-8e66-9f0a1b2c3d4e',
          lineage_id: 'lin-1',
          agent_id: 'did:web:registry-a.playground.local:agents:solo',
          title: 'Producer key revocation — interim type name',
          type: 'acdp:key-revocation',
          created_at: '2026-05-28T00:00:00.000Z',
          status: 'active',
        },
      ],
      total_estimate: 1,
    });
    getContext.mockRejectedValue(
      new ApiError(404, JSON.stringify({ errorCode: 'CONTEXT_NOT_FOUND' }), 'control-plane', '/contexts/x'),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Producer key revocation — interim type name'));

    expect(await screen.findByText('No context body available')).toBeInTheDocument();
    // Not the generic failure: nothing here failed verification, so inviting a
    // retry would be misleading.
    expect(screen.queryByText('Could not load context.')).toBeNull();
  });

  it('DISCRIMINATES: a real transport failure still reads as a failure', async () => {
    searchContexts.mockResolvedValue({
      matches: [
        {
          ctx_id: 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lineage_id: 'lin-2',
          agent_id: 'did:web:registry-a.playground.local:agents:solo',
          title: 'Some context',
          type: 'analysis',
          created_at: '2026-05-28T00:00:00.000Z',
          status: 'active',
        },
      ],
      total_estimate: 1,
    });
    getContext.mockRejectedValue(new Error('network down'));
    renderPage();

    fireEvent.click(await screen.findByText('Some context'));

    expect(await screen.findByText('Could not load context.')).toBeInTheDocument();
    expect(screen.queryByText('No context body available')).toBeNull();
  });
});
