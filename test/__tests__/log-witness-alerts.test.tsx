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
import type {
  AckStage,
  AckListingConsequence,
  AckOutcome,
} from '@/components/registries/log-witness-alerts';
import {
  ADMIN_ROUTE_FORBIDDEN,
  errorDiagnostic,
  operatorErrorMessage,
} from '@/lib/utils/api-error-messages';
import {
  ACK_LISTING,
  ALL_CONSEQUENCES,
  ALL_FOOTER_STATES,
  ALL_OUTCOMES,
  ALL_STAGES,
  ANNOUNCED_TEXT_ATTRS,
  expectedAnnounced,
  expectedDialogBlocks,
  normalize,
  squash,
  type AckFooterState,
} from '@/test/support/witness-ack-prose';

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

/**
 * The acknowledged-listing toggle, found by its ROLE STATE rather than by its
 * text.
 *
 * Deliberately NOT `getByRole('button', { name: /acknowledged shown/i })`. The
 * label is itself under test — it inverted under `aria-pressed` and round 4
 * changed it — and a locator that hardcodes the label makes every assertion
 * about the label circular: relabel the control and the locator follows it,
 * silently, into whatever the new text is.
 *
 * `aria-pressed` is the structural fact. It is the only toggle button this card
 * renders, and the length assertion is what keeps that true: a second one
 * appearing fails here rather than making this helper pick one at random.
 */
function ackToggle(): HTMLElement {
  const toggles = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
  expect(toggles, 'the card no longer renders exactly one toggle button').toHaveLength(1);
  return toggles[0];
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
    fireEvent.click(ackToggle());
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
    fireEvent.click(ackToggle());
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
    fireEvent.click(ackToggle());
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

function modalBody(): HTMLElement {
  const el = dialog().querySelector('.modal-body');
  expect(el, 'the modal renders no .modal-body').toBeTruthy();
  return el as HTMLElement;
}

/**
 * The WHOLE dialog's copy blocks, in document order.
 *
 * `h2` is the heading, `p` the lead sentence, `li` the facts, `.card` the
 * `ErrorPanel` (message, plus `Technical detail` and the upstream bytes when it
 * is passed `details`), `.modal-footer button` the actions. Read as a LIST so
 * order and count are pinned alongside the wording; `textContent` on the dialog
 * as a whole would concatenate blocks with no separator and turn an added
 * sentence into a substring change.
 *
 * SCOPE — this is the round-4 fix and the reason it is worth a comment. It was
 * `.modal-body` and `p, li, .card`, under the docblock "the heading and the
 * footer buttons are pinned by their own tests above". They are — by
 * assertions that say the heading CONTAINS the authority and the footer
 * CONTAINS a confirm button, neither of which bounds what else is there. A
 * `<span>` in the footer reading "The acknowledgement has been recorded and the
 * alert is cleared" passed `tsc`, `eslint` and all 1103 tests.
 *
 * The header's close control is not selected: it has no text (an `aria-hidden`
 * icon under an `aria-label`), so it contributes nothing to `textContent` and
 * nothing to either half. Its label is asserted by `modal-focus.test.tsx`.
 */
function dialogBlocks(): string[] {
  return [
    ...dialog().querySelectorAll<HTMLElement>('h2, p, li, .card, .modal-footer button'),
  ].map((n) => normalize(n.textContent));
}

/**
 * HALF ONE of the pin: the blocks are exactly these, in this order — wording,
 * structure, count.
 *
 * Separate, NAMED, and exercised alone by the guard-the-guard below. The two
 * halves lived in one helper, and `expect(() => expectPinnedCopy(…)).toThrow()`
 * is satisfied by EITHER half throwing — so a loosened block equality stayed
 * invisible behind a still-working "nothing outside" check. PR K hit the same
 * masking and fixed it the same way.
 */
function expectBlocksPinned(expected: string[], label?: string) {
  expect(dialogBlocks(), label).toEqual(expected);
}

/**
 * HALF TWO: the dialog contains NOTHING ELSE.
 *
 * A bare text node or a `<span>` dropped into the body grid or the footer would
 * satisfy half one and is the obvious way to add an unreviewed sentence.
 * Compared with whitespace stripped, because the spacing BETWEEN blocks is a
 * formatting accident and is not copy.
 */
function expectNothingOutside(expected: string[], label?: string) {
  expect(squash(dialog().textContent), `${label ?? ''} — copy outside the pinned blocks`).toBe(
    squash(expected.join('')),
  );
}

/**
 * HALF THREE: nothing is ANNOUNCED that was not written down.
 *
 * The blocks pin `textContent`, which cannot see an attribute. A `title` on the
 * body grid and an `aria-label` on the lead paragraph both survived the pin —
 * copy reaching a hover tooltip and a screen reader without touching the text
 * the other two halves compare.
 *
 * Asserted as SET EQUALITY, not as "none of the forbidden ones": a missing
 * announcement is a defect too (the close control losing its only accessible
 * name), and an enumeration of bad values is the open-set mistake this whole
 * file exists to stop making.
 */
function expectNothingAnnounced(outcome: AckOutcome, label?: string) {
  const found: string[] = [];
  for (const el of dialog().querySelectorAll<HTMLElement>('*')) {
    for (const attr of ANNOUNCED_TEXT_ATTRS) {
      const v = el.getAttribute(attr);
      if (v !== null && v !== '') found.push(normalize(v));
    }
  }
  expect(new Set(found), `${label ?? ''} — announced copy outside the pinned set`).toEqual(
    new Set(expectedAnnounced(outcome)),
  );
  // The id-reference attributes carry no text of their own, but they can point
  // at an element OUTSIDE the dialog — whose text neither of the other halves
  // sees. So they are required to resolve inside it.
  for (const el of dialog().querySelectorAll<HTMLElement>('*')) {
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-details']) {
      for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
        expect(
          dialog().querySelector(`#${CSS.escape(id)}`),
          `${attr}="${id}" points outside the dialog`,
        ).toBeTruthy();
      }
    }
  }
}

type PinOpts = {
  stage: AckStage;
  consequence: AckListingConsequence | null;
  outcome: AckOutcome;
  footer: AckFooterState;
  authority: string;
  reason: string;
  diagnostic?: string;
  failedMessage?: string;
  label?: string;
};

function expectPinnedDialog(opts: PinOpts) {
  const expected = expectedDialogBlocks(opts);
  expectBlocksPinned(expected, opts.label);
  expectNothingOutside(expected, opts.label);
  expectNothingAnnounced(opts.outcome, opts.label);
}

const ack404 = () =>
  new ApiError(404, JSON.stringify({ errorCode: 'REGISTRY_NOT_FOUND' }), 'control-plane', '/x', true);
const isAlertsKey = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.some((c) => JSON.stringify(c[0] ?? {}).includes('log-witness-alerts'));

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
    // acknowledged above" — while the row stayed, nothing was hidden, and no
    // control by that name existed. Three false claims on the one control that
    // writes.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const shown = dialog().textContent ?? '';
    expect(shown).toMatch(/different/i);
    expect(shown).toMatch(/same/i);
    // Default view: the row STAYS, and the dialog must not send the operator to
    // a control that is not on screen.
    expect(shown).toMatch(/stays<?\/?\w*>? in this worklist|\bstays\b.{0,40}in this worklist/i);
    expect(shown).not.toMatch(/stays hidden/i);
    expect(shown).not.toMatch(/stays hidden from this view/i);
    // …and it must not send the operator to the control by the name it does not
    // have. The control is on screen in BOTH views (it is how you get back), so
    // what is wrong in this arm is the sentence, not the button's presence.
    expect(normalize(shown)).not.toContain('switch the control above to');

    // Filtered view: the row DOES leave this view, the control IS on screen,
    // and the dialog says both.
    fireEvent.click(ackToggle());
    openConfirm();
    const filtered = dialog().textContent ?? '';
    expect(filtered).toMatch(/leaves this view/i);
    expect(filtered).toMatch(/does not leave the worklist/i);
    expect(filtered).toMatch(/stays hidden from this view/i);
    // The control it names, by the name the control actually renders. The two
    // are pinned against one table (`ACK_LISTING` and the component's own
    // label), so a relabel that forgets this sentence fails the copy pin.
    expect(normalize(filtered)).toContain('switch the control above to Acknowledged shown');
    expect(normalize(ackToggle().textContent)).toBe('Acknowledged hidden');
  });

  it('DISCRIMINATES: the two arms of that bullet are different text', () => {
    // A constant bullet across both views is what shipped, so a single-arm
    // assertion cannot be the guard here.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const shown = dialog().textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(ackToggle());
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
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));
    expect(dialog().textContent).not.toMatch(/could not record/i);
  });

  // ── The refetch's placement, which has now been wrong in both directions ──
  //
  // Round 1 invalidated on ARRIVAL and the dialog unmounted: the parent derived
  // the dialog's row from the live list, so the refetch that emptied the list
  // destroyed the explanation the refetch existed to accompany.
  //
  // Round 2 moved the invalidation to the close handler. That kept the dialog
  // standing and broke two other things: the panel claimed the worklist "has
  // been refreshed" when no refetch had been requested, and an operator who
  // dismissed before the response landed got no refetch at all.
  //
  // The fix was neither placement but the row's IDENTITY — the parent now holds
  // the row it opened on. These four tests pin all three facts that arrangement
  // has to deliver at once, because each previous arrangement satisfied some of
  // them.

  it('the 404 refetch fires ON ARRIVAL, while the explanation is on screen', async () => {
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));
    // Both at once: the refetch has been asked for AND the dialog is standing.
    // Round 1 had the first without the second; round 2 the second without the
    // first. Asserting them in one paint is what makes them a single claim.
    expect(isAlertsKey(invalidate)).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the dialog SURVIVES the refetch removing its row from the list', async () => {
    // The assertion round 1's version could not make, because the hook is
    // mocked with a constant: the list never actually changed, so "the dialog
    // is still here" was true of a component whose row could not go away.
    //
    // Here the refetch is simulated for real — the hook starts returning an
    // EMPTY worklist, which is what upstream serves after `advanceCursor` — and
    // the dialog must still be standing with its explanation intact. A parent
    // that re-derives the dialog's row from `rows` renders nothing at all here.
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    const { rerender } = renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));

    useLogWitnessAlerts.mockReturnValue({ isLoading: false, error: null, data: rows([]) });
    rerender(
      <QueryClientProvider client={queryClient}>
        <LogWitnessAlerts />
      </QueryClientProvider>,
    );

    // The row really did leave the table behind the dialog. Scoped to the
    // TABLE, not the document: the dialog names the authority too, and a
    // document-wide query would be satisfied by the dialog having unmounted —
    // the exact opposite of what this test is for.
    expect(section().querySelector('tbody')).toBeNull();
    expect(screen.getByText(EMPTY_TITLE_ALL)).toBeInTheDocument();
    // …and the dialog is still there, still saying why.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i);
    // Including the reason it opened on, which the list no longer carries.
    expect(dialog().textContent).toMatch(/root mismatch/i);
  });

  it('the dialog TRACKS the live row while there still is one', async () => {
    // The other half of the snapshot, and the half that was unpinned: freezing
    // the dialog on the row it opened with — never preferring the live one —
    // passed every other test in this file.
    //
    // It matters because a detection with a DIFFERENT reason overwrites the row
    // upstream (the table's primary key is `(tenantId, registryAuthority)`, so
    // an authority holds at most one alert at a time). A dialog frozen at open
    // time would then caption the one control on this page that writes with a
    // reason the table beneath it no longer shows, and the operator would
    // confirm against the wrong fact.
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    const { rerender } = renderWith({ data: rows([row()]) });
    openConfirm();
    expect(dialog().textContent).toMatch(/root mismatch/i);

    // The same authority, re-detected with a different reason.
    useLogWitnessAlerts.mockReturnValue({
      isLoading: false,
      error: null,
      data: rows([row({ reason: 'log_id_changed' })]),
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <LogWitnessAlerts />
      </QueryClientProvider>,
    );

    expect(dialog().textContent).toMatch(/log id changed/i);
    expect(dialog().textContent).not.toMatch(/root mismatch/i);
  });

  it('the 404 refetch still happens if the operator dismisses first', async () => {
    // The in-flight dismissal. Round 2 gated the invalidation on `resolved`
    // read at dismiss time, so closing before the response landed produced no
    // refetch at all — and `onError` was gone, so nothing else caught it. The
    // worklist then kept listing an authority whose alert had resolved until
    // something unrelated invalidated the query (`staleTime` 20s,
    // `refetchOnWindowFocus` off), sending an operator after a registry that
    // had just recovered.
    //
    // `useMutation`'s own `onError` is invoked by the Mutation rather than by
    // the component's observer, so it runs after this dialog unmounts. That is
    // the property being pinned.
    let reject: (e: unknown) => void = () => {};
    acknowledgeLogWitnessAlert.mockImplementation(
      () => new Promise((_res, rej) => { reject = rej; }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalled());

    // Dismiss while the request is still outstanding.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(isAlertsKey(invalidate)).toBe(false);

    // …and only now does the 404 arrive.
    reject(ack404());
    await waitFor(() => expect(isAlertsKey(invalidate)).toBe(true));
  });

  it('DISCRIMINATES: a 403 does NOT refetch, on close or otherwise', async () => {
    // The sibling that keeps the assertions above from passing on a component
    // that simply refetches on every error. A 403 changed nothing upstream, so
    // the read would only repeat itself.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(403, JSON.stringify({ message: 'admin-only' }), 'control-plane', '/x', true),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/refused it/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(isAlertsKey(invalidate)).toBe(false);
  });

  it('the resolved panel does not claim a refresh that has already landed', async () => {
    // The sentence round 2 left behind read "The worklist has been refreshed."
    // — past perfect, painted at the exact render where the refetch had not
    // been requested at all. It survived deletion, inversion and replacement by
    // a fabrication about the table's contents with all 1084 tests green,
    // because nothing asserted on it.
    //
    // The refetch IS requested now, so a past-tense claim about the request is
    // fair; a past-tense claim about the ANSWER is not, since the refetch can
    // still fail. This pins the distinction rather than the wording.
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));
    const text = dialog().textContent ?? '';
    // It says a request went out…
    expect(text).toMatch(/asked for the worklist again/i);
    // …and does not report the result of one that has not come back.
    for (const claim of [
      /worklist has been refreshed/i,
      /has been (reloaded|updated|re-?fetched)/i,
      /the row has (already )?(been )?(removed|gone)/i,
      /is no longer (listed|shown|in the table)/i,
    ]) {
      expect(text, `reports a refetch result it does not have (\`${claim}\`)`).not.toMatch(claim);
    }
  });

  it('the resolved panel drops the present tense and the three facts', async () => {
    // Both are claims about an action that by then cannot happen. "currently
    // alerting: Root mismatch" is a present-tense claim the control plane has
    // just contradicted, and "It records which key saw this alert, and when"
    // beside "there is no longer an alert to acknowledge" tells an operator
    // something was recorded when nothing was.
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    renderWith({ data: rows([row()]) });
    openConfirm();
    const before = dialog().textContent ?? '';
    expect(before).toMatch(/currently alerting/i);
    expect(before).toMatch(/it records \*{0,2}which key/i);

    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));
    const after = dialog().textContent ?? '';
    expect(after).not.toMatch(/currently alerting/i);
    expect(after).not.toMatch(/which key/i);
    expect(after).not.toMatch(/does not clear the alert/i);
    // The reason is still named, in the past — it is what the operator clicked
    // on, and the row may already be gone from the table behind the dialog.
    expect(after).toMatch(/was alerting/i);
    expect(after).toMatch(/root mismatch/i);
  });

  it('DISCRIMINATES: a 403 keeps both, because the alert is still there', async () => {
    // The half that stops the test above from passing on a dialog that empties
    // itself on any error. A 403 says the caller lacks scope; the authority is
    // still alerting and confirming is still the action on the table.
    acknowledgeLogWitnessAlert.mockRejectedValue(
      new ApiError(403, JSON.stringify({ message: 'admin-only' }), 'control-plane', '/x', true),
    );
    renderWith({ data: rows([row()]) });
    openConfirm();
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/refused it/i));
    const text = dialog().textContent ?? '';
    expect(text).toMatch(/currently alerting/i);
    expect(text).toMatch(/which key/i);
    expect(text).not.toMatch(/was alerting/i);
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
    expect(ackToggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the listing it REQUESTS, not just the button label, and back', () => {
    renderWith({ data: rows([row()]) });
    // Starts on the full listing, so the first click FILTERS DOWN.
    fireEvent.click(ackToggle());
    expect(lastIncludeAcknowledged()).toBe(false);
    expect(ackToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(ackToggle()).toHaveTextContent(/acknowledged hidden/i);
    // …and back. Upstream never resurfaces a row whose reason has not changed,
    // so the way back to an acknowledged-but-still-alerting authority has to
    // change the REQUEST, not just the label — the filtering is server-side.
    fireEvent.click(ackToggle());
    expect(lastIncludeAcknowledged()).toBe(true);
    expect(ackToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(ackToggle()).toHaveTextContent(/acknowledged shown/i);
  });

  // ══════════════════════════════════════════════════════════════════════
  // THE ANNOUNCEMENT, which this control had backwards.
  //
  // It was labelled `Hide acknowledged` / `Show acknowledged` under
  // `aria-pressed={showAcknowledged}`. `Button` adds no `aria-label`, so the
  // text IS the accessible name, and `aria-pressed` says whether the thing the
  // NAME denotes is on. An ACTION name therefore inverts under it:
  //
  //   showAcknowledged === true   ->  "Hide acknowledged, pressed"
  //                                   (acknowledged rows are on screen)
  //   showAcknowledged === false  ->  "Show acknowledged, not pressed"
  //                                   (acknowledged rows are filtered out)
  //
  // A screen-reader operator got "hidden" in both states and no state change at
  // all, on the one screen whose first gate round was about this worklist
  // silently hiding alerts a human had already seen.
  //
  // The old tests asserted `aria-pressed='true'` and `/hide acknowledged/i` in
  // the same breath — they LOCKED the contradiction in rather than catching it.
  // So the assertion below is stated as the invariant, over both states, rather
  // than as two literals that can be updated to match whatever ships.
  // ══════════════════════════════════════════════════════════════════════
  it('its NAME and its aria-pressed state agree, in both states', () => {
    renderWith({ data: rows([row()]) });
    for (const expected of [true, false]) {
      const btn = ackToggle();
      expect(btn.getAttribute('aria-pressed')).toBe(String(expected));
      const name = normalize(btn.textContent).toLowerCase();
      // The name names the STATE the control is in, and `aria-pressed` says
      // that state is on. Not "what clicking will do" — that is what inverts.
      expect(name, `aria-pressed=${expected} under the name "${name}"`).toBe(
        expected ? 'acknowledged shown' : 'acknowledged hidden',
      );
      // And the listing really is in that state, so the name is not just
      // internally consistent — it is true.
      expect(lastIncludeAcknowledged()).toBe(expected);
      fireEvent.click(btn);
    }
  });

  it('its name is a STATE, not an action — an action name inverts under aria-pressed', () => {
    // The general rule, so a future relabel back to an imperative fails here
    // rather than in a screen reader. Every other `aria-pressed` control in
    // this repo is already a state label (`enrollments.tsx` enabled/disabled,
    // `connection-panel.tsx` "On — using mock data", `events/page.tsx` Live
    // SSE/Live off) or a static filter label; this one was the outlier.
    renderWith({ data: rows([row()]) });
    for (let i = 0; i < 2; i++) {
      const name = normalize(ackToggle().textContent);
      expect(name, `"${name}" reads as an action`).not.toMatch(/^(show|hide|toggle|display)\b/i);
      fireEvent.click(ackToggle());
    }
  });

  it('renders the control even while loading and while erroring, so the view is never stuck', () => {
    renderWith({ isLoading: true });
    expect(ackToggle()).toBeInTheDocument();
    cleanup();
    renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x') });
    expect(ackToggle()).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The dialog's copy, and the three facts it kept conflating.
//
// Round 3's sweep found four independent falsifications of this dialog's prose
// that the whole suite accepted — the "No acknowledgement was recorded"
// sentence inverted, the refetch clause past-perfected, negated and inverted,
// and the resurfacing rule's `same`/`different` swapped. Every positive
// assertion on those paths was a substring `toMatch`, and a substring match
// cannot see a prefix, so one negation walked through all of them.
//
// Widening the forbidden-phrase list is not the fix; the set of English
// paraphrases has no end. The fix is to close the GOOD set: the body is a
// finite composition of enumerated sentences, pinned character for character in
// `test/support/witness-ack-prose.ts`, with the arms keyed off the component's
// own exported state unions so a new state cannot ship with old copy painted
// over it. That file argues the approach and states its limits.
//
// Three behavioural tests sit alongside the pin, because the pin asserts WHICH
// sentence renders and these assert that the state it is keyed on is computed
// from the right thing. All three were blocking findings:
//
//   - the resolved arm read the LIVE reason while claiming to report the
//     open-time one
//   - an in-flight ack whose dialog was dismissed tore down whichever dialog
//     replaced it
//   - "currently alerting" was gated on "our ack 404'd", so a row that left the
//     listing for any other reason was still asserted to be alerting
// ══════════════════════════════════════════════════════════════════════
describe('witness alert worklist — the confirm dialog’s copy is a closed set', () => {
  const AUTH = 'registry-c.playground.local';
  const MISMATCH = 'Root mismatch (split view)';
  const LOG_ID = 'Log ID changed';

  /** Drive a refetch under the open dialog: the hook starts answering differently. */
  function refetchTo(rs: LogWitnessAlertRow[], rerender: (ui: React.ReactElement) => void) {
    useLogWitnessAlerts.mockReturnValue({ isLoading: false, error: null, data: rows(rs) });
    rerender(
      <QueryClientProvider client={queryClient}>
        <LogWitnessAlerts />
      </QueryClientProvider>,
    );
  }

  /** A 403 the control plane really sent — `isUpstreamForbidden` refuses one this console minted. */
  const ackForbidden = () => new ApiError(403, 'Forbidden', 'control-plane', '/x', true);
  /** No `errorCode`, so `operatorErrorMessage` falls through to its status arm. */
  const ack503 = () => new ApiError(503, 'upstream down', 'control-plane', '/x', true);

  it('renders exactly the pinned copy, in every reachable arm', async () => {
    const scenarios: Array<{
      stage: AckStage;
      consequence: AckListingConsequence | null;
      outcome: AckOutcome;
      footer: AckFooterState;
      reason: string;
      diagnostic?: string;
      failedMessage?: string;
      setUp: () => Promise<void>;
    }> = [
      {
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'none',
        footer: 'confirmable',
        reason: MISMATCH,
        setUp: async () => {
          renderWith({ data: rows([row()]) });
          openConfirm();
        },
      },
      {
        stage: 'alerting',
        consequence: 'leaves-view',
        outcome: 'none',
        footer: 'confirmable',
        reason: MISMATCH,
        setUp: async () => {
          renderWith({ data: rows([row()]) });
          fireEvent.click(screen.getByRole('button', { name: /acknowledged (shown|hidden)/i }));
          openConfirm();
        },
      },
      {
        // No error at all — the listing simply stopped holding the row. This
        // arm did not exist before round 3; the `stays-listed` sentence was
        // rendering over it, asserting that a row the table no longer showed
        // would stay put.
        stage: 'left-listing',
        consequence: 'already-gone',
        outcome: 'none',
        footer: 'confirmable',
        reason: MISMATCH,
        setUp: async () => {
          const { rerender } = renderWith({ data: rows([row()]) });
          openConfirm();
          refetchTo([], rerender);
        },
      },
      {
        stage: 'resolved',
        consequence: null,
        outcome: 'already-resolved',
        footer: 'closed-out',
        reason: MISMATCH,
        setUp: async () => {
          acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
          renderWith({ data: rows([row()]) });
          openConfirm();
          confirmAck();
          await waitFor(() =>
            expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i),
          );
        },
      },
      {
        // ROUND 4's GAP, arm one. Acknowledging is admin-gated upstream, so
        // this is a designed failure path, not an exotic one — and it is the
        // worst state to leave unpinned, because the control plane has just
        // REFUSED the write. A fabricated `<p>` reading "The acknowledgement
        // was recorded anyway and the alert is now cleared", rendered only
        // here, passed `tsc`, `eslint` and all 1103 tests.
        //
        // The bullets are NOT withdrawn: confirming can still be retried with a
        // better-scoped key, so every sentence about what confirming does is
        // still a live claim. That is the difference from the 404 arm, and it
        // is a composition fact the block list pins.
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'forbidden',
        footer: 'confirmable',
        reason: MISMATCH,
        diagnostic: errorDiagnostic(ackForbidden()),
        setUp: async () => {
          acknowledgeLogWitnessAlert.mockRejectedValue(ackForbidden());
          renderWith({ data: rows([row()]) });
          openConfirm();
          confirmAck();
          await waitFor(() => expect(dialog().textContent).toContain(ADMIN_ROUTE_FORBIDDEN));
        },
      },
      {
        // ROUND 4's GAP, arm two: anything that is neither a 404 nor an
        // upstream 403.
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'failed',
        footer: 'confirmable',
        reason: MISMATCH,
        diagnostic: errorDiagnostic(ack503()),
        failedMessage: operatorErrorMessage(ack503(), 'Could not record the acknowledgement'),
        setUp: async () => {
          acknowledgeLogWitnessAlert.mockRejectedValue(ack503());
          renderWith({ data: rows([row()]) });
          openConfirm();
          confirmAck();
          await waitFor(() =>
            expect(dialog().textContent).toMatch(/could not record the acknowledgement/i),
          );
        },
      },
      {
        // ROUND 4's GAP, arm three: the in-flight footer. The confirm button
        // relabels while the write is out, and nothing pinned what the dialog
        // says in that window — a fabricated sentence gated on `isPending`
        // survived too.
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'none',
        footer: 'in-flight',
        reason: MISMATCH,
        setUp: async () => {
          acknowledgeLogWitnessAlert.mockImplementation(() => new Promise(() => {}));
          renderWith({ data: rows([row()]) });
          openConfirm();
          confirmAck();
          await waitFor(() => expect(dialog().textContent).toMatch(/acknowledging/i));
        },
      },
    ];

    // Anti-vacuity, asserted BEFORE the loop: a table that quietly lost an arm
    // must fail as a coverage gap rather than pass with three scenarios. Every
    // key set is read off a `Record` typed by one of the component's own
    // unions — so this compares the copy table against the state machine, not
    // against a second hand-written list that could drift with it.
    //
    // ROUND 4: `ALL_OUTCOMES` and `ALL_FOOTER_STATES` are new here, and their
    // absence is exactly why this check could not see the gap it was written to
    // prevent. It compared the table against the two LISTING axes while three
    // reachable bodies differed on an axis it did not know existed. An
    // exhaustiveness proof is only ever as wide as its axes.
    expect(new Set(scenarios.map((s) => s.stage))).toEqual(new Set(ALL_STAGES));
    expect(
      new Set(scenarios.map((s) => s.consequence).filter((c) => c !== null)),
    ).toEqual(new Set(ALL_CONSEQUENCES));
    expect(new Set(scenarios.map((s) => s.outcome))).toEqual(new Set(ALL_OUTCOMES));
    expect(new Set(scenarios.map((s) => s.footer))).toEqual(new Set(ALL_FOOTER_STATES));

    for (const s of scenarios) {
      cleanup();
      acknowledgeLogWitnessAlert.mockReset();
      await s.setUp();
      expectPinnedDialog({
        stage: s.stage,
        consequence: s.consequence,
        outcome: s.outcome,
        footer: s.footer,
        authority: AUTH,
        reason: s.reason,
        diagnostic: s.diagnostic,
        failedMessage: s.failedMessage,
        label: `${s.stage} / ${s.consequence ?? 'no bullets'} / ${s.outcome} / ${s.footer}`,
      });
    }
  });

  // ── The pin's own guard ───────────────────────────────────────────────
  //
  // Each half is exercised ALONE against an injection into the ACTUAL DOM.
  //
  // Both directions of that sentence were got wrong on this repo before.
  // Injecting into the EXPECTED list proves only that `toEqual` distinguishes
  // two arrays; and with both halves inside one helper, a single
  // `expect(() => pin()).toThrow()` is satisfied by either one firing, so a
  // loosened block equality hid behind a working "nothing outside" check.
  /** Split one block into two carrying the same total text, in place. */
  function splitFirstParagraph() {
    const lead = modalBody().querySelector('p') as HTMLElement;
    const text = lead.textContent ?? '';
    const cut = text.indexOf(' ', Math.floor(text.length / 2));
    const a = document.createElement('p');
    const b = document.createElement('p');
    a.textContent = text.slice(0, cut);
    b.textContent = text.slice(cut);
    lead.replaceWith(a, b);
  }

  it('the block pin catches a change of STRUCTURE that changes no text', () => {
    // The block half's own job, and it needs an injection the other halves
    // cannot see — otherwise deleting its call site from the composite is
    // silent. Measured: with an APPENDED element, removing `expectBlocksPinned`
    // from `expectPinnedDialog` left the whole suite green, because the
    // nothing-outside half catches an append too.
    //
    // Splitting one paragraph into two leaves the concatenated text identical
    // and the block LIST one element longer. That is what "the order and the
    // count are part of the pin" means, stated as a test rather than as a
    // docblock.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });
    expectBlocksPinned(expected);

    splitFirstParagraph();
    expect(() => expectBlocksPinned(expected)).toThrow();
    // …and the other half really is blind to it, which is why there are three.
    expect(() => expectNothingOutside(expected)).not.toThrow();
  });

  it('the nothing-outside pin catches text that adds no block', () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });
    expectNothingOutside(expected);

    // A `<span>` matches none of the block selectors, so half one is blind to
    // it. This is the half that sees it.
    const span = document.createElement('span');
    span.textContent = 'and the retained head has been cleared';
    modalBody().appendChild(span);
    expect(() => expectNothingOutside(expected)).toThrow();
    // …and half one really is blind, which is why there are two.
    expect(() => expectBlocksPinned(expected)).not.toThrow();
  });

  it('the pin covers the FOOTER, not only the body', () => {
    // The specific round-4 escape: `.modal-body` was the whole scope.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });
    const footer = dialog().querySelector('.modal-footer') as HTMLElement;
    expect(footer, 'the modal renders no .modal-footer').toBeTruthy();
    const span = document.createElement('span');
    span.textContent = 'The acknowledgement has been recorded and the alert is cleared.';
    footer.appendChild(span);
    expect(() => expectNothingOutside(expected)).toThrow();
  });

  it('the pin covers the HEADING, not only the body', () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });
    const h2 = dialog().querySelector('h2') as HTMLElement;
    h2.textContent = `${h2.textContent} — already cleared`;
    expect(() => expectBlocksPinned(expected)).toThrow();
  });

  it('the announced pin catches copy that never reaches textContent', () => {
    renderWith({ data: rows([row()]) });
    openConfirm();
    expectNothingAnnounced('none');

    // A `title` is invisible to every `textContent` comparison, and it is the
    // channel `CLAUDE.md` singles out: invisible on touch, invisible to the
    // keyboard, unreliably announced. Both of these survived the block pin.
    modalBody().setAttribute('title', 'The alert is cleared once you confirm.');
    expect(() => expectNothingAnnounced('none')).toThrow();
    modalBody().removeAttribute('title');

    const lead = modalBody().querySelector('p') as HTMLElement;
    lead.setAttribute('aria-label', 'This acknowledgement resolves the alert.');
    expect(() => expectNothingAnnounced('none')).toThrow();
    // …and the other two halves really are blind to it, which is why there are
    // three.
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });
    expect(() => expectBlocksPinned(expected)).not.toThrow();
    expect(() => expectNothingOutside(expected)).not.toThrow();
  });

  it('the announced pin catches a LOST announcement, not only an added one', () => {
    // Set equality in both directions. The close control's icon is
    // `aria-hidden`, so its `aria-label` is its entire accessible name —
    // dropping it leaves a button announced as "button" and nothing else.
    renderWith({ data: rows([row()]) });
    openConfirm();
    const close = dialog().querySelector('[aria-label="Close dialog"]') as HTMLElement;
    expect(close, 'the modal renders no labelled close control').toBeTruthy();
    close.removeAttribute('aria-label');
    expect(() => expectNothingAnnounced('none')).toThrow();
  });

  it('all three halves are WIRED IN, not merely present', () => {
    // The per-half tests above prove each half catches its own injection. They
    // say nothing about whether `expectPinnedDialog` still CALLS all three — a
    // deleted call site leaves every one of them green.
    //
    // This is not the masking the halves were split to avoid: masking is when
    // one assertion stands for two checks and either can satisfy it. Here each
    // injection has a known owner, established separately above, and this test
    // only adds that the composite fires for each.
    const pin = () =>
      expectPinnedDialog({
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'none',
        footer: 'confirmable',
        authority: AUTH,
        reason: MISMATCH,
      });

    const injections: Array<[string, () => void]> = [
      // block half — a STRUCTURE change with no text change, because an
      // appended element is caught by the nothing-outside half as well and so
      // cannot tell whether this half is still wired in.
      ['a split paragraph', splitFirstParagraph],
      // nothing-outside half
      ['a bare span', () => {
        const el = document.createElement('span');
        el.textContent = 'and the retained head has been cleared';
        modalBody().appendChild(el);
      }],
      // announced half
      ['a title attribute', () => {
        modalBody().setAttribute('title', 'Confirming clears the alert.');
      }],
    ];

    for (const [what, inject] of injections) {
      cleanup();
      renderWith({ data: rows([row()]) });
      openConfirm();
      expect(pin, `${what}: the pin fails before the injection`).not.toThrow();
      inject();
      expect(pin, `${what} is not caught by the composed pin`).toThrow();
    }
  });

  it('names the row it was OPENED ON, on a listing with more than one row', async () => {
    // The live lookup is `rows.find(r => r.authority === confirming.authority)`.
    // Replacing it with `rows[0]` survived every dialog test, because they all
    // used a single-row listing — so the identity match was asserted by
    // coincidence rather than by design. Regressed, the dialog captions row
    // three's confirm with row one's reason, which is the exact
    // wrong-row-reported defect round 3 of this PR existed to fix.
    renderWith({
      data: rows([
        row({ authority: 'first.example.com', reason: 'log_id_changed' }),
        row({ authority: AUTH, reason: 'root_mismatch' }),
      ]),
    });
    openConfirm(AUTH);
    expectPinnedDialog({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
      label: 'second row of a two-row listing',
    });
    // Stated separately, because the pin would also fail for an unrelated
    // wording change and this is the specific claim.
    expect(normalize(dialog().textContent)).not.toContain(LOG_ID);
  });

  it('does not carry one row’s failure into the next row’s dialog', async () => {
    // `key={confirming.authority}` on the `<Modal>`. Without it React reuses
    // the instance across a change of `confirming`, and the mutation state goes
    // with it — so a 403 from row one renders under row two's heading, telling
    // the operator the control plane refused a write that was never attempted.
    acknowledgeLogWitnessAlert.mockRejectedValue(ackForbidden());
    renderWith({
      data: rows([
        row({ authority: 'first.example.com', reason: 'root_mismatch' }),
        row({ authority: AUTH, reason: 'root_mismatch' }),
      ]),
    });
    openConfirm('first.example.com');
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toContain(ADMIN_ROUTE_FORBIDDEN));

    // WITHOUT going through Cancel. Dismissing sets `confirming` to null, the
    // parent stops rendering the dialog, and React drops the instance whether
    // or not it is keyed — so a test that cancels first proves nothing about
    // the key. Measured: with `key={confirming.authority}` removed, the
    // cancel-first version stays green.
    //
    // This is the transition the key is FOR: `confirming` going straight from
    // one authority to another. An operator reaches it by clicking a second
    // row's acknowledge control; the overlay makes that awkward but not
    // impossible, and nothing in the component prevents the parent from
    // setting `confirming` directly.
    openConfirm(AUTH);
    expectPinnedDialog({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
      label: 'second dialog opened straight from the first',
    });
  });

  it('DISCRIMINATES: the three listing consequences are three different sentences', () => {
    // Without this, a component that rendered one constant bullet in all three
    // arms would still pass the pin above — as long as the pinned table
    // repeated itself too. The bullet WAS constant across two arms once, and
    // shipped false on the screen it was rendered over.
    const texts = ALL_CONSEQUENCES.map((c) => ACK_LISTING[c]);
    expect(new Set(texts).size, 'two listing consequences share their copy').toBe(texts.length);
  });

  it('the resolved arm names the reason the dialog OPENED on, not the live one', async () => {
    // The row is overwritten in place upstream when the same authority is
    // re-detected with a different reason — the table's primary key is
    // `(tenantId, registryAuthority)`. A dialog that read the live row here
    // reported a detection the operator had never seen, and it did so on the
    // one path where the dialog is the only surviving record of what they
    // clicked, because a 404 means the row is already gone from the table.
    acknowledgeLogWitnessAlert.mockRejectedValue(ack404());
    const { rerender } = renderWith({ data: rows([row({ reason: 'root_mismatch' })]) });
    openConfirm();
    refetchTo([row({ reason: 'log_id_changed' })], rerender);
    confirmAck();
    await waitFor(() => expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i));

    expectPinnedDialog({
      stage: 'resolved',
      consequence: null,
      outcome: 'already-resolved',
      footer: 'closed-out',
      authority: AUTH,
      reason: MISMATCH,
      label: 'resolved, after the live row changed reason',
    });
    // Stated separately from the pin, because the pin would also fail for an
    // unrelated wording change and this is the specific claim.
    expect(
      normalize(modalBody().textContent),
      'the resolved arm is reading the LIVE reason',
    ).not.toContain(LOG_ID);
  });

  it('a row that leaves the listing is described in the past tense, and nothing claims why', async () => {
    // `resolved` means only "our ack returned 404". A row can leave the listing
    // without that ever happening — any refetch after upstream ran
    // `advanceCursor`, or, in the filtered view, someone else acknowledging it
    // — and the dialog then asserted "currently alerting" over a card that was
    // simultaneously rendering "No alert is recorded at all".
    const { rerender } = renderWith({ data: rows([row({ reason: 'root_mismatch' })]) });
    openConfirm();
    expect(normalize(modalBody().textContent)).toContain('currently alerting');

    refetchTo([], rerender);
    expectPinnedDialog({
      stage: 'left-listing',
      consequence: 'already-gone',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
      label: 'left-listing, no error',
    });
    // No 404 has arrived, so the console has NOT been told the alert cleared
    // and may not say so — this arm and the resolved one are different claims.
    expect(normalize(modalBody().textContent)).not.toContain('no longer an alert to acknowledge');
    // And confirming stays on offer, because only the control plane can settle
    // whether the alert is still there. Withdrawing it here would be the same
    // over-claim in the other direction.
    expect(within(dialog()).getByRole('button', { name: /^acknowledge$/i })).toBeInTheDocument();
  });

  it('still sends the ack for the row it opened on after that row leaves the listing', async () => {
    // The identity half of the same change: `live` going null must not change
    // WHO is acknowledged. Upstream takes no body, so the authority is the
    // whole request.
    acknowledgeLogWitnessAlert.mockResolvedValue({ authority: AUTH, alerted: true });
    const { rerender } = renderWith({
      data: rows([row({ authority: 'other.example.com' }), row({ authority: AUTH })]),
    });
    openConfirm(AUTH);
    refetchTo([row({ authority: 'other.example.com' })], rerender);
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalledTimes(1));
    expect(acknowledgeLogWitnessAlert.mock.calls[0][0]).toBe(AUTH);
  });

  it('an ack whose dialog was dismissed does not close the dialog that replaced it', async () => {
    // `useMutation`'s own `onSuccess` is invoked by the Mutation in `execute()`
    // with no observer check, so it runs after this dialog unmounts —
    // deliberately, so the refetch still happens. `onClose` was sitting in it
    // too, and `onClose` is the PARENT's `setConfirming(null)`: an operator who
    // dismissed an in-flight ack and opened a different row had that second
    // dialog torn down when the first ack landed.
    //
    // The close therefore moved to the per-call callback passed to `mutate()`,
    // which `MutationObserver#notify` gates on `hasListeners()`. Both halves
    // are asserted here, because moving the invalidation with it would be the
    // other half of the same bug (see the refetch tests above).
    let resolveAck: (v: unknown) => void = () => {};
    acknowledgeLogWitnessAlert.mockImplementation(
      () => new Promise((res) => { resolveAck = res; }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderWith({
      data: rows([row({ authority: 'first.example.com' }), row({ authority: 'second.example.com' })]),
    });
    openConfirm('first.example.com');
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalled());

    // Dismissed while in flight, and a different row opened.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openConfirm('second.example.com');
    expect(within(dialog()).getByRole('heading').textContent).toBe('Acknowledge second.example.com');

    // …and only now does the first ack succeed.
    resolveAck({ authority: 'first.example.com', alerted: true });
    // The refetch still fires — that half must NOT be gated on the dialog.
    await waitFor(() => expect(isAlertsKey(invalidate)).toBe(true));
    // The second dialog is untouched.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog()).getByRole('heading').textContent).toBe('Acknowledge second.example.com');
  });

  it('a worklist refetch does not take focus off the open dialog', async () => {
    // `Modal`'s focus effect used to list `onClose` as a dependency, and
    // `onClose` here is an inline arrow minted by `LogWitnessAlerts` — so every
    // re-render of the PARENT tore the effect down (restoring focus out of the
    // dialog) and re-ran it (focusing the header X).
    //
    // The parent re-renders on every React Query update, which for this hook
    // means every background refetch on a 20-second `staleTime` AND the
    // invalidation the 404 path issues itself. Measured with the dependency
    // restored, focus on the confirm button, two refetches:
    //
    //   ["Close dialog", "Acknowledge", "Close dialog"]
    //
    // — the operator taken off the one control on this page that writes, and
    // left on the close button. `modal-focus.test.tsx` holds the synthetic
    // minimum; this is the real component, because that file's earlier header
    // claimed a witness-ack figure that the witness-ack component does not
    // produce (a confirm click and its error arrival move focus zero times,
    // with the bug and without — the mutation re-renders the dialog, not its
    // owner).
    const moves: string[] = [];
    const onFocusIn = (e: Event) => {
      const el = e.target as HTMLElement;
      moves.push(el.getAttribute('aria-label') ?? el.textContent?.slice(0, 24) ?? el.tagName);
    };

    const { rerender } = renderWith({ data: rows([row()]) });
    openConfirm();
    // The focus timer is a `setTimeout(…, 0)`; let it land before measuring.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 5));

    // THE OPERATOR TABS TO THE CONFIRM BUTTON. Measuring from wherever
    // mount-time focus landed would measure from the header X — which is
    // exactly where the broken effect re-focuses, so the defect is invisible
    // from there and the test would pass with the bug restored.
    const confirm = within(dialog()).getByRole('button', { name: /^acknowledge$/i });
    confirm.focus();
    expect(document.activeElement).toBe(confirm);

    document.addEventListener('focusin', onFocusIn, { capture: true });
    try {
      for (let i = 0; i < 2; i++) {
        refetchTo([row({ consecutiveFailures: 3 + i })], rerender);
        await new Promise((r) => setTimeout(r, 5));
      }
    } finally {
      document.removeEventListener('focusin', onFocusIn, { capture: true });
    }

    expect(moves, `focus moved to: ${moves.join(', ')}`).toEqual([]);
    expect(document.activeElement).toBe(confirm);
  });

  it('DISCRIMINATES: the dialog DOES close when its OWN ack succeeds', async () => {
    // The sibling that stops the test above from passing on a dialog that never
    // closes at all — deleting the `onSuccess` callback entirely satisfies it.
    // Same mechanics as the dismissal test (a deferred promise, so the close is
    // observably tied to the response rather than to the click), and the same
    // two rows, so the only difference between the two is whether the dialog
    // was dismissed first.
    let resolveAck: (v: unknown) => void = () => {};
    acknowledgeLogWitnessAlert.mockImplementation(
      () => new Promise((res) => { resolveAck = res; }),
    );
    renderWith({
      data: rows([row({ authority: 'first.example.com' }), row({ authority: 'second.example.com' })]),
    });
    openConfirm('first.example.com');
    confirmAck();
    await waitFor(() => expect(acknowledgeLogWitnessAlert).toHaveBeenCalled());
    // Still open while the request is outstanding.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveAck({ authority: 'first.example.com', alerted: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
