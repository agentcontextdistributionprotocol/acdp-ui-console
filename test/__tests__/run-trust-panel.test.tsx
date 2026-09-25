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

// ── Phase 3: absent revocation data must not render as a confident zero ──
//
// `trust.revoked` is ALWAYS present (`[]` when the check is disabled) and the
// three counters are ALWAYS numbers (`?? 0`), so "checked, clean" and "never
// checked" arrive as byte-identical payloads. Rendering "Revoked 0" for the
// second is a claim nobody established.
describe('RunTrustPanel — was revocation checked at all?', () => {
  it('an all-zero payload renders NEITHER revocation stat, and says so in words', () => {
    render(
      <RunTrustPanel
        trust={summary({
          revoked: [],
          keyRevocationPreCompromise: 0,
          keyRevocationRevokedAtOrAfter: 0,
          keyRevocationRevokedTimeUnverifiable: 0,
        })}
      />,
    );
    expect(screen.queryByText('Revoked')).toBeNull();
    expect(screen.queryByText('Pre-compromise')).toBeNull();
    expect(screen.getByText(/Key revocation not reported for this run/)).toBeInTheDocument();
  });

  it('DISCRIMINATES: one non-zero counter brings both stats back, zeros included', () => {
    // The mirror image of the test above on the same component. If the render
    // condition were inverted — or dropped, so the stats always rendered — one
    // of this pair fails. Neither can pass on an empty render.
    render(
      <RunTrustPanel
        trust={summary({
          revoked: [],
          keyRevocationPreCompromise: 2,
          keyRevocationRevokedAtOrAfter: 0,
          keyRevocationRevokedTimeUnverifiable: 0,
        })}
      />,
    );
    expect(statValue('Revoked')).toBe('0');
    expect(statValue('Pre-compromise')).toBe('0');
    expect(screen.queryByText(/Key revocation not reported/)).toBeNull();
  });

  it('PROOF ARM: audited === 0 renders absent even with non-zero counters', () => {
    // A distinct code path from the heuristic, and a stronger claim: upstream
    // enforces that the revocation check REQUIRES receipt audit, so zero
    // audited events is proof no classification ran. Counters that disagree
    // with that are not evidence the check ran — they are a payload to
    // distrust. The copy differs too, so the two arms are distinguishable in
    // the UI and not just in the source.
    render(
      <RunTrustPanel
        trust={summary({
          audited: 0,
          verified: 0,
          revoked: [],
          keyRevocationPreCompromise: 7,
          keyRevocationRevokedAtOrAfter: 3,
          keyRevocationRevokedTimeUnverifiable: 1,
        })}
      />,
    );
    expect(screen.queryByText('Revoked')).toBeNull();
    expect(screen.queryByText('Pre-compromise')).toBeNull();
    expect(screen.getByText(/no receipt-audit events/)).toBeInTheDocument();
  });

  it('a contradictory payload never denies verdicts it is simultaneously listing', () => {
    // `audited: 0` with a non-empty `revoked[]` cannot come from upstream, but
    // the panel renders the revoked table off `revoked.length` regardless of
    // this predicate — so a guard that fired ahead of the entries produced a
    // panel listing a revocation verdict and, two lines above it, stating that
    // no revocation classification could have run. Evidence wins over the
    // incoherent zero.
    render(
      <RunTrustPanel trust={summary({ audited: 0, verified: 0, revoked: [revocation('revoked_at_or_after')] })} />,
    );
    expect(screen.getByText('revoked_at_or_after')).toBeInTheDocument();
    expect(screen.queryByText(/not reported for this run/)).toBeNull();
    expect(statValue('Revoked')).toBe('1');
  });

  it('a run carrying actual revocation entries always reports, whatever the counters say', () => {
    // The counters are a control-plane aggregate and the array is the detail;
    // if either says something was classified, something was.
    render(<RunTrustPanel trust={summary({ revoked: [revocation('pre_compromise')] })} />);
    expect(statValue('Revoked')).toBe('0');
    expect(statValue('Pre-compromise')).toBe('1');
    expect(screen.queryByText(/not reported/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The payload where the aggregate counters outrun the per-event array.
//
// Phase 3 taught the panel to read the counters for "was revocation reported";
// Phase 2's violation verdict still read the array alone. A payload with
// `revokedAtOrAfter: 2` and `revoked: []` therefore rendered the green
// check-mark beside a `Revoked 0` — the exact reassurance this panel exists to
// withhold, produced by the two halves of one feature disagreeing.
// ══════════════════════════════════════════════════════════════════════
describe('RunTrustPanel — fail-closed verdicts counted without per-event detail', () => {
  const counterOnly = summary({
    revoked: [],
    keyRevocationPreCompromise: 0,
    keyRevocationRevokedAtOrAfter: 2,
    keyRevocationRevokedTimeUnverifiable: 0,
  });

  it('reddens the header — the counters alone establish a violation', () => {
    const { container } = render(<RunTrustPanel trust={counterOnly} />);
    expect(hasDangerIcon(container)).toBe(true);
    expect(hasOkIcon(container)).toBe(false);
  });

  it('shows the counted total rather than the array length', () => {
    render(<RunTrustPanel trust={counterOnly} />);
    expect(statValue('Revoked')).toBe('2');
  });

  it('says the events are not listed, instead of reddening beside nothing', () => {
    // A panel that goes red and then shows no findings is its own kind of
    // unexplained alarm. The count is what is known; say exactly that.
    render(<RunTrustPanel trust={counterOnly} />);
    expect(screen.getByText(/2 fail-closed revocation verdicts counted for this run/)).toBeInTheDocument();
    expect(screen.getByText(/no per-event detail in the payload/)).toBeInTheDocument();
  });

  it('DISCRIMINATES: when the array carries the same verdicts, no such line appears', () => {
    // The pairing that proves the line above is conditional on the MISMATCH and
    // not on any fail-closed verdict — the ordinary payload (both sources
    // populated from one row set) lists its events and says nothing extra.
    render(
      <RunTrustPanel
        trust={summary({
          revoked: [revocation('revoked_at_or_after', 'a'), revocation('revoked_time_unverifiable', 'b')],
          keyRevocationRevokedAtOrAfter: 1,
          keyRevocationRevokedTimeUnverifiable: 1,
        })}
      />,
    );
    expect(statValue('Revoked')).toBe('2');
    expect(screen.queryByText(/no per-event detail/)).toBeNull();
  });

  it('DISCRIMINATES: a counters-only PRE-COMPROMISE payload stays green', () => {
    // Authorized history is not a violation from the counters either — the
    // fail-closed reading must not become "any non-zero counter is bad".
    const { container } = render(
      <RunTrustPanel trust={summary({ revoked: [], keyRevocationPreCompromise: 4 })} />,
    );
    expect(hasOkIcon(container)).toBe(true);
    expect(hasDangerIcon(container)).toBe(false);
    expect(statValue('Revoked')).toBe('0');
    expect(screen.queryByText(/no per-event detail/)).toBeNull();
  });
});
