import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthResult } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// The two surfaces that render a WORD for health, not just a dot.
//
// `pingHealth`'s own `detail` assignments are pinned in `client.test.ts`. What
// these tests pin is the other half: that the word actually reaches the
// SCREEN. Both components hardcoded "unreachable" for every `ok === false`
// until ui-3's Phase 6, and `health-checks.tsx` prints the latency right beside
// it — so a service that answered in 8 ms read "unreachable · 8 ms".
//
// The `ConnectionStatus` half of this file used to assert on the pill's `title`
// attribute, which is the one thing `CLAUDE.md` forbids for a trust surface —
// "invisible on touch, invisible to the keyboard, unreliably announced" — and
// asserting it is how the tooltip survived three plans. #100 is that finding.
// The block below now asserts rendered TEXT and, separately, that the component
// has no `[title]` at all, so the tooltip cannot come back under a passing
// suite.
//
// `components/**` is outside `vitest.config.mts`'s coverage `include`, so this
// logic cannot show up as uncovered either. Without these tests, reverting
// either component leaves the suite green.
// ══════════════════════════════════════════════════════════════════════

const pingHealth = vi.fn();
vi.mock('@/lib/api/client', () => ({ pingHealth: (...a: unknown[]) => pingHealth(...a) }));
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const { ConnectionStatus } = await import('@/components/layout/connection-status');
const { HealthChecks } = await import('@/components/observability/health-checks');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const RESULTS: Array<[string, HealthResult, string]> = [
  ['a healthy service', { ok: true, latencyMs: 7, version: '1.0.0' }, 'healthy'],
  ['a service that answered and reported itself unwell', { ok: false, detail: 'degraded', latencyMs: 8 }, 'degraded'],
  ['a service that never answered', { ok: false, detail: 'unreachable', latencyMs: 30 }, 'unreachable'],
  // A HealthResult from before `detail` existed, or any future path that
  // forgets to set it. The old word is the safe default: it was the only
  // thing these surfaces ever said for a failure until `detail` landed.
  ['a failure carrying no detail at all', { ok: false, latencyMs: 12 }, 'unreachable'],
];

describe('HealthChecks renders the failure kind, not just "unreachable"', () => {
  it.each(RESULTS)('says "%s" → %s', async (_label, result, word) => {
    pingHealth.mockResolvedValue(result);
    mount(<HealthChecks />);

    await waitFor(() => expect(screen.getAllByText(word).length).toBeGreaterThan(0));
  });

  it('shows a loading word before the first probe settles', async () => {
    pingHealth.mockImplementation(() => new Promise(() => {}));
    mount(<HealthChecks />);

    expect(screen.getAllByText('checking…').length).toBeGreaterThan(0);
    // And specifically NOT an assertion about reachability it cannot yet make.
    expect(screen.queryByText('unreachable')).toBeNull();
  });

  it('does not paint the dot red while it is still checking', async () => {
    // The card said `checking…` in words and `err` in colour, on the first
    // render of every visit — so the half an operator scans reported a failure
    // the half they read explicitly declined to report. Three states, three
    // dots.
    pingHealth.mockImplementation(() => new Promise(() => {}));
    const { container } = mount(<HealthChecks />);

    expect(container.querySelectorAll('.dot.warn').length).toBe(4);
    expect(container.querySelectorAll('.dot.err').length).toBe(0);
  });

  it('paints the dot red once a probe has actually failed', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
    const { container } = mount(<HealthChecks />);

    await waitFor(() => expect(container.querySelectorAll('.dot.err').length).toBe(4));
    expect(container.querySelectorAll('.dot.warn').length).toBe(0);
  });

  it('renders the degraded word beside the latency that contradicts "unreachable"', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
    mount(<HealthChecks />);

    await waitFor(() => expect(screen.getAllByText('degraded').length).toBeGreaterThan(0));
    expect(screen.getAllByText('8 ms').length).toBeGreaterThan(0);
  });

  it('shows no latency at all while checking', async () => {
    // `view.latencyMs` does not exist on the `checking` arm, so there is
    // nothing to render — but the old code read `data?.latencyMs`, which would
    // have shown a STALE latency beside `checking…` on a refetch. Pinning the
    // absence keeps that from creeping back.
    pingHealth.mockImplementation(() => new Promise(() => {}));
    const { container } = mount(<HealthChecks />);

    expect(container.querySelectorAll('.health-latency').length).toBe(0);
  });
});

describe('ConnectionStatus renders the failure kind as text, not as a tooltip', () => {
  it.each(RESULTS)('says "%s" → %s', async (_label, result, word) => {
    pingHealth.mockResolvedValue(result);
    const { container } = mount(<ConnectionStatus label="Registry A" service="registry-a" />);

    if (word === 'healthy') {
      // The healthy pill says the LABEL and nothing else. `active-pill` plus a
      // pulsing green dot is already unambiguous, and the topbar has no room
      // for a word on all four services at phone width.
      await waitFor(() => expect(container.querySelector('.active-pill')).not.toBeNull());
      expect(container.querySelector('.pill-detail')).toBeNull();
      expect(container.textContent).toBe('Registry A');
    } else {
      await waitFor(() => expect(container.querySelector('.pill-detail')?.textContent).toBe(word));
      expect(container.textContent).toContain('Registry A');
      expect(container.querySelector('.active-pill')).toBeNull();
    }
  });

  it('has no title attribute anywhere', async () => {
    // The assertion the old version of this file was making, inverted. A pill
    // that discloses only on hover has not disclosed.
    pingHealth.mockResolvedValue({ ok: false, detail: 'degraded', latencyMs: 8 } satisfies HealthResult);
    const { container } = mount(<ConnectionStatus label="Registry A" service="registry-a" />);

    await waitFor(() => expect(container.querySelector('.pill-detail')).not.toBeNull());
    expect(container.querySelectorAll('[title]').length).toBe(0);
  });

  it('says checking… before the first probe, in muted rather than danger', async () => {
    pingHealth.mockImplementation(() => new Promise(() => {}));
    const { container } = mount(<ConnectionStatus label="Registry A" service="registry-a" />);

    const detail = container.querySelector('.pill-detail');
    expect(detail?.textContent).toBe('checking…');
    // `.bad` is what carries `var(--danger)`. A pill still waiting for its
    // first answer must not be painted as a failure — jsdom computes no
    // stylesheet, so the class is the observable.
    expect(detail?.classList.contains('bad')).toBe(false);
    expect(container.querySelector('.dot.warn')).not.toBeNull();
  });

  it('marks a settled failure as bad', async () => {
    pingHealth.mockResolvedValue({ ok: false, detail: 'unreachable', latencyMs: 30 } satisfies HealthResult);
    const { container } = mount(<ConnectionStatus label="Control Plane" service="control-plane" />);

    await waitFor(() =>
      expect(container.querySelector('.pill-detail')?.classList.contains('bad')).toBe(true),
    );
    expect(container.querySelector('.dot.err')).not.toBeNull();
  });
});

describe('the topbar can physically show the word it now renders', () => {
  // jsdom performs no layout, so there is no behavioural assertion available
  // here — and the alternative to a source assertion is no gate at all on the
  // two declarations that keep the wrapped row visible. The pill words are
  // useless if the row they sit in is clipped, and it WAS clipped: four labels
  // plus the refresh button already measure wider than a 400px viewport leaves
  // once `--sidebar-w` drops to 56px, so appending a word overflows a
  // `.topbar-pills` with no `flex-wrap`, and a wrapped row is then cut off by a
  // `.shell` whose first grid track is a fixed `--topbar-h`.
  //
  // Matched as declarations rather than as exact strings, so reordering or
  // respacing the rule does not turn this red.
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('lets .topbar-pills wrap', () => {
    const rule = css.match(/\.topbar-pills\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
  });

  it('lets the shell grow its topbar row instead of clipping it', () => {
    const rule = css.match(/\.shell\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(rule).toMatch(/grid-template-rows:\s*minmax\(var\(--topbar-h\),\s*auto\)\s*1fr/);
  });

  it('does not paint the checking word in danger', () => {
    // The class that carries `--danger` is `.bad`, applied only on the settled
    // failure arm. Pinning the rule here as well as the class in the render test
    // above closes the other half: moving the colour onto `.pill-detail` itself
    // would leave every render assertion green while painting `checking…` red.
    const base = css.match(/\.pill-detail\s*\{[^}]*\}/)?.[0] ?? '';
    expect(base).not.toMatch(/--danger/);
    expect(css).toMatch(/\.pill-detail\.bad\s*\{[^}]*--danger/);
  });
});
