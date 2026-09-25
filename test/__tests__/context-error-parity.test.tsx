// ══════════════════════════════════════════════════════════════════════
// The two surfaces that report a failed context fetch must say the same thing.
//
// `app/contexts/page.tsx` and `components/runs/context-inspector.tsx` each held
// their own copy of the same two string literals and their own copy of the
// `errorCode` test. That is how they came to render the `CONTEXT_ID_MISMATCH`
// sentence for `CONTEXT_BINDING_UNVERIFIABLE` in both places at once — and it
// is how a fix applied to one would have silently left the other lying. Unit
// tests over the map cannot catch that: the map can be perfect while a call
// site ignores it.
//
// So this asserts the RENDERED text of both surfaces, for the same input,
// against each other and against the map.
//
// NOTE ON WHAT THIS FILE DOES NOT COVER. Every expectation here is computed as
// `contextErrorMessage(error)`, so this suite guards WIRING — that both call
// sites read the map and neither re-implements it — and never guards COPY.
// Changing or deleting a message leaves every test in this file green. Copy
// correctness lives in `api-error-messages.test.ts`, which asserts the strings
// against `acdp-control-plane/src/errors/error-codes.ts`. The two files are
// complementary on purpose; neither is sufficient alone.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import { contextErrorMessage } from '@/lib/utils/api-error-messages';

const searchContexts = vi.fn();
const getContext = vi.fn();
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  searchContexts: (...a: unknown[]) => searchContexts(...a),
  getContext: (...a: unknown[]) => getContext(...a),
}));

// The success case below renders a real `ContextDetail`, whose `useContextVerdicts`
// tries to initialise acdp-wasm. Under jsdom that fails and the hook sets
// `verdicts.error` ASYNCHRONOUSLY, which paints a banner this file's assertions
// would then race — the kind of flake that fails a handful of CI runs in ten and
// looks like an unrelated regression. Stubbed to a settled, error-free state, the
// same way `context-detail-verdicts.test.tsx` does it; nothing here is about
// verification verdicts.
vi.mock('@/lib/verify/use-verdicts', () => ({
  useContextVerdicts: () => ({ verdicts: {}, didDocs: {}, error: null, ready: true }),
}));

import ContextsPage from '@/app/contexts/page';
import { ContextInspector } from '@/components/runs/context-inspector';

const CTX_ID = 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function provider(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Open `/contexts`'s detail modal on a hit whose body fetch rejects. */
async function renderPageModal(error: unknown): Promise<HTMLElement> {
  searchContexts.mockResolvedValue({
    matches: [
      {
        ctx_id: CTX_ID,
        lineage_id: 'lin-1',
        agent_id: 'did:web:registry-a.playground.local:agents:solo',
        title: 'A context',
        type: 'analysis',
        created_at: '2026-05-28T00:00:00.000Z',
        status: 'active',
      },
    ],
    total_estimate: 1,
  });
  getContext.mockRejectedValue(error);
  const { container } = provider(<ContextsPage />);
  fireEvent.click(await screen.findByText('A context'));
  // The modal renders into the same container, and shows "Loading…" until the
  // query settles — so wait for the message itself, not for the dialog.
  await waitFor(() => expect(container.textContent).toContain(contextErrorMessage(error)));
  return container;
}

async function renderInspector(error: unknown): Promise<HTMLElement> {
  getContext.mockRejectedValue(error);
  const { container } = provider(<ContextInspector ctxId={CTX_ID} />);
  await waitFor(() => expect(container.textContent).toContain(contextErrorMessage(error)));
  return container;
}

/** Scope an assertion to the detail modal, not the whole page behind it. */
function modal(container: HTMLElement): HTMLElement {
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('detail modal is not open');
  return dialog;
}

/**
 * Only `EmptyState` gets a structural probe, and deliberately so.
 *
 * `.empty-state` is this app's own class and `ContextDetail` renders nothing
 * like it, so the probe is unambiguous. There is no matching probe for
 * `ErrorPanel`: every structural handle for it is shared with something else —
 * its danger icon also appears inside a successfully-rendered `ContextDetail`,
 * and `role="alert"` is already carried by two of that component's own banners
 * (`components/contexts/context-detail.tsx`). Adding a dedicated marker to
 * `ErrorPanel` just to be queryable here would be a shared component changed
 * for a test's convenience.
 *
 * The error branch is therefore asserted on its TEXT, which is the thing under
 * test anyway: an ErrorPanel that should not be there renders a message, and
 * `contextErrorMessage` cannot return blank for any input.
 */
const hasEmptyState = (el: HTMLElement) => !!el.querySelector('.empty-state');

function apiError(status: number, body: unknown): ApiError {
  return new ApiError(status, typeof body === 'string' ? body : JSON.stringify(body), 'control-plane', '/contexts/x');
}

beforeEach(() => {
  searchContexts.mockReset();
  getContext.mockReset();
});

afterEach(cleanup);

describe('CRITERION 5: /contexts and the run inspector render the same message', () => {
  const cases: Array<[string, unknown]> = [
    ['CONTEXT_ID_MISMATCH', apiError(502, { errorCode: 'CONTEXT_ID_MISMATCH' })],
    ['CONTEXT_BINDING_UNVERIFIABLE', apiError(502, { errorCode: 'CONTEXT_BINDING_UNVERIFIABLE' })],
    ['FEDERATION_UPSTREAM_RATE_LIMITED', apiError(503, { errorCode: 'FEDERATION_UPSTREAM_RATE_LIMITED' })],
    ['an unknown code', apiError(502, { errorCode: 'NEVER_SEEN_BEFORE' })],
    ['no code at all', apiError(502, '<html>502</html>')],
    ['a 404', apiError(404, { errorCode: 'CONTEXT_NOT_FOUND' })],
  ];

  for (const [label, error] of cases) {
    it(`${label}: both surfaces render the map's string, verbatim`, async () => {
      const expected = contextErrorMessage(error);

      const inspector = await renderInspector(error);
      expect(inspector.textContent).toContain(expected);
      cleanup();

      const page = await renderPageModal(error);
      expect(page.textContent).toContain(expected);
    });
  }

  it('DISCRIMINATES: the mismatch text does NOT appear for the unverifiable code', async () => {
    // The whole point, stated as an end-to-end render rather than a map lookup:
    // if either call site went back to its own boolean, this fails.
    const unverifiable = apiError(502, { errorCode: 'CONTEXT_BINDING_UNVERIFIABLE' });
    const mismatchText = contextErrorMessage(apiError(502, { errorCode: 'CONTEXT_ID_MISMATCH' }));

    const inspector = await renderInspector(unverifiable);
    expect(inspector.textContent).not.toContain(mismatchText);
    cleanup();

    const page = await renderPageModal(unverifiable);
    expect(page.textContent).not.toContain(mismatchText);
  });

  it("a 404 keeps /contexts' not-found affordance while saying the same words", async () => {
    // The one deliberate divergence, and it is presentational: an index/store
    // disagreement is not a failure, so the page shows the neutral EmptyState
    // rather than a red panel. The DESCRIPTION is still the map's, which is
    // what stops the two surfaces from drifting on what a 404 means — plus a
    // lead clause only this page can say, since the operator arrived here by
    // clicking a search hit.
    const notFound = apiError(404, { errorCode: 'CONTEXT_NOT_FOUND' });
    const page = await renderPageModal(notFound);
    const dialog = modal(page);
    expect(dialog.textContent).toContain('No context body available');
    // The JOINED string, not its two halves. Asserting each half with
    // `toContain` passes just as happily on "…lists this context.No context
    // body was returned…", which is what a dropped separator produces.
    expect(dialog.textContent).toContain(
      `The registry index lists this context. ${contextErrorMessage(notFound)}`,
    );
    expect(dialog.textContent).not.toContain('Could not load context.');
  });

  // ── The branches are mutually exclusive, and that has to be asserted ────
  //
  // The spec's own edge case: "a 404 must keep its existing not-found handling
  // (`ApiError.isNotFound`) and not be absorbed." Asserting only that the
  // EmptyState is PRESENT misses the opposite failure — dropping the
  // `!bodyUnavailable` guard renders the neutral empty state AND a red error
  // panel carrying the same sentence, which a text-only assertion cannot see
  // because the duplicated panel says the map's words, not the generic ones.
  describe('the 404 and error branches never both render', () => {
    it('a 404 renders the EmptyState and NOTHING else about the failure', async () => {
      const notFound = apiError(404, { errorCode: 'CONTEXT_NOT_FOUND' });
      const page = await renderPageModal(notFound);
      const dialog = modal(page);
      expect(hasEmptyState(dialog)).toBe(true);
      // The error branch would say the same sentence, so "is it absent?" is
      // "is it said twice?" — see the occurrence count below, which is the
      // assertion that actually kills a dropped `!bodyUnavailable` guard.
      const text = dialog.textContent ?? '';
      expect(text.split(contextErrorMessage(notFound)).length - 1).toBe(1);
    });

    it('DISCRIMINATES: a binding failure renders the error panel and NO EmptyState', async () => {
      // The mirror. A registry serving a context nobody asked for must never
      // be softened into "there is nothing here" — the framing carries as much
      // signal as the sentence.
      const mismatch = apiError(502, { errorCode: 'CONTEXT_ID_MISMATCH' });
      const page = await renderPageModal(mismatch);
      const dialog = modal(page);
      expect(dialog.textContent).toContain(contextErrorMessage(mismatch));
      expect(hasEmptyState(dialog)).toBe(false);
    });

    it('the affordance keys on the STATUS, not on the error code', async () => {
      // `bodyUnavailable` is `ApiError.isNotFound`, deliberately: a 404 whose
      // body is an nginx page, or a registry envelope using its own snake_case
      // vocabulary, carries no `CONTEXT_NOT_FOUND` — and is still a not-found,
      // still not a failure, and still must not be reddened. Keying the
      // affordance off the code instead would look identical on every payload
      // the control plane emits and wrong on every other one.
      const bare = apiError(404, '<html>404 Not Found</html>');
      const page = await renderPageModal(bare);
      const dialog = modal(page);
      expect(hasEmptyState(dialog)).toBe(true);
      const text = dialog.textContent ?? '';
      expect(text.split(contextErrorMessage(bare)).length - 1).toBe(1);
    });

    it('a SUCCESSFUL fetch renders no error panel at all', async () => {
      // The third arm, and the one no test covered: both error branches hang
      // off `detail.error &&`, so losing that gate would redden every modal the
      // operator opens successfully. Every other assertion in this file feeds
      // the page a rejection and would stay green through it.
      const { MOCK_CONTEXTS } = await import('@/lib/data/mock-data');
      searchContexts.mockResolvedValue({
        matches: [
          {
            ctx_id: MOCK_CONTEXTS[0].body.ctx_id,
            lineage_id: MOCK_CONTEXTS[0].body.lineage_id,
            agent_id: MOCK_CONTEXTS[0].body.agent_id,
            title: 'A context',
            type: MOCK_CONTEXTS[0].body.type,
            created_at: MOCK_CONTEXTS[0].body.created_at,
            status: 'active',
          },
        ],
        total_estimate: 1,
      });
      getContext.mockResolvedValue(MOCK_CONTEXTS[0]);
      const { container } = provider(<ContextsPage />);
      fireEvent.click(await screen.findByText('A context'));
      await waitFor(() => expect(modal(container).textContent).not.toContain('Loading…'));

      const dialog = modal(container);
      expect(hasEmptyState(dialog)).toBe(false);
      // An un-gated ErrorPanel renders `contextErrorMessage(undefined)`, which
      // is exactly this string — so the absence of the sentence IS the absence
      // of the panel, with no structural probe needed.
      expect(dialog.textContent).not.toContain('Could not load context.');
      expect(dialog.textContent).toContain(MOCK_CONTEXTS[0].body.ctx_id);
    });

    it('the 404 sentence is rendered exactly once', async () => {
      // Belt to the braces above: a duplicated branch would say it twice.
      const notFound = apiError(404, { errorCode: 'CONTEXT_NOT_FOUND' });
      const page = await renderPageModal(notFound);
      const sentence = contextErrorMessage(notFound);
      const text = modal(page).textContent ?? '';
      expect(text.split(sentence).length - 1).toBe(1);
    });
  });

  // ── The inspector's framing ────────────────────────────────────────────
  //
  // The inspector has no EmptyState/ErrorPanel split to assert — it renders one
  // line — so its framing is carried entirely by the colour token. Untested,
  // that line could be dimmed to `C.muted` and a `CONTEXT_ID_MISMATCH` (the
  // loudest verdict the federation proxy can return) would render as a
  // throwaway grey note with every text assertion still green.
  describe('the run inspector renders its errors in the danger tone', () => {
    /**
     * The DEEPEST div carrying the text — `querySelectorAll` yields document
     * order, so every wrapping ancestor matches the text too and only the last
     * one is the styled line itself.
     */
    const errorLine = (el: HTMLElement) =>
      [...el.querySelectorAll<HTMLElement>('div')]
        .filter((d) => (d.textContent ?? '').includes('cannot be trusted'))
        .pop();

    it('a substitution claim is styled as danger, not as a muted aside', async () => {
      const inspector = await renderInspector(apiError(502, { errorCode: 'CONTEXT_ID_MISMATCH' }));
      const line = errorLine(inspector);
      expect(line).toBeDefined();
      expect(line!.style.color).toBe('var(--danger)');
    });
  });
});
