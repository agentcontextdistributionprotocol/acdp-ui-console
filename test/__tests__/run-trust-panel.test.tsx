// ══════════════════════════════════════════════════════════════════════
// What the operator SEES on a run whose signing key was revoked.
//
// The shipped demo run `run-revoked-1` carried `flagged: []` plus a live
// `revoked_at_or_after` verdict and rendered a green check-mark, because the
// header icon was driven by `flagged.length` alone. A verdict-level test could
// not have caught that — the data was right and the render was wrong.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RunTrustPanel } from '@/components/runs/run-trust-panel';
import type { RunTrustSummary } from '@/lib/types';

type Revoked = NonNullable<RunTrustSummary['revoked']>;

function revocation(status: string, eventId = status): Revoked[number] {
  return {
    eventId,
    ctxId: `acdp://registry-a.playground.local/${eventId}`,
    status,
    boundary: '2026-08-01 00:00:00+00',
    trustClass: 'producer_signed',
    sources: [],
  };
}

function summary(over: Partial<RunTrustSummary> = {}): RunTrustSummary {
  return {
    audited: 3,
    verified: 3,
    verifiedHistorical: 0,
    structural: 0,
    noReceipt: 0,
    errors: 0,
    flagged: [],
    ...over,
  };
}

/** The Stat block renders the number and its label as siblings. */
function statValue(label: string): string {
  const el = screen.getByText(label);
  return el.parentElement?.querySelector('span')?.textContent ?? '';
}

const hasDangerIcon = (c: HTMLElement) => !!c.querySelector('.lucide-shield-alert');
const hasOkIcon = (c: HTMLElement) => !!c.querySelector('.lucide-badge-check');

afterEach(cleanup);

describe('RunTrustPanel — the header verdict', () => {
  it('a revoked-only run renders the DANGER icon, not a green check-mark', () => {
    const { container } = render(
      <RunTrustPanel trust={summary({ revoked: [revocation('revoked_at_or_after')] })} />,
    );
    expect(hasDangerIcon(container)).toBe(true);
    expect(hasOkIcon(container)).toBe(false);
  });

  it('a run with ONLY pre_compromise entries keeps the green check-mark', () => {
    // The inverse criterion. Fixing the under-claim must not convert an
    // authorized historical event into a false alarm — `pre_compromise` means
    // the event verified strictly BEFORE the boundary.
    const { container } = render(
      <RunTrustPanel trust={summary({ revoked: [revocation('pre_compromise')] })} />,
    );
    expect(hasOkIcon(container)).toBe(true);
    expect(hasDangerIcon(container)).toBe(false);
  });

  it('an UNKNOWN revocation status reddens the header (unknown fails closed)', () => {
    const { container } = render(
      <RunTrustPanel trust={summary({ revoked: [revocation('some_future_status')] })} />,
    );
    expect(hasDangerIcon(container)).toBe(true);
  });

  it('a run with both flags and a fail-closed verdict shows one danger icon and both tables', () => {
    const { container } = render(
      <RunTrustPanel
        trust={summary({
          flagged: [{ eventId: 'f1', ctxId: null, status: 'discrepancy', discrepancies: ['content_hash_mismatch:x'] }],
          revoked: [revocation('revoked_at_or_after')],
        })}
      />,
    );
    expect(container.querySelectorAll('.lucide-shield-alert')).toHaveLength(1);
    expect(container.querySelectorAll('table')).toHaveLength(2);
  });
});

describe('RunTrustPanel — the counts', () => {
  it('the Revoked stat counts fail-closed verdicts only, and pre_compromise is shown separately', () => {
    render(
      <RunTrustPanel
        trust={summary({
          revoked: [revocation('pre_compromise'), revocation('revoked_at_or_after')],
        })}
      />,
    );
    // Numerically falsifiable: 1, not 2. The old code rendered `revoked.length`
    // in danger red, so an authorized event was counted as a violation — and
    // the panel visibly contradicted itself, since its own table renders that
    // same row with a green `chip ok`.
    expect(statValue('Revoked')).toBe('1');
    expect(statValue('Pre-compromise')).toBe('1');
  });

  it('counts an unknown status into Revoked rather than dropping it', () => {
    render(
      <RunTrustPanel
        trust={summary({ revoked: [revocation('revoked_at_or_after'), revocation('who_knows')] })}
      />,
    );
    expect(statValue('Revoked')).toBe('2');
    expect(statValue('Pre-compromise')).toBe('0');
  });
});

describe('RunTrustPanel — the revocation table', () => {
  it('renders a styled chip for an unknown status instead of an unstyled one', () => {
    render(<RunTrustPanel trust={summary({ revoked: [revocation('who_knows')] })} />);
    const chip = screen.getByText('who_knows');
    expect(chip.className).toBe('chip bad');
    expect(chip.className).not.toBe('');
  });

  it('still renders every entry, including the authorized one, with its own severity', () => {
    render(
      <RunTrustPanel
        trust={summary({
          revoked: [
            revocation('pre_compromise'),
            revocation('revoked_at_or_after'),
            revocation('revoked_time_unverifiable'),
          ],
        })}
      />,
    );
    expect(screen.getByText('pre_compromise').className).toBe('chip ok');
    expect(screen.getByText('revoked_at_or_after').className).toBe('chip bad');
    expect(screen.getByText('revoked_time_unverifiable').className).toBe('chip warn');
  });
});
