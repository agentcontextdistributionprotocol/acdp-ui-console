// ══════════════════════════════════════════════════════════════════════
// No page in this console renders a raw upstream response body as its primary
// text.
//
// Eleven surfaces passed `String(error)` straight into `ErrorPanel`, so an
// operator whose control plane answered 502 read
// `ApiError: {"error":{"code":"schema_violation","message":"column \"foo\" does
// not exist"}}` where a sentence belonged. Two more were the same over-claim
// wearing different clothes: `/runs/[runId]` said `Run not found: <id>` for
// EVERY error — a 503, a console-minted 401, a network `TypeError` — and
// `/contexts` had simply been missed when its two sibling surfaces adopted
// `contextErrorMessage`.
//
// WHAT THIS FILE GUARDS, AND WHAT IT DOES NOT. Every assertion here is over
// RENDERED page output with the client boundary rejected, so this is a WIRING
// suite: that each surface reads the shared module, passes its own lead, and
// routes the raw bytes into the disclosure rather than the sentence. The COPY
// itself — whether the 401 clause is true, whether the registry code strings
// match `error.rs` — is asserted in `api-error-messages.test.ts`, against
// upstream's own source. Neither file is sufficient alone; this is the same
// split `context-error-parity.test.tsx` documents for its own pair.
//
// NOT a repo-wide `String(` grep. Six sites in `components/` are outstanding in
// later phases of this same issue, so a repo-wide assertion would fail here by
// construction and would have to be commented out — which is how such a guard
// ends up permanently disabled. It lands with the last of them.
// ══════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Suspense } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import { contextErrorMessage, REGISTRY_ERROR_CODES } from '@/lib/utils/api-error-messages';
import type { ProxyService } from '@/lib/types';

const listAgents = vi.fn();
const listCpEvents = vi.fn();
const listRegistries = vi.fn();
const getRegistryCapabilities = vi.fn();
const listEnrollments = vi.fn();
const listCpRuns = vi.fn();
const getCpRun = vi.fn();
const listScenarios = vi.fn();
const getCpDashboard = vi.fn();
const getCpMetrics = vi.fn();
const getLineage = vi.fn();
const getRunLineageGraph = vi.fn();
const searchContexts = vi.fn();
const getContext = vi.fn();

vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  listAgents: (...a: unknown[]) => listAgents(...a),
  listCpEvents: (...a: unknown[]) => listCpEvents(...a),
  listRegistries: (...a: unknown[]) => listRegistries(...a),
  getRegistryCapabilities: (...a: unknown[]) => getRegistryCapabilities(...a),
  listEnrollments: (...a: unknown[]) => listEnrollments(...a),
  listCpRuns: (...a: unknown[]) => listCpRuns(...a),
  getCpRun: (...a: unknown[]) => getCpRun(...a),
  listScenarios: (...a: unknown[]) => listScenarios(...a),
  getCpDashboard: (...a: unknown[]) => getCpDashboard(...a),
  getCpMetrics: (...a: unknown[]) => getCpMetrics(...a),
  getLineage: (...a: unknown[]) => getLineage(...a),
  getRunLineageGraph: (...a: unknown[]) => getRunLineageGraph(...a),
  searchContexts: (...a: unknown[]) => searchContexts(...a),
  getContext: (...a: unknown[]) => getContext(...a),
}));

// NO hook-level mocks. Every page below goes through its real hook and fails at
// the client function, including `/trust` (whose `useTrust` raises from the two
// outer `Promise.all([getCpDashboard, listCpRuns])` calls — the per-run fan-out
// runs through `Promise.allSettled` instead (#115) and counts a rejection as a
// `readFailures` disclosure rather than raising, so it can never be this test's
// subject) and `/dashboard`. An earlier
// cut mocked both hooks and justified `/dashboard`'s by saying the compound
// no-error-no-data state was unreachable from a resolving `queryFn`; the
// premise is true (React Query refuses `undefined` as query data) but the
// conclusion is not — a query client with `enabled: false` reaches exactly that
// state through the real hook, which is what `disabledMount` below does.

// `/scenarios` mounts `LaunchModal`, which calls `useRouter` unconditionally —
// and Next's app router throws rather than returning null when it is not
// mounted. Nothing here navigates.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// `/contexts`'s success path mounts a real `ContextDetail`, whose verdict hook
// initialises acdp-wasm and fails ASYNCHRONOUSLY under jsdom — a banner that
// would race these assertions. Settled here exactly as
// `context-error-parity.test.tsx` settles it; nothing in this file is about
// verification verdicts.
vi.mock('@/lib/verify/use-verdicts', () => ({
  useContextVerdicts: () => ({ verdicts: {}, didDocs: {}, error: null, ready: true }),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import AgentsPage from '@/app/agents/page';
import ContextsPage from '@/app/contexts/page';
import DashboardPage from '@/app/dashboard/page';
import EventsPage from '@/app/events/page';
import LineagePage from '@/app/lineage/page';
import ObservabilityPage from '@/app/observability/page';
import RegistriesPage from '@/app/registries/page';
import RunsPage from '@/app/runs/page';
import RunDetailPage from '@/app/runs/[runId]/page';
import ScenariosPage from '@/app/scenarios/page';
import TrustPage from '@/app/trust/page';
import { MetricsPanel } from '@/components/observability/metrics-panel';

// A body that is JSON, carries a real upstream code, and is unmistakable if it
// ever reaches the sentence. `schema_violation` is deliberately a code NO map
// in this repo holds — so every surface below falls through to the status arms
// and the leads are what is actually under test. The two registry-code cases
// opt in explicitly.
const RAW = '{"error":{"code":"schema_violation","message":"column \\"foo\\" does not exist"}}';

function apiError(
  status = 502,
  body = RAW,
  service: ProxyService = 'control-plane',
  path = '/runs',
): ApiError {
  return new ApiError(status, body, service, path, true);
}

// `retryDelay: 0` as well as `retry: false`: a per-query `retry` beats the
// client default, and `useTrust` sets `retry: 1` (`use-trust.ts:130`). Without
// this the retry waits out React Query's ~1s backoff and every `waitFor` on
// `/trust` times out in the loading state — a failure that looks like the page
// not rendering the error at all.
function mount(node: React.ReactNode): RenderResult {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/**
 * Mount with every query disabled.
 *
 * This is how the compound `error || !data` branches reach their no-error-
 * no-data half through the REAL hook: a disabled query settles at
 * `{ status: 'pending', fetchStatus: 'idle', isLoading: false, data: undefined,
 * error: null }`, which is precisely that state. It cannot be reached by
 * resolving a `queryFn` with `undefined` — React Query rejects that as an error
 * ("Query data cannot be undefined"), which is the OTHER half of the branch.
 */
function disabledMount(node: React.ReactNode): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, enabled: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/**
 * Split a rendered page into "what the operator reads" and "what is folded away
 * in the disclosure".
 *
 * Detaching the `<details>` and then reading the rest is what makes the pairs in
 * criterion 7 meaningful: `expect(textContent).not.toContain(RAW)` over the
 * whole page would fail on a CORRECT render, because the bytes are supposed to
 * still be there — just not in the sentence. Asserting the two halves
 * separately is the only way to say "demoted" rather than "deleted".
 */
function readPanel(container: HTMLElement): { primary: string; diagnostic: string } {
  const det = container.querySelector('details.error-detail');
  const diagnostic = det?.textContent ?? '';
  det?.remove();
  return { primary: container.textContent ?? '', diagnostic };
}

/** One run with lineage, so `/lineage`'s run picker has something selected. */
function runRow() {
  return {
    runId: 'run-1',
    scenarioId: 'sc-1',
    status: 'completed',
    contextsCount: 3,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
  };
}

beforeEach(() => {
  // Every surface's NON-subject queries resolve, so a failure below is always
  // the query the test is about.
  listCpEvents.mockResolvedValue({ data: [], nextCursor: null, total: 0 });
  listScenarios.mockResolvedValue([]);
  listCpRuns.mockResolvedValue({ data: [runRow()], nextCursor: null, total: 1 });
  // `null`, not `undefined`: React Query rejects `undefined` as query data.
  getRegistryCapabilities.mockResolvedValue(null);
  listEnrollments.mockResolvedValue([]);
  // The real `SearchResponse` shape — `{ matches, total_estimate }`, not
  // `{ data, total }`. Both `/contexts` tests override it with a rejection, so a
  // wrong shape here would never be noticed; it is correct so that a test added
  // later inherits a fixture that is not quietly a lie.
  searchContexts.mockResolvedValue({ matches: [], total_estimate: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── The ten plain query surfaces ──────────────────────────────────────

/**
 * Each entry is the surface's client boundary and the lead it owns. Table-driven
 * because the assertion is identical for all ten and the leads are the only
 * thing that varies — writing ten near-copies would hide which one is wrong.
 */
const SURFACES: { name: string; lead: string; mount: () => Promise<void> }[] = [
  {
    name: '/agents',
    lead: 'Could not load the agent inventory',
    mount: async () => {
      listAgents.mockRejectedValue(apiError());
      mount(<AgentsPage />);
    },
  },
  {
    name: '/dashboard',
    lead: 'Could not load the dashboard',
    mount: async () => {
      getCpDashboard.mockRejectedValue(apiError());
      mount(<DashboardPage />);
    },
  },
  {
    name: '/events',
    lead: 'Could not load the event history',
    mount: async () => {
      listCpEvents.mockRejectedValue(apiError());
      mount(<EventsPage />);
    },
  },
  {
    name: '/lineage (run DAG)',
    lead: "Could not load this run's lineage graph",
    mount: async () => {
      getRunLineageGraph.mockRejectedValue(apiError());
      mount(<LineagePage />);
    },
  },
  {
    name: '/lineage (chain lookup)',
    lead: 'Could not resolve this lineage_id',
    mount: async () => {
      getLineage.mockRejectedValue(apiError(502, RAW, 'registry-a', '/lineages/lin-1'));
      mount(<LineagePage />);
      fireEvent.click(screen.getByRole('button', { name: 'By lineage_id' }));
      fireEvent.change(screen.getByPlaceholderText(/lineage_id/), { target: { value: 'lin-1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    },
  },
  {
    // #128: `ByRun` used to destructure only `data`/`isLoading` from
    // `useRuns({})`, so a failed runs fetch rendered "No runs with lineage
    // yet" — a false all-clear indistinguishable from the genuinely-empty
    // case. The run picker and DAG panel both need at least one run before
    // either can render, so this is the one `/lineage` surface reachable
    // with no other mock set up first.
    name: '/lineage (runs list)',
    lead: 'Could not load runs',
    mount: async () => {
      listCpRuns.mockRejectedValue(apiError());
      mount(<LineagePage />);
    },
  },
  {
    // #140: the Traces card used to destructure only `data` from `useRuns({})`,
    // so a failed fetch silently rendered zero rows in its recent-runs list
    // instead of the trio every other listed surface uses.
    name: '/observability',
    lead: 'Could not load recent runs',
    mount: async () => {
      listCpRuns.mockRejectedValue(apiError());
      // MetricsPanel renders unconditionally on the same page; give its query
      // something to resolve so a failure here is unambiguously the runs
      // fetch, not React Query's own "query data cannot be undefined" error
      // from an un-mocked getCpMetrics with no default implementation.
      getCpMetrics.mockResolvedValue([]);
      mount(<ObservabilityPage />);
    },
  },
  {
    name: '/registries',
    lead: 'Could not load the observed registries',
    mount: async () => {
      listRegistries.mockRejectedValue(apiError());
      mount(<RegistriesPage />);
    },
  },
  {
    name: '/runs',
    lead: 'Could not load the run list',
    mount: async () => {
      listCpRuns.mockRejectedValue(apiError());
      mount(<RunsPage />);
    },
  },
  {
    name: '/scenarios',
    lead: 'Could not load the scenario catalogue',
    mount: async () => {
      listScenarios.mockRejectedValue(apiError(502, RAW, 'playground', '/scenarios'));
      mount(<ScenariosPage />);
    },
  },
  {
    name: '/trust',
    lead: 'Could not load trust signals',
    mount: async () => {
      // `useTrust` raises from its two outer calls; this is one of them.
      getCpDashboard.mockRejectedValue(apiError());
      mount(<TrustPage />);
    },
  },
  {
    name: 'MetricsPanel',
    lead: 'Could not load control-plane metrics',
    mount: async () => {
      getCpMetrics.mockRejectedValue(apiError(502, RAW, 'control-plane', '/metrics'));
      mount(<MetricsPanel />);
    },
  },
];

describe('the swept surfaces render a sentence, not a response body', () => {
  it.each(SURFACES)('$name leads with its own copy', async ({ lead, mount: setup }) => {
    await setup();
    await screen.findByText('Technical detail');
    const { primary, diagnostic } = readPanel(document.body);

    // The pair. Both halves are required: the lead alone would pass on a render
    // that ALSO pasted the body after it, and the absence alone would pass on a
    // render that deleted the error entirely.
    expect(primary).toContain(lead);
    expect(primary).not.toContain('schema_violation');
    expect(primary).not.toContain('ApiError');

    // …and the bytes are demoted, not discarded.
    expect(diagnostic).toContain('schema_violation');
    // The bytes verbatim — escapes included, since `ApiError.body` is the raw
    // response text and not a re-serialisation of it.
    expect(diagnostic).toContain('column \\"foo\\" does not exist');
  });

  it('every lead in the table is distinct', () => {
    // A copy-paste that gave two surfaces the same lead would leave every
    // assertion above green while telling an operator the wrong thing about
    // which page failed.
    expect(new Set(SURFACES.map((s) => s.lead)).size).toBe(SURFACES.length);
  });
});

// ── The cause clause reaches the screen ───────────────────────────────

describe('the clause after the lead names who failed', () => {
  it('names the control plane and its server-side key on a 401', async () => {
    listCpRuns.mockRejectedValue(apiError(401, '', 'control-plane', '/runs'));
    mount(<RunsPage />);
    const el = await screen.findByText(/Could not load the run list/);
    expect(el.textContent).toContain("the control plane rejected this console's credentials");
    expect(el.textContent).toContain('CONTROL_PLANE_API_KEY');
  });

  it('does NOT accuse a registry of rejecting credentials it was never sent', async () => {
    // The registries take no credential from this console at all, so "registry A
    // rejected this console's credentials" would be false in both halves — the
    // exact over-claim this whole issue is about, committed by its own fix.
    listRegistries.mockRejectedValue(apiError(401, '', 'registry-a', '/registries'));
    mount(<RegistriesPage />);
    const el = await screen.findByText(/Could not load the observed registries/);
    expect(el.textContent).toContain('registry A requires credentials this console does not send');
    expect(el.textContent).not.toContain('rejected');
  });

  it('blames this console, not the upstream, for an UNSTAMPED failure', async () => {
    // No stamp means the bytes never crossed our own boundary — `middleware.ts`
    // minting a 401, or Next's 500 for an unset `*_BASE_URL`. Saying "the
    // control plane answered 401" there points the operator at a service that
    // was never reached.
    listCpRuns.mockRejectedValue(new ApiError(401, '', 'control-plane', '/runs', false));
    mount(<RunsPage />);
    const el = await screen.findByText(/Could not load the run list/);
    expect(el.textContent).toContain('This console could not complete the request');
    expect(el.textContent).not.toContain('the control plane');
  });

  it('renders the lead alone, with no disclosure, for a non-ApiError throw', async () => {
    // `parsePrometheus` throws its own `Error` AFTER a successful fetch
    // (`client.ts:488` goes through `fetchText`), so this arm is not
    // theoretical for this panel in particular. There are no upstream bytes to
    // disclose, so there must be no empty disclosure either.
    getCpMetrics.mockRejectedValue(new Error('unparseable exposition format'));
    const { container } = mount(<MetricsPanel />);
    await waitFor(() =>
      expect(container.textContent).toContain('Could not load control-plane metrics.'),
    );
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('unparseable exposition format');
  });
});

// ── The two compound surfaces keep their literal ──────────────────────

describe('the compound `error || !data` branches', () => {
  // Both pages early-return on `error || !data`, so the no-error-no-data case is
  // a LIVE path and is not a failure. Passing `undefined` into
  // `operatorErrorMessage` would answer it with a load-failure sentence for a
  // state where nothing failed. Asserted in pairs so a regression in either
  // direction is caught.
  it('/dashboard keeps its literal when there is no error and no data', async () => {
    const { container } = disabledMount(<DashboardPage />);
    await waitFor(() => expect(container.textContent).toContain('Dashboard data unavailable.'));
    expect(container.textContent).not.toContain('Could not load the dashboard');
    expect(container.querySelector('details')).toBeNull();
  });

  it('/dashboard uses the new clause when there IS an error', async () => {
    getCpDashboard.mockRejectedValue(apiError(503, '', 'control-plane', '/dashboard/overview'));
    const { container } = mount(<DashboardPage />);
    await waitFor(() => expect(container.textContent).toContain('Could not load the dashboard'));
    expect(container.textContent).toContain('unavailable or rate limiting right now');
    expect(container.textContent).not.toContain('Dashboard data unavailable.');
  });

  it('/trust keeps its literal when there is no error and no data', async () => {
    const { container } = disabledMount(<TrustPage />);
    await waitFor(() => expect(container.textContent).toContain('Trust data unavailable.'));
    expect(container.textContent).not.toContain('Could not load trust signals');
    expect(container.querySelector('details')).toBeNull();
  });

  it('/trust uses the new clause when there IS an error', async () => {
    listCpRuns.mockRejectedValue(apiError(503, '', 'control-plane', '/runs'));
    const { container } = mount(<TrustPage />);
    await waitFor(() => expect(container.textContent).toContain('Could not load trust signals'));
    expect(container.textContent).toContain('unavailable or rate limiting right now');
    expect(container.textContent).not.toContain('Trust data unavailable.');
  });
});

// ── /runs/[runId] stops claiming "not found" for everything ───────────

describe('/runs/[runId] no longer says "not found" for every failure', () => {
  // The page reads `use(params)`, which SUSPENDS on the promise, so it needs a
  // boundary above it — without one the render commits nothing and every
  // assertion below reads an empty container.
  // `await act` as well as the boundary: the boundary keeps React from throwing
  // on a suspend with nothing above it, and the awaited `act` is what lets the
  // params promise settle and the real tree commit. Without the latter every
  // assertion below reads the fallback.
  async function mountDetail(): Promise<RenderResult> {
    let r!: RenderResult;
    await act(async () => {
      r = mount(
        <Suspense fallback={<div />}>
          <RunDetailPage params={Promise.resolve({ runId: 'run-42' })} />
        </Suspense>,
      );
    });
    return r;
  }

  it('says not-found only for an actual 404, and names the id', async () => {
    getCpRun.mockRejectedValue(apiError(404, '', 'control-plane', '/runs/run-42'));
    const { container } = await mountDetail();
    await waitFor(() => expect(container.textContent).toContain('Could not load this run'));
    expect(container.textContent).toContain('no run with id run-42 exists on this control plane.');
  });

  it('does NOT say not-found for a 503', async () => {
    getCpRun.mockRejectedValue(apiError(503, '', 'control-plane', '/runs/run-42'));
    const { container } = await mountDetail();
    await waitFor(() => expect(container.textContent).toContain('Could not load this run'));
    expect(container.textContent).toContain('unavailable or rate limiting right now');
    expect(container.textContent).not.toContain('exists on this control plane');
    expect(container.textContent).not.toMatch(/not found/i);
  });

  it('does NOT say not-found for a non-ApiError throw', async () => {
    // `fetch` itself rejecting with a `TypeError` never reaches the
    // `!response.ok` branch, so no `ApiError` is ever constructed — and the old
    // string reported that network blip as a missing run.
    getCpRun.mockRejectedValue(new TypeError('Failed to fetch'));
    const { container } = await mountDetail();
    await waitFor(() => expect(container.textContent).toContain('Could not load this run.'));
    expect(container.textContent).not.toMatch(/not found/i);
    expect(container.textContent).not.toContain('Failed to fetch');
  });
});

// ── /contexts adopts the context-specific module, not the generic one ──

describe('/contexts renders the context vocabulary, not the generic sweep', () => {
  it('renders `contextErrorMessage` for a code-bearing failure', async () => {
    // Computed through the module rather than hard-coded, so this asserts
    // WIRING; the string itself is asserted against upstream's `error-codes.ts`
    // in `api-error-messages.test.ts`.
    const err = new ApiError(
      502,
      '{"errorCode":"CONTEXT_BINDING_UNVERIFIABLE"}',
      'control-plane',
      '/contexts/search',
      true,
    );
    searchContexts.mockRejectedValue(err);
    const { container } = mount(<ContextsPage />);
    await waitFor(() => expect(container.textContent).toContain('could not be checked'));
    expect(container.textContent).toContain(contextErrorMessage(err));
    // The distinction this module exists to preserve: we COULD NOT check is not
    // we DID check and it was wrong.
    expect(container.textContent).not.toContain("doesn't match its own claimed id");
  });

  // The cursor codes live here because this is the only path in the console
  // that sends a cursor: `app/contexts/page.tsx:62` keysets on `next_cursor`
  // and `client.ts:632` puts it on a direct-to-registry `/contexts/search`.
  // Before `contextErrorMessage` consulted the registry map, an expired cursor
  // fell all the way through to `Could not load context.` on the one surface
  // that could produce one.
  it.each([
    ['cursor_expired', 400],
    ['invalid_cursor', 400],
  ])('names the re-search recovery for a %s on this page', async (code, status) => {
    searchContexts.mockRejectedValue(
      new ApiError(
        status,
        JSON.stringify({ error: { code } }),
        'registry-a',
        '/contexts/search?cursor=abc',
        true,
      ),
    );
    const { container } = mount(<ContextsPage />);
    await waitFor(() =>
      expect(container.textContent).toContain('Search again from the start'),
    );
    expect(container.textContent).toContain(REGISTRY_ERROR_CODES.get(code)!);
    // The sentence this displaced, which told an operator in a recoverable
    // state precisely nothing.
    expect(container.textContent).not.toContain('Could not load context.');
  });

  // The page has TWO ErrorPanels — the search one swept here, and the detail
  // modal's at `:295`, which predates this phase. Same page, same function;
  // they must offer the same affordance, or the disclosure looks like an
  // oversight on whichever one lacks it.
  it('offers the disclosure on the detail modal too, not just the search panel', async () => {
    searchContexts.mockResolvedValue({
      matches: [
        {
          ctx_id: 'acdp://registry-a.playground.local/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    getContext.mockRejectedValue(apiError(502, RAW, 'control-plane', '/contexts/abc'));
    const { container } = mount(<ContextsPage />);
    fireEvent.click(await screen.findByText('A context'));
    const dialog = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[role="dialog"]');
      if (!el?.querySelector('details.error-detail')) throw new Error('no disclosure yet');
      return el;
    });
    const { primary, diagnostic } = readPanel(dialog);
    expect(primary).not.toContain('schema_violation');
    expect(diagnostic).toContain('schema_violation');
  });

  it('still folds the raw body into the disclosure', async () => {
    searchContexts.mockRejectedValue(apiError(502, RAW, 'control-plane', '/contexts/search'));
    const { container } = mount(<ContextsPage />);
    await screen.findByText('Technical detail');
    const { primary, diagnostic } = readPanel(container);
    expect(primary).not.toContain('schema_violation');
    expect(diagnostic).toContain('schema_violation');
  });
});

// ── The registry's own vocabulary, on the surfaces that can see it ─────

// Each code below is seeded on a route that can ACTUALLY emit it. The first cut
// of this block asserted both cursor codes on `/lineage`'s chain lookup because
// that was where the map was wired — but `GET /lineages/{id}` takes no cursor
// parameter at all (`acdp-registry-core/src/handlers/context.rs` — the handler
// signature is `Path(lineage_id)` and it returns a bare `Vec<FullContext>`), so
// those two tests were green against a request no deployment can produce. The
// cursor codes fire on `/contexts`' "Load more" and are asserted there.

describe("/lineage's chain lookup speaks the registry's codes", () => {
  async function resolveWith(err: unknown): Promise<HTMLElement> {
    getLineage.mockRejectedValue(err);
    const { container } = mount(<LineagePage />);
    fireEvent.click(screen.getByRole('button', { name: 'By lineage_id' }));
    fireEvent.change(screen.getByPlaceholderText(/lineage_id/), { target: { value: 'lin-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(container.textContent).toContain('Could not resolve this lineage_id'));
    return container;
  }

  it('names the grant location for `not_authorized`, rather than a console-side key', async () => {
    // 403 from `tenant_for_request` / `caller_from_headers`, both of which run
    // before the lookup in the lineage handler. The generic 403 arm — "not
    // authorized by registry A" — invites the operator to go looking for a
    // registry credential this console does not have and cannot be given.
    const container = await resolveWith(
      new ApiError(403, '{"error":{"code":"not_authorized"}}', 'registry-a', '/lineages/lin-1', true),
    );
    expect(container.textContent).toContain(REGISTRY_ERROR_CODES.get('not_authorized')!);
    expect(container.textContent).toContain('this console sends it no credential');
    expect(container.textContent).not.toContain('not authorized by registry A');
  });

  it('says a `rate_limited` read is retryable rather than refused', async () => {
    const container = await resolveWith(
      new ApiError(429, '{"error":{"code":"rate_limited"}}', 'registry-a', '/lineages/lin-1', true),
    );
    expect(container.textContent).toContain(REGISTRY_ERROR_CODES.get('rate_limited')!);
    expect(container.textContent).toContain('rejected on its merits');
  });

  it('points a federated 502 at the far registry, not the one that answered', async () => {
    const container = await resolveWith(
      new ApiError(
        502,
        '{"error":{"code":"cross_registry_resolution_failed"}}',
        'registry-a',
        '/lineages/lin-1',
        true,
      ),
    );
    expect(container.textContent).toContain('federated hop');
    // The status arm it displaced sends the operator to debug registry A.
    expect(container.textContent).not.toContain('registry A did not answer successfully');
  });

  it('falls through to the status arms for a code the map does not hold', async () => {
    // `schema_violation` is a real registry code and is deliberately absent from
    // the map — the publish-side codes are unreachable from this console. A map
    // that swallowed unknown codes would render nothing useful for them.
    const container = await resolveWith(
      apiError(502, RAW, 'registry-a', '/lineages/lin-1'),
    );
    expect(container.textContent).toContain('registry A did not answer successfully (502)');
  });
});

// ══════════════════════════════════════════════════════════════════════
// #88's cross-cutting close criterion, landed with the last of its phases.
//
// This was deliberately NOT asserted while six sites in `components/` were
// still outstanding: a repo-wide guard that fails by construction gets
// commented out, and a commented-out guard is worse than none. It lands now
// that the last of them (`launch-modal.tsx`) is done.
//
// Source-text assertion rather than a render, because the thing under test is
// a shape a future edit could reintroduce anywhere — including on a surface
// this file has no test for.
// ══════════════════════════════════════════════════════════════════════
describe('no surface stringifies an error into its message', () => {
  const ERROR_ARG = /\bString\(\s*(?:[A-Za-z_$][\w$]*\.)*(?:err|error|e)\b/;

  /**
   * Blank out comments, preserving line numbering.
   *
   * Necessary, not fastidious: `app/runs/[runId]/page.tsx` and
   * `components/ui/error-panel.tsx` both QUOTE the removed shape in prose,
   * explaining the defect they exist to document. A guard that cannot tell code
   * from a description of code would forbid writing that down — and the fix
   * would be to delete the explanation, which is the wrong direction.
   *
   * **Whole-line `//` FIRST, then block comments.** The other order has a
   * constructible blind spot that verification found: a line comment containing
   * an unpaired `/*` opens a pseudo-block that swallows every line up to the
   * next `*&#47;` anywhere in the file, hiding real offenders in between —
   *
   *     // the /* form is handled above
   *     return <div>{String(error)}</div>;   // ← invisible to the gate
   *     /* an ordinary block comment further down *&#47;
   *
   * Stripping line comments first removes the `/*` before the block pass can
   * see it. Blanking a `//` that happens to sit inside a block comment is
   * harmless, since that text is about to be blanked anyway.
   *
   * Trailing `//` is deliberately NOT stripped: a guard a trailing comment can
   * switch off is not a guard.
   */
  function stripComments(src: string): string {
    return src
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  }

  /** Every `.ts`/`.tsx` under a tree, minus the server-side route handlers. */
  function sources(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) out.push(p);
      }
    };
    walk(join(process.cwd(), dir));
    return out;
  }

  it('across app/ and components/, outside the three route handlers', () => {
    // The carve-out is principled, not a convenience. The three handlers under
    // `app/api/` run on the server and `String(err)` there goes into a response
    // BODY for a caught exception — the console's own last-resort diagnostic,
    // with no operator reading it directly and no `ApiError` in scope to
    // interrogate. Named individually rather than excluded by glob, so a fourth
    // handler cannot inherit the exemption silently.
    const EXEMPT = [
      'app/api/proxy/[service]/[...path]/route.ts',
      'app/api/stream/events/route.ts',
      'app/api/stream/runs/[runId]/route.ts',
    ].map((p) => join(process.cwd(), p));

    const offenders: string[] = [];
    for (const file of [...sources('app'), ...sources('components')]) {
      if (EXEMPT.includes(file)) continue;
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (ERROR_ARG.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('and the pattern it looks for actually matches the shape that was removed', () => {
    // A guard whose regex matches nothing passes forever. Pinned against the
    // exact forms that were in the tree, plus the two near-misses that must
    // NOT trip it.
    for (const shape of [
      'message={String(error)}',
      '{String(toggleMut.error)}',
      'setError(String(e));',
      '<ErrorPanel message={String(revs.error)} />',
      'String( error )',
    ]) {
      expect(ERROR_ARG.test(shape)).toBe(true);
    }
    for (const ok of [
      "String(v ?? '')",
      'String(selected.contextCount)',
      'String(SCENARIO_COUNT)',
      'JSON.stringify({ error })',
    ]) {
      expect(ERROR_ARG.test(ok)).toBe(false);
    }
  });

  it('cannot be switched off by a line comment containing an unpaired /*', () => {
    // The blind spot verification constructed. With block comments stripped
    // FIRST, the `/*` inside a line comment opens a pseudo-block that runs to
    // the next `*/` anywhere in the file and takes the offender with it.
    const trap = [
      '// the /* form is handled above',
      'export function P({ error }) { return <div>{String(error)}</div>; }',
      '/* an ordinary block comment further down */',
    ].join('\n');
    const surviving = stripComments(trap)
      .split('\n')
      .filter((l) => ERROR_ARG.test(l));
    expect(surviving).toHaveLength(1);
  });

  it('still strips what it is supposed to strip', () => {
    // The pair. A stripper that blanks nothing would pass the trap test above
    // and then flag every file that documents the defect.
    const commented = [
      '// message={String(error)}  <- the old shape, described',
      '/* and again: String(err) */',
      '{/* a JSX comment: String(e) */}',
    ].join('\n');
    expect(
      stripComments(commented)
        .split('\n')
        .filter((l) => ERROR_ARG.test(l)),
    ).toEqual([]);
    // …and line numbering survives, so an offender's line number is real.
    expect(stripComments(commented).split('\n')).toHaveLength(3);
  });
});
