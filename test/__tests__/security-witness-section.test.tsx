import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';

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
vi.mock('@/lib/api/client', () => ({
  getLogWitness: (...a: unknown[]) => getLogWitness(...a),
  listRegistries: (...a: unknown[]) => listRegistries(...a),
  listRevocations: vi.fn(async () => ({ entries: [], next_cursor: null })),
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
