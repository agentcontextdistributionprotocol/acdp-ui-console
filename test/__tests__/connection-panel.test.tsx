import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { HealthResult } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// `/config`'s "Test All" used to keep `res.ok` and discard `detail` at the
// type (`Record<string, boolean | 'pending'>`), so its render was a bare dot
// with no word for any state — worse than #122's pill, which at least said
// "unreachable" (wrongly, but audibly) before this batch. This file pins that
// the panel now renders the SAME word `settledHealthView` produces, not a
// re-derived one, and that "degraded" and "unreachable" read as visibly
// different outcomes rather than two dots of the same shade of red.
// ══════════════════════════════════════════════════════════════════════

const pingHealth = vi.fn();
vi.mock('@/lib/api/client', () => ({ pingHealth: (...a: unknown[]) => pingHealth(...a) }));
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: () => ({
    jaegerUrl: 'http://localhost:16686',
    setJaegerUrl: vi.fn(),
    demoMode: false,
    setDemoMode: vi.fn(),
  }),
}));

const { ConnectionPanel } = await import('@/components/config/connection-panel');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function testAllButton() {
  return screen.getByRole('button', { name: 'Test All' });
}

describe('ConnectionPanel — Test All renders the failure kind, not just a dot', () => {
  it('renders both a degraded and an unreachable row distinctly, each with its own latency', async () => {
    pingHealth.mockImplementation((service: string) => {
      if (service === 'playground') {
        return Promise.resolve({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
      }
      if (service === 'control-plane') {
        return Promise.resolve({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult);
      }
      return Promise.resolve({ ok: true, latencyMs: 5 } satisfies HealthResult);
    });
    const { container } = render(<ConnectionPanel />);

    fireEvent.click(testAllButton());

    await waitFor(() => expect(screen.getByText('degraded')).toBeTruthy());
    expect(screen.getByText('unreachable')).toBeTruthy();
    expect(screen.getByText('8 ms')).toBeTruthy();
    expect(screen.getByText('30 ms')).toBeTruthy();
    // No tooltip carve-out for this surface — same discipline as the topbar pill.
    expect(container.querySelectorAll('[title]').length).toBe(0);
  });

  it('says healthy for an ok result, and checking… while pending — never unreachable for either', async () => {
    pingHealth.mockImplementation(() => new Promise(() => {}));
    render(<ConnectionPanel />);

    fireEvent.click(testAllButton());

    await waitFor(() => expect(screen.getAllByText('checking…').length).toBeGreaterThan(0));
    expect(screen.queryByText('unreachable')).toBeNull();
  });

  it('says healthy once a probe resolves ok', async () => {
    pingHealth.mockResolvedValue({ ok: true, latencyMs: 6 } satisfies HealthResult);
    render(<ConnectionPanel />);

    fireEvent.click(testAllButton());

    await waitFor(() => expect(screen.getAllByText('healthy').length).toBe(4));
  });

  it('defaults a failure with no detail to unreachable, same as everywhere else', async () => {
    pingHealth.mockResolvedValue({ ok: false, latencyMs: 12 } satisfies HealthResult);
    render(<ConnectionPanel />);

    fireEvent.click(testAllButton());

    await waitFor(() => expect(screen.getAllByText('unreachable').length).toBe(4));
  });
});
