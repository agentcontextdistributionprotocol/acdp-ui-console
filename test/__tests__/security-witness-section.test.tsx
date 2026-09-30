import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import { createQueryClient } from '@/components/providers';

// ══════════════════════════════════════════════════════════════════════
// The witness section's wiring on /security, as distinct from one card.
//
// The card's own tests mount it directly with an authority handed to them, so
// they cannot see the two decisions this section makes: WHICH authorities get a
// card, and what the page looks like when none of them has any witness state.
// That second case is not hypothetical — a 404 is the ordinary answer for a
// registry the control plane has never witnessed, so a console pointed at a
// deployment with `LOG_WITNESS_ENABLED=false` renders a section heading over
// nothing at all.
//
// The authority list deliberately comes from `useRegistries()` rather than the
// hardcoded a/b pair the JWKS section uses, because this endpoint is
// control-plane-side and authority-keyed — so a third enrolled registry must
// get a card without anyone editing this file.
// ══════════════════════════════════════════════════════════════════════

const getLogWitness = vi.fn();
const listRegistries = vi.fn();
const listLogWitnessAlerts =
  vi.fn<(...args: unknown[]) => Promise<{ data: unknown[]; total: number }>>(async () => ({
    data: [],
    total: 0,
  }));
const listRevocations = vi.fn<(...args: unknown[]) => Promise<{ entries: unknown[]; next_cursor: number | null }>>(
  async () => ({ entries: [], next_cursor: null }),
);
vi.mock('@/lib/api/client', () => ({
  getLogWitness: (...a: unknown[]) => getLogWitness(...a),
  listRegistries: (...a: unknown[]) => listRegistries(...a),
  // Stubbed deliberately. Without it the alert worklist this page now mounts
  // has no client function to call, so it renders a red ErrorPanel INSIDE
  // otherwise-passing tests — a failure that is invisible because nothing here
  // asserts on it.
  listLogWitnessAlerts: (...a: unknown[]) => listLogWitnessAlerts(...a),
  listRevocations: (...a: unknown[]) => listRevocations(...a),
  getRegistryJwks: vi.fn(async () => ({ keys: [] })),
  getRegistryCapabilities: vi.fn(async () => ({})),
}));

vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const SecurityPage = (await import('@/app/security/page')).default;

const A = 'registry-a.example.com';
const B = 'registry-b.example.com';
const C_AUTH = 'registry-c.example.com';

function witnessState(authority: string) {
  return {
    authority,
    logId: `${authority}/log/v1`,
    lastWitnessedSize: 12,
    lastRootHash: 'sha256:abc',
    lastSuccessAt: new Date(Date.now() + 60_000).toISOString(),
    consecutiveFailures: 0,
    alert: { alerted: false, reason: null, detail: null, at: null },
    checkpoints: [],
    total: 0,
  };
}

function notFound(authority: string) {
  return new ApiError(
    404,
    JSON.stringify({ errorCode: 'REGISTRY_NOT_FOUND' }),
    'control-plane',
    `/registries/${authority}/log-witness`,
  );
}

function renderPage() {
  // The real client, not a hand-rolled `{retry: false}` stand-in — this file
  // is where #128's offline-doesn't-pause fix is proven end to end, so it
  // must build the client the app actually runs, `networkMode: 'always'`
  // included.
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SecurityPage />
    </QueryClientProvider>,
  );
}

/** Headings, so "the section rendered" is asserted the way a reader sees it. */
function sectionHeading(): HTMLElement | null {
  return screen.queryByRole('heading', { name: /transparency-log witness/i });
}

afterEach(() => {
  vi.clearAllMocks();
  // `onlineManager` is module-global state in @tanstack/react-query, not
  // per-QueryClient — leaving it false here would leak into every later test
  // in this file (and, in a suite that shares module state across files,
  // beyond it).
  onlineManager.setOnline(true);
});

describe('/security — transparency-log witness section', () => {
  it('renders one card per OBSERVED registry, not per proxied registry', async () => {
    // Three registries, including one this console has no proxy service for.
    // The JWKS section above can only ever show two; this one must show all
    // three, or enrolling a registry silently drops its trust evidence.
    listRegistries.mockResolvedValue(
      [A, B, C_AUTH].map((authority) => ({
        authority,
        firstSeen: '',
        lastSeen: '',
        eventCount: 0,
      })),
    );
    getLogWitness.mockImplementation(async (authority: string) => witnessState(authority));
    renderPage();

    await waitFor(() => expect(sectionHeading()).not.toBeNull());
    for (const authority of [A, B, C_AUTH]) {
      expect(await screen.findByRole('heading', { name: authority })).toBeTruthy();
    }
    expect(getLogWitness).toHaveBeenCalledTimes(3);
  });

  it('renders no section at all when no registry has been observed', async () => {
    listRegistries.mockResolvedValue([]);
    renderPage();

    // The revocation feed above settles, so the page HAS rendered by now.
    await screen.findByRole('heading', { name: /revocation feed/i });
    expect(sectionHeading()).toBeNull();
    expect(getLogWitness).not.toHaveBeenCalled();
  });

  it('leaves a heading over an empty grid when every authority 404s', async () => {
    // Documented rather than fixed: the cards decide absence individually and
    // the section cannot know they will all decline before it renders. Pinned
    // here so the day someone hoists that decision up to the section, this test
    // is what tells them the behaviour changed on purpose.
    listRegistries.mockResolvedValue([
      { authority: A, firstSeen: '', lastSeen: '', eventCount: 0 },
      { authority: B, firstSeen: '', lastSeen: '', eventCount: 0 },
    ]);
    getLogWitness.mockImplementation(async (authority: string) => {
      throw notFound(authority);
    });
    renderPage();

    await waitFor(() => expect(sectionHeading()).not.toBeNull());
    await waitFor(() => expect(getLogWitness).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: A })).toBeNull();
      expect(screen.queryByRole('heading', { name: B })).toBeNull();
    });
  });
});

describe('/security — the witness alert worklist is actually mounted', () => {
  it('renders the worklist section on the page', async () => {
    // N2: deleting `<LogWitnessAlerts />` from `app/security/page.tsx` left the
    // ENTIRE suite green. ESLint reports the orphaned import as a warning only,
    // so `npm run lint` still exits 0 and CI stays green too — the worklist
    // could vanish from the product without one red signal anywhere.
    listRegistries.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Witness alert worklist')).not.toBeNull());
  });

  it('asks the client for the worklist, including acknowledged rows', async () => {
    // The page-level half of the component's own guard: acknowledged does not
    // mean resolved, so the request that actually leaves this page must carry
    // `includeAcknowledged: true`.
    listRegistries.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(listLogWitnessAlerts).toHaveBeenCalled());
    expect(listLogWitnessAlerts.mock.calls.at(-1)?.[0]).toEqual({ includeAcknowledged: true });
  });
});

describe('/security — an offline browser reads as unreachable, not as an all-clear (#128)', () => {
  // `onlineManager` never reads `navigator.onLine` — it only reflects an
  // `offline`/`online` browser EVENT, which is the ordinary case for a
  // console left open across a network blip. Before this phase, React Query
  // PAUSES a query while `onlineManager` reports offline instead of running
  // it: `listRevocations` was never even called, the revocation feed sat on
  // its loading/empty branch forever, and a genuinely down network read
  // exactly like "no revocations recorded" — a false all-clear on a
  // security surface. `createQueryClient()`'s `networkMode: 'always'` makes
  // the fetch run anyway, so it can fail honestly instead of stalling.
  it('renders the revocation feed as failed, not empty, when the browser is offline', async () => {
    onlineManager.setOnline(false);
    listRegistries.mockResolvedValue([]);
    listRevocations.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    await waitFor(() => expect(listRevocations).toHaveBeenCalled());
    // The exact period-terminated sentence `operatorErrorMessage` renders for
    // a non-`ApiError` throw (a bare `TypeError` from `fetch`, here).
    await waitFor(() => expect(screen.queryByText('Could not load the revocation feed.')).not.toBeNull());
    expect(screen.queryByText('No revocations recorded')).toBeNull();
  });
});
