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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { LogWitnessAlertRow } from '@/lib/types';

// The mock FORWARDS ITS ARGUMENTS. A zero-arg passthrough would make every
// assertion about which listing the component asks for vacuous — the component
// could request the unacknowledged-only listing and the spy would never know.
const useLogWitnessAlerts = vi.fn();
vi.mock('@/lib/hooks/use-security', () => ({
  useLogWitnessAlerts: (...args: unknown[]) => useLogWitnessAlerts(...args),
}));

// The ack is a WRITE. Mocking the client (rather than `fetch`) is what lets
// "was a request issued at all?" be asserted directly — the confirm gate is
// only meaningful if its violation is observable.
const acknowledgeLogWitnessAlert = vi.fn();
vi.mock('@/lib/api/client', () => ({
  acknowledgeLogWitnessAlert: (...args: unknown[]) => acknowledgeLogWitnessAlert(...args),
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

/**
 * The two empty-state titles, shared so a rename cannot empty a guard.
 *
 * Two `queryByText('No alert is currently recorded')` assertions spent a commit
 * pinning a string the component no longer rendered — the component's own edit
 * renamed it, and nothing connected the two. A guard asserting the ABSENCE of
 * text is exactly the kind that goes vacuous silently, so its subject has to be
 * the same object the positive assertions use.
 */
const EMPTY_TITLE_ALL = 'No alert is recorded at all';
const EMPTY_TITLE_FILTERED = 'No unacknowledged alert is recorded';

let queryClient: QueryClient;

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
  return render(
    <QueryClientProvider client={queryClient}>
      <LogWitnessAlerts />
    </QueryClientProvider>,
  );
}

function section(): HTMLElement {
  const el = screen.getByText('Witness alert worklist').closest('.card');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function rows(rs: LogWitnessAlertRow[]) {
  return { data: rs, total: rs.length };
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  acknowledgeLogWitnessAlert.mockReset();
});

afterEach(() => {
  cleanup();
  useLogWitnessAlerts.mockReset();
  // The store is a module-level Zustand singleton and persists across tests in
  // a file. One test sets `demoMode` to assert the write reads it; leaving that
  // set would change the default every test after it sees.
  usePreferencesStore.setState({ demoMode: true });
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
    // The title is a function of the filter too — "at all" is only sayable
    // because the default listing includes acknowledged rows.
    expect(screen.getByText(EMPTY_TITLE_ALL)).toBeInTheDocument();
    expect(text).not.toMatch(/healthy/i);
    expect(text).not.toMatch(/all (logs|registries) (are )?(ok|fine|verified)/i);
    expect(text).not.toMatch(/no (problems|issues)\b/i);
    // And it says so positively: an authority never witnessed is not covered.
    expect(text).toMatch(/never witnessed/i);
  });

  it('DISCRIMINATES: a populated worklist renders no empty state', () => {
    renderWith({ data: rows([row()]) });
    expect(screen.queryByText(EMPTY_TITLE_ALL)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE_FILTERED)).toBeNull();
    expect(section().querySelectorAll('tbody tr')).toHaveLength(1);
  });

  // ── The FILTERED arm. It shipped with nothing asserting it at all: four
  // mutations — making the title constant across arms, making the description
  // constant, replacing the filtered description with the full one, and giving
  // the filtered arm the full arm's title — all survived the whole suite. The
  // commit that added it claimed "both arms are asserted".
  //
  // The arm is only reachable through the toggle, which is why it was missed:
  // `renderWith` fixes the hook's return, so the copy changes but the data does
  // not — exactly the state an operator reaches by filtering an empty list.
  it('the FILTERED empty state says which listing produced the emptiness', () => {
    renderWith({ data: rows([]) });
    fireEvent.click(screen.getByRole('button', { name: /hide acknowledged/i }));
    const text = section().textContent ?? '';
    expect(screen.getByText(EMPTY_TITLE_FILTERED)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE_ALL)).toBeNull();
    // It must say that acknowledged alerts exist as a category and are being
    // withheld HERE — the whole difference between the two arms.
    expect(text).toMatch(/UNACKNOWLEDGED/);
    expect(text).toMatch(/acknowledged alerts are still alerts and are hidden in this view/i);
    // And it keeps the never-witnessed caveat, which is true of both arms.
    expect(text).toMatch(/never witnessed/i);
    // The same prohibitions as the default arm: a filtered emptiness is even
    // further from an all-clear than a full one.
    expect(text).not.toMatch(/healthy/i);
    expect(text).not.toMatch(/no (problems|issues)\b/i);
  });

  it('DISCRIMINATES: the two empty arms do not share a title OR a description', () => {
    // The mutation that survived was "make the copy constant across arms",
    // which every single-arm assertion passes. This is the pair that cannot.
    renderWith({ data: rows([]) });
    const full = section().textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: /hide acknowledged/i }));
    const filtered = section().textContent ?? '';
    expect(filtered).not.toBe(full);
    expect(EMPTY_TITLE_FILTERED).not.toBe(EMPTY_TITLE_ALL);
    // Not merely different somewhere — different in the sentence that states
    // the SCOPE, which is the one a reader draws the conclusion from.
    expect(full).toMatch(/acknowledged or not/i);
    expect(filtered).not.toMatch(/acknowledged or not/i);
  });

  it('the card subtitle changes with the view too, so the card cannot contradict itself', () => {
    // It said "acknowledged alerts stay listed until the condition clears" in
    // both views. In the filtered one that rendered directly above an empty
    // state saying they "are hidden in this view" — two adjacent elements of
    // one card asserting opposite things about the same rows.
    renderWith({ data: rows([]) });
    expect(section().textContent).toMatch(/acknowledged alerts stay listed until the condition clears/i);
    fireEvent.click(screen.getByRole('button', { name: /hide acknowledged/i }));
    const filtered = section().textContent ?? '';
    expect(filtered).toMatch(/acknowledged alerts are filtered out of this view/i);
    expect(filtered).not.toMatch(/acknowledged alerts stay listed until the condition clears/i);
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
    // the empty state underneath the error — claiming an all-clear from a
    // request that never answered.
    //
    // ASSERTED THROUGH THE SHARED CONSTANTS, not a literal. These two tests
    // spent a commit asserting the absence of `'No alert is currently
    // recorded'`, a string the component had been edited to stop rendering —
    // so both were tautologies over text nothing could produce, and dropping
    // `!alerts.error` / `!alerts.isLoading` from the guard was measured green
    // against the whole 1074-test suite. The constants are what stop a rename
    // from emptying a guard silently: a rename that misses them fails the
    // positive tests above instead of quietly passing here.
    renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x') });
    expect(screen.queryByText(EMPTY_TITLE_ALL)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE_FILTERED)).toBeNull();
    expect(section().textContent).not.toMatch(/never witnessed/i);
  });

  it('never renders the empty state while still loading', () => {
    renderWith({ isLoading: true });
    expect(screen.queryByText(EMPTY_TITLE_ALL)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE_FILTERED)).toBeNull();
    expect(section().textContent).not.toMatch(/never witnessed/i);
  });

  it('DISCRIMINATES: the same zero-row payload with neither flag DOES render it', () => {
    // Without this the two guards above pass against a component that renders
    // no empty state under any condition.
    renderWith({ data: rows([]) });
    expect(screen.getByText(EMPTY_TITLE_ALL)).toBeInTheDocument();
    expect(section().textContent).toMatch(/never witnessed/i);
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
      // Phase 3's column. The header is `Acknowledge`; the CELL's control is
      // labelled per row ("Acknowledge <authority>" / "Re-acknowledge …"), so
      // the two are checked separately.
      'Acknowledge',
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

// ══════════════════════════════════════════════════════════════════════
// Acknowledging one alert (#84, phase 3 of 3).
//
// "Acknowledge" is the most over-read word on this page. Upstream makes it
// three things it is not — it does not clear the alert, it does not name a
// person, and it hides an ONGOING detection whose reason has not changed — so
// the confirm step exists to say all three, and these tests exist to keep it
// saying them. The gate itself is asserted the only way that falsifies it: by
// checking no request was issued before confirming.
// ══════════════════════════════════════════════════════════════════════
function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

function openConfirm(authority = 'registry-c.playground.local') {
  // `fireEvent`, matching every other component test in this suite —
  // `@testing-library/user-event` is not a dependency here.
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(`acknowledge ${authority.replace(/\./g, '\\.')}`, 'i'),
    }),
  );
}

function confirmAck() {
  fireEvent.click(within(dialog()).getByRole('button', { name: /^acknowledge$/i }));
}

describe('witness alert worklist — acknowledging is gated on a confirm', () => {
  it('issues NO request when the row control is clicked', async () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    // The dialog is up…
    expect(dialog()).toBeInTheDocument();
    // …and nothing has been sent. This is the whole gate: if the row button
    // called the mutation directly, the dialog would still render and every
    // copy assertion below would still pass.
    expect(acknowledgeLogWitnessAlert).not.toHaveBeenCalled();
  });

  it('issues the request only after the dialog is confirmed, for that authority', async () => {
    acknowledgeLogWitnessAlert.mockResolvedValue({ authority: 'x', alerted: true });
    renderWith({ data: rows([row({ authority: 'registry-c.playground.local' })]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalledTimes(1));
    // The FULL authority, not the shortened display form — the display form is
    // lossy and would address a different row upstream.
    expect(acknowledgeLogWitnessAlert.mock.calls[0][0]).toBe('registry-c.playground.local');
  });

  it('issues NO request when the dialog is cancelled', async () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    fireEvent.click(within(dialog()).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(acknowledgeLogWitnessAlert).not.toHaveBeenCalled();
  });

  it('confirms the row the operator clicked, not the first row', async () => {
    acknowledgeLogWitnessAlert.mockResolvedValue({ authority: 'x', alerted: true });
    renderWith({
      data: rows([row({ authority: 'first.example.com' }), row({ authority: 'second.example.com' })]),
    });
    openConfirm('second.example.com');
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalledTimes(1));
    expect(acknowledgeLogWitnessAlert.mock.calls[0][0]).toBe('second.example.com');
  });

  it('names each row control by its authority, so six of them are distinguishable', () => {
    renderWith({
      data: rows([row({ authority: 'first.example.com' }), row({ authority: 'second.example.com' })]),
    });
    expect(screen.getByRole('button', { name: /acknowledge first\.example\.com/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /acknowledge second\.example\.com/i })).toBeInTheDocument();
  });
});

describe('witness alert worklist — the confirm says what an ack is NOT', () => {
  it('states that the alert is not cleared', async () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    const text = dialog().textContent ?? '';
    expect(text).toMatch(/not clear the alert/i);
    // And says what DOES clear it, so the fact is actionable rather than just
    // discouraging.
    expect(text).toMatch(/until the control plane witnesses a consistent checkpoint/i);
  });

  it('states that the acknowledger is a key, never a person', async () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    const text = dialog().textContent ?? '';
    expect(text).toMatch(/which key/i);
    expect(text).toMatch(/not a person/i);
  });

  it('states the resurfacing rule, and states it for the view it is shown over', async () => {
    // The trap: an operator acks a root mismatch, the log keeps being detected
    // with the same reason every poll, and the row never announces itself
    // again. Upstream resets `acknowledgedAt` only when the REASON changes.
    //
    // The fact is about the ack; the CONSEQUENCE is about the view, and this
    // bullet asserted the filtered view's consequence unconditionally. Written
    // when the default listing was unacknowledged-only, it survived the default
    // being flipped and then told an operator, on the default screen, that the
    // row "leaves this worklist" and "stays hidden until you use Show
    // acknowledged above" — while the row stayed, nothing was hidden, and the
    // control it named was labelled "Hide acknowledged". Three false claims on
    // the one control that writes.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const shown = dialog().textContent ?? '';
    expect(shown).toMatch(/different/i);
    expect(shown).toMatch(/same/i);
    // Default view: the row STAYS, and the dialog must not send the operator to
    // a control that is not on screen.
    expect(shown).toMatch(/stays<?\/?\w*>? in this worklist|\bstays\b.{0,40}in this worklist/i);
    expect(shown).not.toMatch(/stays hidden/i);
    expect(shown).not.toMatch(/use Show acknowledged above/i);
    expect(screen.queryByRole('button', { name: 'Show acknowledged' })).toBeNull();

    // Filtered view: the row DOES leave this view, the control IS on screen,
    // and the dialog says both.
    fireEvent.click(screen.getByRole('button', { name: /hide acknowledged/i }));
    openConfirm();
    const filtered = dialog().textContent ?? '';
    expect(filtered).toMatch(/leaves this view/i);
    expect(filtered).toMatch(/does not leave the worklist/i);
    expect(filtered).toMatch(/stays hidden from this view/i);
    expect(filtered).toMatch(/Show acknowledged/);
    expect(screen.getByRole('button', { name: 'Show acknowledged' })).toBeInTheDocument();
  });

  it('DISCRIMINATES: the two arms of that bullet are different text', () => {
    // A constant bullet across both views is what shipped, so a single-arm
    // assertion cannot be the guard here.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const shown = dialog().textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /hide acknowledged/i }));
    openConfirm();
    expect(dialog().textContent).not.toBe(shown);
  });

  it('names the authority and its current reason in the dialog', async () => {
    renderWith({ data: rows([row({ reason: 'tree_size_regression' })]) });
    openConfirm();
    const text = dialog().textContent ?? '';
    expect(text).toContain('registry-c.playground.local');
    expect(text).toContain('Tree size went backwards');
  });

  it('captions the dialog with the FULL authority, not the short form', async () => {
    // Deliberate, and unpinned: truncating the title to `shortAuthority` left
    // the suite green because the assertion above is satisfied by the body
    // paragraph alone. `shortAuthority` cuts at the first dot, so
    // `registry-a.corp.example` and `registry-a.playground.local` would be
    // captioned identically — on the one control on this page that writes.
    renderWith({ data: rows([row({ authority: 'registry-a.corp.example' })]) });
    openConfirm('registry-a.corp.example');
    const heading = within(dialog()).getByRole('heading');
    expect(heading.textContent).toBe('Acknowledge registry-a.corp.example');
    expect(heading.textContent).not.toBe('Acknowledge registry-a');
  });
});

describe('witness alert worklist — the ack control does not pretend to know the caller’s scope', () => {
  it('renders the control on every row, acknowledged or not', () => {
    renderWith({
      data: rows([
        row({ authority: 'open.example.com' }),
        row({
          authority: 'acked.example.com',
          acknowledgedAt: '2026-09-27T09:00:00.000Z',
          acknowledgedBy: 'ab12cd34...',
        }),
      ]),
    });
    // No pre-disabling: no control-plane endpoint reports the caller's own
    // scope, so a disabled button would be a guess — and a wrong guess hides a
    // control that works.
    const btns = screen
      .getAllByRole('button')
      .filter((b) => /acknowledge/i.test(b.getAttribute('aria-label') ?? ''));
    expect(btns).toHaveLength(2);
    expect(btns.every((b) => !b.hasAttribute('disabled'))).toBe(true);
  });

  it('labels an already-acknowledged row “Re-acknowledge”', () => {
    renderWith({
      data: rows([
        row({ acknowledgedAt: '2026-09-27T09:00:00.000Z', acknowledgedBy: 'ab12cd34...' }),
      ]),
    });
    // Upstream's update is `WHERE alerted = true` — not `WHERE acknowledgedAt
    // IS NULL` — so re-acknowledging genuinely works and re-stamps. Disabling
    // it would remove a working action; leaving it saying "Acknowledge" would
    // read as an action with no effect.
    const btn = screen.getByRole('button', { name: /re-acknowledge/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
    // The VISIBLE TEXT, not only the accessible name. `getByRole(… name)` reads
    // `aria-label`, so only the label was pinned: regressing the rendered word
    // back to a constant "Acknowledge" left the suite green, producing a
    // label-in-name mismatch (WCAG 2.5.3 — a speech-input user saying the
    // visible word activates nothing) and removing the affordance this arm
    // exists for.
    expect(btn.textContent).toBe('Re-acknowledge');
  });

  it('DISCRIMINATES: an open row says “Acknowledge”, not “Re-acknowledge”', () => {
    renderWith({ data: rows([row({ acknowledgedAt: null })]) });
    expect(screen.queryByRole('button', { name: /re-acknowledge/i })).toBeNull();
    const btn = screen.getByRole('button', { name: /acknowledge registry-c/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe('Acknowledge');
  });

  it('passes the CURRENT demo-mode flag to the write, not a hardcoded one', async () => {
    // Unpinned: hardcoding `demoMode: false` at the only call site left the
    // suite green. Demo mode is the DEFAULT product configuration
    // (`NEXT_PUBLIC_ACDP_UI_DEMO_MODE` defaults true), so that mutation makes
    // the console issue a real network POST — a write — from a build whose
    // whole premise is that it talks to nothing.
    acknowledgeLogWitnessAlert.mockResolvedValue(undefined);
    usePreferencesStore.setState({ demoMode: true });
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalled());
    expect(acknowledgeLogWitnessAlert).toHaveBeenCalledWith('registry-c.playground.local', true);

    // DISCRIMINATES: and it really is read from the store rather than being a
    // hardcoded `true`.
    cleanup();
    acknowledgeLogWitnessAlert.mockClear();
    usePreferencesStore.setState({ demoMode: false });
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalled());
    expect(acknowledgeLogWitnessAlert).toHaveBeenCalledWith('registry-c.playground.local', false);
  });
});

describe('witness alert worklist — the two designed failure paths', () => {
  it('a 403 is the ONE place the admin-scope copy is correct, and it stays in the dialog', async () => {
    // Acknowledging IS `actorIsAdmin`-gated upstream, unlike reading the
    // worklist. The table's own 403 copy must stay generic (asserted above);
    // this one must not be.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(403, JSON.stringify({ message: 'admin-only' }), 'control-plane', '/x', true),
    );
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/refused it/i));
    expect(dialog().textContent).toMatch(/admin/i);
    // The dialog stays OPEN so the operator can read why. A dialog that closed
    // on failure would leave the table looking unchanged with no explanation.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a 404 is rendered as the alert having RESOLVED, not as a failure', async () => {
    // `acknowledgeAlert` updates `WHERE alerted = true`, so a 404 means the
    // condition cleared between render and click. Calling that an error would
    // send an operator after a registry that just got better.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(404, JSON.stringify({ errorCode: 'REGISTRY_NOT_FOUND' }), 'control-plane', '/x', true),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));
    expect(dialog().textContent).not.toMatch(/could not record/i);

    // THE REFETCH HAPPENS ON CLOSE, NOT ON ARRIVAL, and this test asserted the
    // opposite for a commit. Invalidating inside `onError` destroyed the
    // explanation it was there to support: a 404 means upstream already ran
    // `advanceCursor`, so the row is gone from both listings, the refetch
    // emptied `rows`, the parent's `rows.find(...)` went null, and this dialog
    // unmounted before the operator could read any of it. The three assertions
    // in this block passed only because the hook is mocked with a constant —
    // they described a state unreachable in production on the one path that
    // produces it.
    const isAlertsKey = () =>
      invalidate.mock.calls.some((c) => JSON.stringify(c[0] ?? {}).includes('log-witness-alerts'));
    expect(isAlertsKey()).toBe(false);
    // …and the dialog is still standing, which is the point.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(isAlertsKey()).toBe(true));
  });

  it('DISCRIMINATES: a 403 does NOT refetch, on close or otherwise', async () => {
    // The sibling that keeps the assertion above from passing on a component
    // that simply never refetches. A 403 changed nothing upstream, so the read
    // would only repeat itself.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(403, JSON.stringify({ message: 'admin-only' }), 'control-plane', '/x', true),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/refused it/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      invalidate.mock.calls.some((c) => JSON.stringify(c[0] ?? {}).includes('log-witness-alerts')),
    ).toBe(false);
  });

  it('an UNSTAMPED 403 on the ack does NOT get the admin-scope copy either', async () => {
    // The missing half of the pair. The read path has both (`fromUpstream`
    // true and false); the ack path shipped with only the stamped half, so
    // regressing `isUpstreamForbidden(mut.error)` to a bare `status === 403`
    // killed nothing — measured green against the whole suite.
    //
    // It matters here more than on the read path: the proxy's own allow-list
    // mints a 403 for a malformed authority without ever reaching the control
    // plane, and telling the operator to widen the deployment key's scope in
    // response would send them to change a credential over a path typo.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(403, JSON.stringify({ message: 'nope' }), 'control-plane', '/x'),
    );
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/could not record the acknowledgement/i));
    const text = dialog().textContent ?? '';
    expect(text).not.toMatch(/admin scope|admin key|grant .* admin/i);
    expect(text).not.toMatch(/refused it/i);
  });

  it('withdraws the confirm action once the alert is gone', async () => {
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(404, JSON.stringify({ errorCode: 'REGISTRY_NOT_FOUND' }), 'control-plane', '/x', true),
    );
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert/i));
    // Nothing left to confirm, so the confirm button is gone rather than
    // sitting there inviting a retry that will 404 again…
    expect(within(dialog()).queryByRole('button', { name: /^acknowledge$/i })).toBeNull();
    // …and the remaining control says "Close", not "Cancel": there is no
    // pending action to cancel.
    // `/^close$/` — the modal's own header X is named "Close dialog", and a
    // loose match would pass against that no matter what the footer says.
    expect(within(dialog()).getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });

  it('any OTHER failure still renders a panel, so a write never fails silently', async () => {
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(500, 'boom', 'control-plane', '/x', true),
    );
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/could not record the acknowledgement/i));
    // And it is NOT dressed up as either designed path.
    expect(dialog().textContent).not.toMatch(/no longer an alert/i);
    expect(dialog().textContent).not.toMatch(/refused it/i);
  });

  it('on success it closes the dialog and refetches the worklist', async () => {
    acknowledgeLogWitnessAlert.mockResolvedValue({ authority: 'x', alerted: true });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      invalidate.mock.calls.some((c) => JSON.stringify(c[0] ?? {}).includes('log-witness-alerts')),
    ).toBe(true);
  });
});

describe('witness alert worklist — acknowledged rows stay reachable', () => {
  function lastIncludeAcknowledged() {
    return useLogWitnessAlerts.mock.calls.at(-1)?.[0];
  }

  it('asks for the FULL listing by default — the filter narrows, it does not open up', () => {
    // Deliberately the opposite of what this test asserted when the toggle was
    // written. Acknowledging does not resolve an alert upstream, so defaulting
    // to the unacknowledged-only listing would make an ongoing, unchanged
    // detection vanish from this console the moment someone acked it — the
    // defect this worklist's first gate round was about. The filtered view is
    // still one click away for triage; it is just not what the screen asserts
    // before anyone touches it.
    renderWith({ data: rows([row()]) });
    expect(lastIncludeAcknowledged()).toBe(true);
    expect(screen.getByRole('button', { name: /hide acknowledged/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('toggles the listing it REQUESTS, not just the button label, and back', () => {
    renderWith({ data: rows([row()]) });
    const btn = () => screen.getByRole('button', { name: /(show|hide) acknowledged/i });
    // Starts on the full listing, so the first click FILTERS DOWN.
    fireEvent.click(btn());
    expect(lastIncludeAcknowledged()).toBe(false);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    expect(btn()).toHaveTextContent(/show acknowledged/i);
    // …and back. Upstream never resurfaces a row whose reason has not changed,
    // so the way back to an acknowledged-but-still-alerting authority has to
    // change the REQUEST, not just the label — the filtering is server-side.
    fireEvent.click(btn());
    expect(lastIncludeAcknowledged()).toBe(true);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    expect(btn()).toHaveTextContent(/hide acknowledged/i);
  });

  it('renders the control even while loading and while erroring, so the view is never stuck', () => {
    renderWith({ isLoading: true });
    expect(screen.getByRole('button', { name: /hide acknowledged/i })).toBeInTheDocument();
    cleanup();
    renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x') });
    expect(screen.getByRole('button', { name: /hide acknowledged/i })).toBeInTheDocument();
  });
});
