import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistryCard } from '@/components/registries/registry-card';
import { ApiError } from '@/lib/api/fetcher';
import { MOCK_CAPABILITIES } from '@/lib/data/mock-data';
import type { KnownRegistry } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// #129: `RegistryCard`'s header used to render `<StatusDot tone="ok" />` and
// `● healthy` unconditionally, with no input — a registry this console never
// probed (outside the `a`/`b` capabilities map on `/registries`) still read
// healthy. The header now renders a `health` prop, computed by
// `registryProbeView` (covered on its own in `use-registries.test.ts`); these
// tests are about what the CARD does with that prop, and what `/registries`
// actually wires it to.
// ══════════════════════════════════════════════════════════════════════

const REGISTRY: KnownRegistry = {
  authority: 'registry-b.playground.local',
  baseUrl: 'http://localhost:8200',
  firstSeen: '2026-08-01T00:00:00Z',
  lastSeen: '2026-08-01T01:00:00Z',
  eventCount: 12,
};

afterEach(cleanup);

describe('RegistryCard — the health prop', () => {
  it('omitted: renders no health claim at all — no "healthy" text, no dot', () => {
    const { container } = render(<RegistryCard registry={REGISTRY} />);
    expect(container.textContent ?? '').not.toContain('healthy');
    expect(container.querySelector('.dot')).toBeNull();
  });

  it.each([
    { tone: 'warn' as const, variant: 'neutral', label: 'not probed' },
    { tone: 'warn' as const, variant: 'neutral', label: 'checking…' },
    { tone: 'ok' as const, variant: 'complete', label: 'responding' },
    { tone: 'err' as const, variant: 'failed', label: 'degraded' },
    { tone: 'err' as const, variant: 'failed', label: 'unreachable' },
  ])('renders the $label word as text, with exactly the right dot tone', ({ tone, variant, label }) => {
    const { container } = render(<RegistryCard registry={REGISTRY} health={{ tone, variant, label }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    // `.dot.ok` is present for exactly the `responding` (tone: 'ok') view —
    // every other view's dot carries a different tone class.
    expect(container.querySelectorAll('.dot.ok')).toHaveLength(tone === 'ok' ? 1 : 0);
    expect(container.querySelectorAll('.dot')).toHaveLength(1);
  });
});

const getRegistryCapabilities = vi.fn();
const listRegistries = vi.fn();
const listEnrollments = vi.fn();
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getRegistryCapabilities: (...a: unknown[]) => getRegistryCapabilities(...a),
    listRegistries: (...a: unknown[]) => listRegistries(...a),
    listEnrollments: (...a: unknown[]) => listEnrollments(...a),
  };
});
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const RegistriesPage = (await import('@/app/registries/page')).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RegistriesPage />
    </QueryClientProvider>,
  );
}

describe('/registries — the health word actually wired to two real probes', () => {
  it('shows "responding" on the registry that answered and "unreachable" on the one that did not', async () => {
    listRegistries.mockResolvedValue([
      { authority: 'registry-a.playground.local', firstSeen: '', lastSeen: '', eventCount: 0 },
      { authority: 'registry-b.playground.local', firstSeen: '', lastSeen: '', eventCount: 0 },
    ]);
    listEnrollments.mockResolvedValue([]);
    getRegistryCapabilities.mockImplementation(async (authority: string) => {
      if (authority === 'a') return MOCK_CAPABILITIES.a;
      // Unstamped — a console-minted failure, not an upstream one — so it
      // reads `unreachable` rather than `degraded`.
      throw new ApiError(503, '', 'registry-b', '/.well-known/acdp.json', false);
    });

    renderPage();

    expect(await screen.findByText('responding')).toBeInTheDocument();
    expect(await screen.findByText('unreachable')).toBeInTheDocument();
  });
});
