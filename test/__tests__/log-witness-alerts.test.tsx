// ══════════════════════════════════════════════════════════════════════
// The transparency-log alert worklist (#84).
//
// The control plane has been recording these detections durably all along; the
// console had no surface for them, so an operator's only way to learn that a
// registry's log had a root mismatch was to read the database. Everything
// asserted below is about the worklist saying WHAT it knows and not more:
//
//   - a reason it does not recognise still renders, verbatim
//   - `detail` is jsonb, so its message is read through a string guard and
//     never through `String(detail)`
//   - `at: null` is a fact ("not recorded"), not an empty cell
//   - acknowledged and open are different operational states
//   - the acknowledger is an API-KEY FINGERPRINT and must not read as a person
//   - an empty worklist is NOT an all-clear about logs nobody witnessed
//   - the error copy must not blame an admin scope this endpoint never checks
//
// The hook is mocked per `CLAUDE.md` so each state renders deterministically.
// ══════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ApiError } from '@/lib/api/fetcher';
import type { LogWitnessAlertRow } from '@/lib/types';

// The mock FORWARDS ITS ARGUMENTS. A zero-arg passthrough would make every
// assertion about which listing the component asks for vacuous — the component
// could request the unacknowledged-only listing and the spy would never know.
const useLogWitnessAlerts = vi.fn();
vi.mock('@/lib/hooks/use-security', () => ({
  useLogWitnessAlerts: (...args: unknown[]) => useLogWitnessAlerts(...args),
}));

import { LogWitnessAlerts } from '@/components/registries/log-witness-alerts';

function row(over: Partial<LogWitnessAlertRow> = {}): LogWitnessAlertRow {
  return {
    authority: 'registry-c.playground.local',
    logId: 'registry-c.playground.local/log/v1',
    lastWitnessedSize: 100,
    lastRootHash: 'sha256:abc',
    reason: 'root_mismatch',
    detail: { error: 'two distinct roots witnessed at tree_size 100' },
    at: '2026-09-27T10:00:00.000Z',
    acknowledgedAt: null,
    acknowledgedBy: null,
    consecutiveFailures: 2,
    ...over,
  };
}

function renderWith(state: {
  data?: { data: LogWitnessAlertRow[]; total: number };
  error?: unknown;
  isLoading?: boolean;
}) {
  useLogWitnessAlerts.mockReturnValue({
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
    data: state.data,
  });
  return render(<LogWitnessAlerts />);
}

function section(): HTMLElement {
  const el = screen.getByText('Witness alert worklist').closest('.card');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function rows(rs: LogWitnessAlertRow[]) {
  return { data: rs, total: rs.length };
}

afterEach(() => {
  cleanup();
  useLogWitnessAlerts.mockReset();
});

describe('witness alert worklist — every reason is readable as text', () => {
  const REASONS: Array<[string, string]> = [
    ['checkpoint_invalid', 'Checkpoint invalid'],
    ['checkpoint_signature_invalid', 'Checkpoint signature invalid'],
    ['tree_size_regression', 'Tree size went backwards'],
    ['root_mismatch', 'Root mismatch (split view)'],
    ['consistency_failed', 'Consistency proof failed'],
    ['log_id_changed', 'Log ID changed'],
  ];

  it.each(REASONS)('%s renders as visible text', (reason, label) => {
    renderWith({ data: rows([row({ reason })]) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('the six labels are distinct, so none of them is a shared fallback', () => {
    // Without this, mapping every reason to one string would pass all six
    // assertions above.
    const labels = REASONS.map(([, l]) => l);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('renders an UNRECOGNISED reason verbatim, and keeps the row', () => {
    // The column is varchar(64) with no CHECK constraint, so a newer control
    // plane can send a seventh reason. Dropping the row — or blanking the cell
    // — would hide a transparency-log alert, which is the one thing this table
    // exists not to do.
    renderWith({ data: rows([row({ reason: 'quantum_desynchronisation' })]) });
    expect(screen.getByText('quantum_desynchronisation')).toBeInTheDocument();
    expect(section().querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders a NULL reason as a named absence, not an empty cell', () => {
    renderWith({ data: rows([row({ reason: null })]) });
    expect(screen.getByText('Reason not recorded')).toBeInTheDocument();
  });
});

describe('witness alert worklist — detail is jsonb, not a string', () => {
  it('renders detail.error when it is a string', () => {
    renderWith({ data: rows([row({ detail: { error: 'consistency proof 5→9 failed' } })]) });
    expect(screen.getByText('consistency proof 5→9 failed')).toBeInTheDocument();
  });

  it('renders NO [object Object] when detail.error is not a string', () => {
    // `String(detail)` is the defect this guards. Asserted over the whole
    // section rather than one cell, because the blob could leak into any of
    // them.
    renderWith({
      data: rows([row({ detail: { error: { nested: 'oops' } } as Record<string, unknown> })]),
    });
    expect(section().textContent).not.toContain('[object Object]');
    // …and the row survives: an unreadable detail is not a reason to hide an
    // alert.
    expect(section().querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders NO [object Object] when detail itself is null', () => {
    renderWith({ data: rows([row({ detail: null })]) });
    expect(section().textContent).not.toContain('[object Object]');
    expect(section().textContent).not.toContain('null');
    expect(section().querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('witness alert worklist — a null timestamp is a fact, not a blank', () => {
  it('renders "Time not recorded" rather than an empty cell or Invalid Date', () => {
    // This row SORTS FIRST upstream (Postgres puts NULLs first), so it is the
    // first thing an operator reads.
    renderWith({ data: rows([row({ at: null })]) });
    expect(screen.getByText('Time not recorded')).toBeInTheDocument();
    expect(section().textContent).not.toContain('Invalid Date');
    expect(section().textContent).not.toContain('NaN');
  });

  it('DISCRIMINATES: a dated row does not say "not recorded"', () => {
    renderWith({ data: rows([row({ at: '2026-09-27T10:00:00.000Z' })]) });
    expect(screen.queryByText('Time not recorded')).toBeNull();
  });
});

describe('witness alert worklist — acknowledged and open are different states', () => {
  it('renders them distinguishably', () => {
    renderWith({
      data: rows([
        row({ authority: 'open.example.com', acknowledgedAt: null, acknowledgedBy: null }),
        row({
          authority: 'done.example.com',
          acknowledgedAt: '2026-09-27T09:00:00.000Z',
          acknowledgedBy: 'ab12cd34...',
        }),
      ]),
    });
    const trs = section().querySelectorAll('tbody tr');
    expect(trs).toHaveLength(2);
    expect(within(trs[0] as HTMLElement).getByText('Open')).toBeInTheDocument();
    expect(within(trs[1] as HTMLElement).getByText('Acknowledged')).toBeInTheDocument();
    // Structurally different too, not merely different words in the same slot.
    expect((trs[0] as HTMLElement).textContent).not.toContain('Acknowledged');
    expect((trs[1] as HTMLElement).textContent).not.toContain('Open');
  });

  it('labels the acknowledger as a KEY, never as a person', () => {
    // Upstream's `acknowledgedBy` is `req.actorId ?? 'admin'`, and `actorId` is
    // `token.slice(0, 8) + '...'` — a truncated API-key fingerprint. Copy that
    // implied a human ("Acknowledged by ab12cd34...") would be an identity
    // claim the control plane never made.
    renderWith({
      data: rows([row({ acknowledgedAt: '2026-09-27T09:00:00.000Z', acknowledgedBy: 'ab12cd34...' })]),
    });
    const text = section().textContent ?? '';
    expect(text).toContain('key ab12cd34...');
    expect(text).not.toMatch(/acknowledged by (?!key)/i);
    expect(text).not.toMatch(/\bby user\b|\bby operator\b/i);
  });

  it('an acknowledged row with no acknowledger renders no dangling label', () => {
    renderWith({
      data: rows([row({ acknowledgedAt: '2026-09-27T09:00:00.000Z', acknowledgedBy: null })]),
    });
    const text = section().textContent ?? '';
    expect(text).toContain('Acknowledged');
    expect(text).not.toContain('key null');
    expect(text).not.toMatch(/·\s*key\s*$/);
  });
});

describe('witness alert worklist — the empty state claims nothing it cannot', () => {
  it('says no alert is RECORDED, not that the logs are healthy', () => {
    // The worklist lists only alerting authorities. A registry the control
    // plane has never witnessed produces no row either way, so "healthy" would
    // be a verdict drawn from an absence — the defect class this whole plan
    // exists to remove.
    renderWith({ data: rows([]) });
    const text = section().textContent ?? '';
    expect(screen.getByText('No alert is currently recorded')).toBeInTheDocument();
    expect(text).not.toMatch(/healthy/i);
    expect(text).not.toMatch(/all (logs|registries) (are )?(ok|fine|verified)/i);
    expect(text).not.toMatch(/no (problems|issues)\b/i);
    // And it says so positively: an authority never witnessed is not covered.
    expect(text).toMatch(/never witnessed/i);
  });

  it('DISCRIMINATES: a populated worklist renders no empty state', () => {
    renderWith({ data: rows([row()]) });
    expect(screen.queryByText('No alert is currently recorded')).toBeNull();
    expect(section().querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('witness alert worklist — the error copy blames nothing it cannot read', () => {
  it('a 403 renders the GENERIC panel, with no admin-scope copy', () => {
    // Unlike `/auth/revocations`, this endpoint has NO admin guard upstream —
    // it is tenant-scoped behind the global guard whose bearer the proxy
    // injects. The revocation feed's "grant the key admin scope" copy would
    // send an operator to fix something that was never the cause.
    //
    // `fromUpstream: true` — the FIFTH argument — is what makes this test able
    // to fail. `operatorErrorMessage` short-circuits to the console-fault copy
    // when `fromUpstream` is false and never reaches its 403 arm at all, so a
    // console-minted 403 asserts the absence of admin wording from a path that
    // could not emit it whatever the component did. The realistic defect is a
    // future "make this consistent with the revocation feed" edit gated on
    // `isUpstreamForbidden`, which is true only for a STAMPED 403.
    renderWith({
      error: new ApiError(403, JSON.stringify({ message: 'nope' }), 'control-plane', '/x', true),
    });
    const text = section().textContent ?? '';
    expect(text).not.toContain('CONTROL_PLANE_API_KEY');
    expect(text).not.toMatch(/admin scope|admin key|grant .* admin/i);
    expect(section().querySelectorAll('tbody tr')).toHaveLength(0);
    // Anti-vacuity: the 403 arm really was reached, so the assertions above
    // ran against the copy an operator sees rather than against the generic
    // console-fault sentence.
    expect(text).toMatch(/not authorized by the control plane/i);
  });

  it('an UNSTAMPED 403 still renders the console-fault copy, not admin copy', () => {
    // The other half of the pair: a 403 the console minted itself (no proxy
    // stamp) must not be reported as the control plane refusing us.
    renderWith({
      error: new ApiError(403, JSON.stringify({ message: 'nope' }), 'control-plane', '/x'),
    });
    const text = section().textContent ?? '';
    expect(text).not.toContain('CONTROL_PLANE_API_KEY');
    expect(text).not.toMatch(/admin scope|admin key|grant .* admin/i);
  });

  it('renders the error DIAGNOSTIC, so the panel carries the detail', () => {
    // `details={errorDiagnostic(...)}` was unpinned: dropping the prop left the
    // whole suite green while an operator lost the status/service/path line.
    renderWith({
      error: new ApiError(503, 'upstream down', 'control-plane', '/registries/log-witness/alerts', true),
    });
    const text = section().textContent ?? '';
    expect(text).toContain('503');
    expect(text).toContain('control-plane');
  });

  it('renders an error panel at all, so a failure is not silent', () => {
    renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x') });
    expect(section().textContent).toMatch(/could not load the witness alert worklist/i);
  });

  it('never renders the empty state and an error together', () => {
    // A failed fetch has zero rows, so a naive `rows.length === 0` would render
    // "No alert is currently recorded" underneath the error — claiming an
    // all-clear from a request that never answered.
    renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x') });
    expect(screen.queryByText('No alert is currently recorded')).toBeNull();
  });

  it('never renders the empty state while still loading', () => {
    renderWith({ isLoading: true });
    expect(screen.queryByText('No alert is currently recorded')).toBeNull();
  });
});

describe('witness alert worklist — disclosure rules', () => {
  it('discloses nothing through a title tooltip', () => {
    // `CLAUDE.md`: a tooltip is invisible on touch, invisible to the keyboard
    // and unreliably announced, so a trust surface that only discloses on
    // hover is treated as not disclosing at all.
    renderWith({
      data: rows([
        row({ reason: 'log_id_changed', at: null }),
        row({ authority: 'b.example.com', acknowledgedAt: '2026-09-27T09:00:00.000Z', acknowledgedBy: 'k...' }),
      ]),
    });
    expect(section().querySelectorAll('[title]')).toHaveLength(0);
  });

  it('carries the reason in TEXT, not only in a chip colour', () => {
    // Colour alone is invisible to a screen reader, to greyscale and to a
    // printout — the `freshQuorumVerdict` rule, one component over.
    renderWith({ data: rows([row({ reason: 'consistency_failed' })]) });
    const cells = [...section().querySelectorAll('tbody td')].map((c) => c.textContent);
    expect(cells).toContain('Consistency proof failed');
  });

  it('renders one row per authority', () => {
    // Deliberately NOT titled "…keyed so two authorities never collapse". The
    // mutation sweep set every row's React key to the same literal and all 27
    // tests stayed green: duplicate keys surface during reconciliation, not in
    // a single static render, so @testing-library cannot see them here. The
    // key is still right (`row.authority` is the table's primary key upstream),
    // but this test does not establish that and must not say it does.
    renderWith({
      data: rows([
        row({ authority: 'a.example.com' }),
        row({ authority: 'b.example.com' }),
        row({ authority: 'c.example.com' }),
      ]),
    });
    expect(section().querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows the consecutive-failure count, including zero', () => {
    // `0` is meaningful and is the COMMON case for a dishonesty alert, not a
    // recovery story: the counter tracks ENVIRONMENTAL failures only
    // (`0016_log_witness.sql` — "Dishonesty signals do NOT count here"), and
    // only `recordFailureSafe` increments it, so a root-mismatch row raised by
    // `markAlert` sits at whatever the transport counter last was, typically 0.
    // (An earlier version of this comment called `0` "an acknowledged alert
    // whose cursor has since recovered" — that is wrong twice over: recovery
    // runs through `advanceCursor`, which sets `alerted = false` and drops the
    // row from the worklist entirely.) Rendering nothing for `0` would make a
    // real value look like missing data.
    renderWith({ data: rows([row({ consecutiveFailures: 0 })]) });
    const cells = [...section().querySelectorAll('tbody td')].map((c) => c.textContent);
    expect(cells).toContain('0');
  });
});

describe('witness alert worklist — it asks for the listing its copy describes', () => {
  it('requests ACKNOWLEDGED ROWS TOO, because acknowledged does not mean resolved', () => {
    // The load-bearing one. Upstream's `acknowledgeAlert` leaves `alerted =
    // true`; only `advanceCursor` clears the condition. Asking for the default
    // unacknowledged-only listing would hide still-outstanding detections on
    // the one screen built to surface them — and the empty state below would
    // then assert an all-clear that is false.
    renderWith({ data: rows([row()]) });
    expect(useLogWitnessAlerts).toHaveBeenCalled();
    expect(useLogWitnessAlerts.mock.calls.at(-1)?.[0]).toBe(true);
  });

  it('the empty state does not claim an all-clear it cannot establish', () => {
    renderWith({ data: rows([]) });
    const text = section().textContent ?? '';
    // It must say the listing spans both states — that is only true because of
    // the assertion above, and the two move together.
    expect(text).toMatch(/acknowledged or not/i);
    // …and it must NOT report health for logs nobody ever witnessed — not even
    // inside a denial. This matcher cannot read negation, and neither can a
    // reader skimming the sentence, so the reassuring words must simply be
    // absent.
    expect(text).not.toMatch(/logs? (are|is) healthy|all clear|everything is fine/i);
    expect(text).toMatch(/never witnessed/i);
  });
});

describe('witness alert worklist — the State column actually varies', () => {
  it('renders Acknowledged, with the acknowledger labelled as a KEY', () => {
    // B2: before the listing included acknowledged rows this branch was
    // unreachable on the shipped surface — `<th>State</th>` named a constant
    // and the "key not a person" labelling was exercised only through a mock.
    renderWith({
      data: rows([
        row({ acknowledgedAt: '2026-09-27T11:00:00.000Z', acknowledgedBy: 'ak_7f3c1...' }),
      ]),
    });
    const text = section().textContent ?? '';
    expect(text).toContain('Acknowledged');
    expect(text).toContain('key ak_7f3c1...');
    expect(text).not.toContain('Open');
  });

  it('renders Open for an unacknowledged row, in the same table', () => {
    renderWith({
      data: rows([
        row({ authority: 'open.example.com' }),
        row({
          authority: 'acked.example.com',
          acknowledgedAt: '2026-09-27T11:00:00.000Z',
          acknowledgedBy: 'ak_7f3c1...',
        }),
      ]),
    });
    const text = section().textContent ?? '';
    // Both states on one screen is the point of the column.
    expect(text).toContain('Open');
    expect(text).toContain('Acknowledged');
  });
});

describe('witness alert worklist — the header row means what the cells hold', () => {
  it('names all six columns, in the order the cells are rendered', () => {
    // The whole `<thead>` was unguarded: deleting `<th>State</th>`, or swapping
    // `Reason` and `Detail` so the detail text sits under a "Reason" heading,
    // left the entire suite green. On a surface whose stated job is saying
    // WHICH registry is alerting and WHY, a header that does not match its
    // column is an operator-visible honesty defect, not a cosmetic one.
    //
    // PR G's caption gate checks caption-vs-header; nothing checked
    // header-vs-cell. This is that check.
    renderWith({ data: rows([row()]) });
    const headers = [...section().querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).toEqual([
      'Authority',
      'Reason',
      'Detail',
      // "environmental" is load-bearing: the counter tracks transport failures
      // only, so unqualified beside "Root mismatch (split view)" the number
      // reads as this alert's recurrence count. Pinned so the qualification
      // cannot quietly revert.
      'Consecutive environmental failures',
      'Detected',
      'State',
    ]);
  });

  it('each header sits above the cell that carries that fact', () => {
    // Header text alone is not enough — it must be above the right column.
    renderWith({
      data: rows([
        row({
          authority: 'hdr.example.com',
          reason: 'root_mismatch',
          detail: { error: 'a readable detail' },
          consecutiveFailures: 4,
          acknowledgedAt: null,
        }),
      ]),
    });
    const headers = [...section().querySelectorAll('thead th')].map((h) => h.textContent ?? '');
    const cells = [...section().querySelectorAll('tbody tr td')].map((c) => c.textContent ?? '');
    const at = (name: string) => cells[headers.indexOf(name)];
    expect(at('Authority')).toBe('hdr.example.com');
    expect(at('Reason')).toBe('Root mismatch (split view)');
    expect(at('Detail')).toBe('a readable detail');
    expect(at('Consecutive environmental failures')).toBe('4');
    expect(at('State')).toContain('Open');
  });
});

describe('witness alert worklist — it says WHICH registry is alerting', () => {
  it('renders the authority in FULL, not truncated at the first dot', () => {
    // N1: the worklist exists to cover authorities the console does not proxy,
    // and `shortAuthority` would render these two identically — on the screen
    // where telling them apart is the entire task.
    renderWith({
      data: rows([
        row({ authority: 'registry-a.playground.local' }),
        row({ authority: 'registry-a.corp.example' }),
      ]),
    });
    const cells = [...section().querySelectorAll('tbody tr td:first-child')].map(
      (c) => c.textContent,
    );
    expect(cells).toEqual(['registry-a.playground.local', 'registry-a.corp.example']);
    expect(new Set(cells).size).toBe(2);
  });
});

describe('witness alert worklist — an unreadable detail is not "no detail"', () => {
  it('distinguishes a missing blob from one whose error is not a string', () => {
    renderWith({
      data: rows([
        row({ authority: 'none.example.com', detail: null }),
        row({ authority: 'unreadable.example.com', detail: { error: { nested: 'object' } } }),
        row({ authority: 'message.example.com', detail: { error: 'a readable message' } }),
      ]),
    });
    const detailCells = [...section().querySelectorAll('tbody tr td:nth-child(3)')].map(
      (c) => c.textContent,
    );
    expect(detailCells).toEqual(['—', 'Detail not readable', 'a readable message']);
    // Never `[object Object]`, which is what `String(detail.error)` would give.
    expect(section().textContent).not.toContain('[object Object]');
  });
});
