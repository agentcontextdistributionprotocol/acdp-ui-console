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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  ackListingConsequence,
  ackOutcome,
  ackStage,
} from '@/components/registries/log-witness-alerts';
import {
  ADMIN_ROUTE_FORBIDDEN,
  errorDiagnostic,
  operatorErrorMessage,
} from '@/lib/utils/api-error-messages';
import {
  ACK_FORBIDDEN_PANEL,
  ACK_LISTING,
  ALL_CONSEQUENCES,
  ALL_FOOTER_STATES,
  ALL_OUTCOMES,
  ALL_STAGES,
  ID_REFERENCE_ATTRS,
  NON_ANNOUNCING_ATTRS,
  VALUELESS_ATTRS,
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

/**
 * What a screen reader will call this control — NOT its `textContent`.
 *
 * ROUND 5's NB3. The `aria-pressed` invariant read `textContent`, and `Button`
 * spreads `...rest`, so adding
 * `aria-label={showAcknowledged ? 'Hide acknowledged' : 'Show acknowledged'}`
 * restored the exact defect that invariant exists to prevent — an accessible
 * name of "Hide acknowledged" under `aria-pressed="true"` — and the test
 * passed. The mutation died only incidentally, on an unrelated
 * `aria-label`-filtered count elsewhere in the file.
 *
 * An `aria-label` REPLACES the content as the accessible name (accname step 2C
 * beats step 2F), so a control whose label and whose visible text disagree is
 * announced by the label — which is precisely the half an invariant about
 * announcement has to read.
 *
 * ROUND 6's B4 added the step ABOVE that one. `aria-labelledby` (step 2B)
 * beats `aria-label`, and it is the mechanism the dialog root actually uses:
 * `Modal` names itself by pointing at its `<h2>`. Repointing that attribute at
 * a `<p>Acknowledging clears this alert</p>` outside the dialog replaced the
 * first string a screen reader speaks on open with unreviewed copy, and left
 * 1122/1122 green — because nothing in this file read the dialog's name, and
 * every block pin still found the real heading in the subtree. Reading
 * `textContent` for a `labelledby` element rather than recursing is enough
 * here and is the one simplification left: this covers the three sources this
 * dialog can produce, not the whole accname algorithm.
 */
function accessibleName(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (ids.length > 0) {
    const parts = ids.map((id) => {
      const target = el.ownerDocument.getElementById(id);
      return normalize(target?.textContent);
    });
    // An `aria-labelledby` that resolves to nothing is NOT a fallback to the
    // content — the name is genuinely empty, and reporting it as the heading
    // would hide exactly the defect this is here to catch.
    return normalize(parts.join(' '));
  }
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return normalize(label);
  return normalize(el.textContent);
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

/**
 * The OUTERMOST element the dialog puts on the page.
 *
 * ROUND 6's N6: every scan here started at `dialog()`, which is the `.modal`
 * element. `Modal` wraps it in a `.modal-overlay` that covers the viewport, and
 * that element has attributes of its own. `title="Confirming clears the alert
 * and the retained head."` on it left 1122/1122 green — a tooltip over the
 * whole backdrop of the page's only write control, on a surface whose own tests
 * elsewhere refuse `title` outright.
 *
 * The fallback is not defensive tidiness: if `Modal` ever stops rendering an
 * overlay, a scan rooted on a `closest()` that returned `null` would quietly
 * become a scan of nothing. It returns the dialog instead, which is the same
 * subject the round-5 scan had, so the worst case is the previous bound rather
 * than no bound.
 */
function dialogScanRoot(): HTMLElement {
  return dialog().closest<HTMLElement>('.modal-overlay') ?? dialog();
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
const BLOCK_SELECTOR = 'h2, p, li, .card, .modal-footer button';

function dialogBlocks(): string[] {
  return [...dialog().querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].map((n) =>
    normalize(n.textContent),
  );
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
  const nonAnnouncing = new Set<string>(NON_ANNOUNCING_ATTRS);
  // ROUND 6's N6: THE SCAN STARTED ONE ELEMENT TOO LOW. It began at `dialog()`
  // — the `.modal` element — and the `.modal-overlay` that wraps it is a real
  // element with real attributes covering the whole viewport. Measured:
  // `title="Confirming clears the alert and the retained head."` on
  // `.modal-overlay` left 1122/1122 green, putting a tooltip over the entire
  // backdrop of the page's only write control. The `[title]` guard elsewhere in
  // this file renders no dialog, so nothing looked there.
  //
  // So the scan root is the OVERLAY, which is the outermost thing the dialog
  // puts on the page. `dialogScanRoot()` is that element and falls back to the
  // dialog itself, so a refactor that drops the overlay does not silently
  // shrink this half's subject back to where it was.
  const root = dialogScanRoot();
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const attr of el.attributes) {
      // ROUND 5: the scan used to walk a list of attributes that DO announce,
      // which is an OPEN set — `aria-keyshortcuts` and an `<input value>` both
      // walked past it with the suite green. It now walks EVERY attribute and
      // skips only the structural ones, so an attribute nobody thought of is a
      // red test rather than a silent channel.
      if (nonAnnouncing.has(attr.name.toLowerCase())) continue;
      // ROUND 6's B2, SECOND HALF: the empty-value skip was an UNDOCUMENTED
      // SECOND LICENCE sitting on top of `NON_ANNOUNCING_ATTRS`. Every boolean
      // attribute in the language passed for free, `inert` among them — and
      // `inert` is a suppressor, so the licence that was meant to ignore
      // `class=""` was also ignoring the attribute that silences the dialog.
      //
      // It is kept, because an attribute present with no value announces
      // nothing, and it is now BOUNDED: a valueless attribute must be one this
      // file has looked at. `VALUELESS_ATTRS` is the closed side, and
      // `assertBooleanAttrsAreLicensed` below is what refuses a new one.
      if (!attr.value.trim()) {
        expect(
          VALUELESS_ATTRS,
          `${label ?? ''} — \`${attr.name}\` is present with no value and nothing here has ` +
            'decided whether it announces or suppresses',
        ).toContain(attr.name.toLowerCase());
        continue;
      }
      found.push(normalize(attr.value));
    }
  }
  expect(new Set(found), `${label ?? ''} — announced copy outside the pinned set`).toEqual(
    new Set(expectedAnnounced(outcome)),
  );
  // The id-reference attributes carry no text of their own, but they can point
  // at an element OUTSIDE the dialog — whose text neither of the other halves
  // sees. So they are required to resolve inside it.
  //
  // ROUND 6's B4: THIS LOOP STARTED AT THE DESCENDANTS AND SKIPPED THE ROOT,
  // while the attribute scan six lines above correctly started at `dialog()`.
  // The dialog ROOT is where `aria-labelledby` and `aria-describedby` actually
  // live, so the one element that carries them was the one element not checked.
  // Measured, each alone at 1122/1122 green: `aria-describedby` on the root
  // pointing at a `<p>` inside `.modal-overlay` but outside `.modal`; and
  // `aria-labelledby` repointed at an outside `<p>Acknowledging clears this
  // alert</p>`, which REPLACES the dialog's accessible name — the first thing
  // announced on open — with unreviewed copy, while every block pin still read
  // the real `<h2>`.
  for (const el of [dialog(), ...dialog().querySelectorAll<HTMLElement>('*')]) {
    for (const attr of ID_REFERENCE_ATTRS) {
      for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
        expect(
          dialog().querySelector(`#${CSS.escape(id)}`),
          `${attr}="${id}" points outside the dialog`,
        ).toBeTruthy();
      }
    }
  }
  // …and resolving INSIDE the dialog is not the same as resolving to the right
  // thing. The accessible name is the first string a screen reader speaks, it
  // is assembled from `aria-labelledby` rather than from the subtree, and no
  // pin in this file read it until round 6 asked. It must be the heading.
  const heading = dialog().querySelector('h2');
  expect(heading, 'the dialog has no heading to take its name from').toBeTruthy();
  expect(
    accessibleName(dialog()),
    `${label ?? ''} — the dialog announces a name that is not its heading`,
  ).toBe(normalize(heading!.textContent));
}

/**
 * HALF FOUR: everything written down is still REACHABLE.
 *
 * The other three halves all bound what is ADDED. None of them can see a
 * SUPPRESSION, and round 5's gate found the sharpest one available:
 * `aria-hidden` on the three-facts `<ul>`. `textContent` is unchanged, no
 * attribute value carries copy, nothing is outside the blocks — and every
 * sentence the dialog exists to state is gone from the accessibility tree. A
 * screen-reader operator is left with "Recording an acknowledgement for X,
 * currently alerting: Y" and two buttons, which is precisely the reading of the
 * word "acknowledge" this whole dialog was built to prevent. 1115/1115 green.
 *
 * `aria-hidden` is on the non-announcing list because it announces nothing
 * ITSELF; what it hides is this half's problem. `role="presentation"` strips an
 * element's semantics rather than its text, so it is not the same defect and is
 * not checked here.
 *
 * ── ROUND 6's B2: THE WALK ONLY WENT UP, AND IT DID NOT KNOW `inert` ──
 *
 * This half's headline is "everything written down is still REACHABLE", and it
 * checked reachability by walking from each block up to `dialog()`. Two
 * measured escapes, each alone at 1122/1122 green:
 *
 *   - `<span aria-hidden="true">` wrapping the CONTENTS of each fact `<li>`.
 *     The block is the `<li>`, the suppressor is its child, `textContent` is
 *     unchanged, and the walk never looked down. Round 5's finding verbatim,
 *     one DOM level lower.
 *   - `<ul inert>` on the three-facts list. `inert` removes its subtree from
 *     the accessibility tree and from hit-testing, and this half had never
 *     heard of it — the empty-value skip in the announced half licensed it at
 *     the same time (see `VALUELESS_ATTRS`).
 *
 * So the walk goes BOTH WAYS and checks three attributes. Walking down needs
 * one rule the upward walk does not: an `aria-hidden` descendant is only a
 * defect if it silences TEXT. A decorative `<svg aria-hidden="true">` inside a
 * block is correct authoring, and refusing it would make this half fire on the
 * close icon. So a suppressed descendant is refused only when it carries
 * non-empty text, which is exactly the thing this half claims is reachable.
 *
 * Not a styling check: jsdom applies no stylesheet, so `display: none` and
 * `visibility: hidden` are invisible from here. Round 6's N8 found that gap
 * asserted to be "named in the docblock of the globals.css guard below", and
 * that guard's docblock never mentioned either. It is named HERE, which is the
 * only place a reader of this half will look.
 */
const SUPPRESSING_ATTRS = ['aria-hidden', 'hidden', 'inert'] as const;

function suppressorOn(el: HTMLElement): string | null {
  if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden="true"';
  if (el.hasAttribute('hidden')) return '`hidden`';
  if (el.hasAttribute('inert')) return '`inert`';
  return null;
}

function expectNothingSilenced(expected: string[], label?: string) {
  const blocks = [...dialog().querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];
  let checked = 0;
  let descendantsSeen = 0;
  for (const block of blocks) {
    const where = `"${normalize(block.textContent).slice(0, 40)}…"`;
    // UP: any suppressor between the block and the dialog root hides the block
    // whatever it contains.
    for (let el: HTMLElement | null = block; el !== null; el = el.parentElement) {
      expect(
        suppressorOn(el),
        `${label ?? ''} — ${where} is inside an element carrying ${suppressorOn(el)} and is ` +
          'announced to nobody',
      ).toBeNull();
      if (el === dialog()) break;
    }
    // DOWN: a suppressor on a descendant hides only what that descendant
    // holds, so it is a defect exactly when what it holds is text.
    for (const el of block.querySelectorAll<HTMLElement>('*')) {
      descendantsSeen += 1;
      const how = suppressorOn(el);
      if (how === null) continue;
      expect(
        normalize(el.textContent),
        `${label ?? ''} — ${where} contains a <${el.tagName.toLowerCase()}> carrying ${how} ` +
          'whose text is therefore announced to nobody',
      ).toBe('');
    }
    checked += 1;
  }
  // Anti-vacuity, one pin per DIRECTION. The block count was the only floor
  // here, and it is satisfied by an upward-only walk — so the downward walk
  // could have been deleted the day it was written. The dialog's blocks
  // demonstrably have element children (the `<ul>` holds three `<li>`s, each
  // `<p>` may hold a `<strong>`), so a zero here means the descendant walk has
  // stopped visiting them.
  expect(checked, `${label ?? ''} — the reachability walk visited no block`).toBe(expected.length);
  expect(
    descendantsSeen,
    `${label ?? ''} — the descendant half of the reachability walk visited nothing`,
  ).toBeGreaterThan(0);
  // …and the attribute list is itself pinned, because "three attributes" is the
  // kind of claim that goes stale by one the next time somebody adds a rule.
  expect([...SUPPRESSING_ATTRS]).toEqual(['aria-hidden', 'hidden', 'inert']);
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
  expectNothingSilenced(expected, opts.label);
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
  /**
   * The invariant, as a NAMED function so it can be exercised against a control
   * that violates it — see the guard-the-guard below.
   */
  function expectToggleNameAgrees(expected: boolean) {
    const btn = ackToggle();
    expect(btn.getAttribute('aria-pressed')).toBe(String(expected));
    const name = accessibleName(btn).toLowerCase();
    // The name names the STATE the control is in, and `aria-pressed` says that
    // state is on. Not "what clicking will do" — that is what inverts.
    expect(name, `aria-pressed=${expected} under the name "${name}"`).toBe(
      expected ? 'acknowledged shown' : 'acknowledged hidden',
    );
  }

  it('GUARDS THE GUARD: the name check reads the ANNOUNCED name, not the text', () => {
    // ROUND 6. `accessibleName` was added to close round 5's NB3, and then
    // replacing it with `normalize(el.textContent)` was measured GREEN — the
    // fix had no subject, which is the same vacuity this branch keeps finding
    // one layer down. An `aria-label` is the cheapest way to restore the
    // defect (it reaches the control through `Button`'s `...rest` spread), so
    // an `aria-label` is what has to be injected.
    renderWith({ data: rows([row()]) });
    const btn = ackToggle();
    expect(accessibleName(btn)).toBe('Acknowledged shown');
    expectToggleNameAgrees(true);

    // The exact contradiction round 5 reported: announced as an ACTION, under
    // `aria-pressed="true"`, which says the action is already on.
    btn.setAttribute('aria-label', 'Hide acknowledged');
    expect(accessibleName(btn), 'the aria-label does not win').toBe('Hide acknowledged');
    expect(
      () => expectToggleNameAgrees(true),
      'an aria-label contradicting aria-pressed is admitted',
    ).toThrow();
    // …and `textContent` is untouched, which is why reading it cannot see this.
    expect(normalize(btn.textContent)).toBe('Acknowledged shown');
  });

  it('its NAME and its aria-pressed state agree, in both states', () => {
    renderWith({ data: rows([row()]) });
    for (const expected of [true, false]) {
      expectToggleNameAgrees(expected);
      // And the listing really is in that state, so the name is not just
      // internally consistent — it is true.
      expect(lastIncludeAcknowledged()).toBe(expected);
      fireEvent.click(ackToggle());
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
      // The ACCESSIBLE name, for the reason in `accessibleName`'s docblock: an
      // `aria-label` overriding the visible text is the cheapest way to restore
      // this defect, and reading `textContent` cannot see it.
      const name = accessibleName(ackToggle());
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

  // ── The reachable arm space, DERIVED from the component's own functions ──
  //
  // ROUND 5's BF1, and it is round 4's finding one level up. Round 4 added the
  // `AckOutcome` and `AckFooterState` axes to the anti-vacuity check, which then
  // asserted each axis MARGINALLY:
  //
  //   every stage appears somewhere in the table
  //   every consequence appears somewhere in the table
  //   every outcome appears somewhere in the table
  //   every footer state appears somewhere in the table
  //
  // Seven hand-written scenarios satisfy all four. The dialog's copy is a
  // function of the PRODUCT, and the product has THIRTEEN reachable cells — so
  // six of them were unpinned under a test titled "every reachable arm", and
  // round 5's gate fabricated a sentence into every one of the six with all
  // 1115 tests green. One of the six is `leaves-view × in-flight`: the state of
  // every acknowledgement issued from the filtered view. Another is
  // `left-listing × forbidden`: the control plane has refused the write AND the
  // row has left the listing.
  //
  // Four marginals do not make a product, so the table is gone. What replaces
  // it is an enumeration of the dialog's INPUTS, mapped through the component's
  // own exported `ackStage` / `ackListingConsequence` / `ackOutcome` — so the
  // reachable set is COMPUTED from the state machine rather than asserted
  // against it, and adding a state anywhere in those three functions changes
  // this set without anyone maintaining a list.
  //
  // The inputs are the four values the dialog reads: whether the listing still
  // holds the row, what upstream answered, which view the operator is in, and
  // whether the write is still out.

  /** What upstream answered. `none` is "nothing yet", not "success". */
  const ACK_ERRORS = {
    none: () => undefined,
    'resolved-404': ack404,
    'forbidden-403': ackForbidden,
    'other-503': ack503,
  } as const;
  type ErrKind = keyof typeof ACK_ERRORS;

  type DialogInput = {
    live: 'listed' | 'gone';
    error: ErrKind;
    pending: boolean;
    showAcknowledged: boolean;
  };

  type Arm = {
    stage: AckStage;
    consequence: AckListingConsequence | null;
    outcome: AckOutcome;
    footer: AckFooterState;
  };

  function armOf(i: DialogInput): Arm {
    const error = ACK_ERRORS[i.error]();
    const stage = ackStage(i.live === 'listed' ? row() : null, error);
    return {
      stage,
      consequence: ackListingConsequence(stage, i.showAcknowledged),
      outcome: ackOutcome(stage, error),
      // The footer is the one axis the component tests inline rather than
      // through a named function, so this expression is a hand copy of
      // `log-witness-alerts.tsx`'s footer conditions, and
      // `witness-ack-prose.ts` says so at `AckFooterState`. It is the weakest
      // link in the derivation and is named as such rather than left looking
      // derived.
      footer: stage === 'resolved' ? 'closed-out' : i.pending ? 'in-flight' : 'confirmable',
    };
  }

  /**
   * Every input tuple an operator can actually be in.
   *
   * The one exclusion is the only one there is: a mutation that has answered is
   * not still pending, so `pending` and a non-`none` error cannot both hold.
   * Demanding those tuples would make this test unsatisfiable rather than
   * strict, and the exclusion is stated here — once, with its reason — instead
   * of being spread through a hand-written table where it cannot be seen.
   */
  function reachableInputs(): DialogInput[] {
    const out: DialogInput[] = [];
    for (const live of ['listed', 'gone'] as const) {
      for (const error of Object.keys(ACK_ERRORS) as ErrKind[]) {
        for (const pending of [false, true]) {
          for (const showAcknowledged of [true, false]) {
            if (pending && error !== 'none') continue;
            out.push({ live, error, pending, showAcknowledged });
          }
        }
      }
    }
    return out;
  }

  const armKey = (a: Arm) =>
    `${a.stage} / ${a.consequence ?? 'no bullets'} / ${a.outcome} / ${a.footer}`;

  /** Put the dialog into the state `i` describes. */
  async function enterDialog(i: DialogInput) {
    const error = ACK_ERRORS[i.error]();
    if (i.pending) acknowledgeLogWitnessAlert.mockImplementation(() => new Promise(() => {}));
    else if (error) acknowledgeLogWitnessAlert.mockRejectedValue(error);
    else acknowledgeLogWitnessAlert.mockResolvedValue({ authority: AUTH, alerted: true });

    const { rerender } = renderWith({ data: rows([row()]) });
    // The toggle starts at "Acknowledged shown" — the unfiltered worklist — so
    // reaching `leaves-view` means switching AWAY from the default.
    if (!i.showAcknowledged) fireEvent.click(ackToggle());
    openConfirm();

    // Only confirm when the input says something came back or is still out. On
    // `error: none, pending: false` the dialog is in its pre-confirm state, and
    // confirming there would SUCCEED and close it.
    if (i.pending || error) {
      confirmAck();
      if (i.pending) {
        await waitFor(() => expect(dialog().textContent).toMatch(/acknowledging/i));
      } else if (i.error === 'resolved-404') {
        await waitFor(() =>
          expect(dialog().textContent).toMatch(/no longer an alert to acknowledge/i),
        );
      } else if (i.error === 'forbidden-403') {
        await waitFor(() => expect(dialog().textContent).toContain(ADMIN_ROUTE_FORBIDDEN));
      } else {
        await waitFor(() =>
          expect(dialog().textContent).toMatch(/could not record the acknowledgement/i),
        );
      }
    }
    // Last, so the error state above has already settled: the listing stops
    // holding the row while the dialog stands. The parent keeps the snapshot it
    // opened on, which is the round-3 fix that makes this state reachable at
    // all.
    if (i.live === 'gone') refetchTo([], rerender);
  }

  it('renders exactly the pinned copy, in every reachable arm', async () => {
    const inputs = reachableInputs();
    const armsWanted = new Set(inputs.map((i) => armKey(armOf(i))));

    // Anti-vacuity, asserted BEFORE the loop — and it is now about the PRODUCT,
    // not about four marginals. Thirteen is not a number anyone chose: it is
    // what the three exported functions produce over the input space, and it is
    // pinned so that a change to the state machine which silently collapses two
    // arms into one shows up here rather than as a quietly smaller matrix.
    expect(inputs.length, 'the input enumeration collapsed').toBe(20);
    expect(armsWanted.size, 'the reachable arm space changed shape').toBe(13);
    // The marginals are still asserted, because a product can be the right SIZE
    // while missing a member of one axis — and each set is read off a `Record`
    // keyed by one of the component's own unions, so none of them can drift.
    const arms = inputs.map(armOf);
    expect(new Set(arms.map((a) => a.stage))).toEqual(new Set(ALL_STAGES));
    expect(new Set(arms.map((a) => a.consequence).filter((c) => c !== null))).toEqual(
      new Set(ALL_CONSEQUENCES),
    );
    expect(new Set(arms.map((a) => a.outcome))).toEqual(new Set(ALL_OUTCOMES));
    expect(new Set(arms.map((a) => a.footer))).toEqual(new Set(ALL_FOOTER_STATES));

    const armsSeen = new Set<string>();
    for (const i of inputs) {
      cleanup();
      acknowledgeLogWitnessAlert.mockReset();
      await enterDialog(i);
      const arm = armOf(i);
      const error = ACK_ERRORS[i.error]();
      expectPinnedDialog({
        ...arm,
        authority: AUTH,
        reason: MISMATCH,
        diagnostic: error ? errorDiagnostic(error) : undefined,
        failedMessage:
          arm.outcome === 'failed'
            ? operatorErrorMessage(error, 'Could not record the acknowledgement')
            : undefined,
        label:
          `${armKey(arm)}  [live=${i.live} err=${i.error} ` +
          `pending=${i.pending} showAck=${i.showAcknowledged}]`,
      });
      armsSeen.add(armKey(arm));
    }
    // Every reachable arm was RENDERED, not merely enumerated. Without this the
    // loop could `continue` past one and the coverage claim would rest on the
    // derivation alone.
    expect([...armsSeen].sort(), 'an arm was enumerated but never rendered').toEqual(
      [...armsWanted].sort(),
    );
  }, 120_000);

  it('the 403 panel’s copy is the copy someone wrote down', () => {
    // ROUND 5's BF3. `witness-ack-prose.ts` used to IMPORT
    // `ADMIN_ROUTE_FORBIDDEN` and argue the import was safe because the
    // constant "has its own dedicated pin in `admin-key-parity.test.tsx`
    // (`:214-219`)". That pin is four `toContain`s and one `not.toMatch`; a
    // substring pin cannot bound what else the string says. Appending
    // ' The acknowledgement was recorded anyway.' to the constant left all 1115
    // tests green with the fabricated sentence in this dialog's 403 panel.
    //
    // The hand copy is the bound, and this is where the two are held together.
    // Whole-string equality: a word added, removed or reworded anywhere in 500
    // characters fails here.
    expect(ADMIN_ROUTE_FORBIDDEN).toBe(ACK_FORBIDDEN_PANEL);
  });

  it('no stylesheet rule can put text in the dialog', () => {
    // ROUND 5's NB6. jsdom applies no stylesheets, so a
    // `.modal-body ul::after { content: "…" }` rule reaches every operator and
    // no assertion in this repo — measured green with the rule in place. The
    // rendered-text pin cannot see it by construction, so the bound has to be
    // on the stylesheet.
    //
    // Every `content:` declaration in `app/globals.css` must be empty. Both of
    // the two that exist are (`content: ''` on decorative pseudo-elements), and
    // a decorative pseudo-element does not need text. If one ever legitimately
    // does, this fails and the copy gets written down somewhere a test can read
    // it.
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const decls = [...css.matchAll(/(^|[;{\s])content\s*:\s*([^;}]*)/g)].map((m) => m[2].trim());
    // Anti-vacuity: the scan must FIND the declarations, or an empty list
    // passes the loop below and the guard means nothing.
    expect(decls.length, 'the content: scan found no declarations at all').toBeGreaterThan(1);
    for (const value of decls) {
      expect(value, `a stylesheet rule renders text: content: ${value}`).toMatch(/^(''|"")$/);
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

  /**
   * Move the first word of `to` onto the end of `from`.
   *
   * ROUND 6's B5. The block half's wiring injection was `splitFirstParagraph`,
   * and its docblock claimed "each injection has a known owner, established
   * separately above". That stopped being true the moment round 5 added the
   * reachability half: splitting a paragraph adds a BLOCK, and the
   * reachability half's anti-vacuity pin is `checked === expected.length`, so
   * the split fires that too. Two owners, and the measurement is exact —
   * deleting `expectBlocksPinned` from the composite left 1122/1122 green, and
   * deleting it TOGETHER WITH the reachability count pin killed one test. The
   * half that pins per-block wording, order and count could be dropped from
   * the composite silently, which is the masking shape the halves were split
   * apart to remove, reintroduced by the fix for round 5's own finding.
   *
   * This is the injection with exactly one owner. Moving a word across a block
   * boundary leaves:
   *
   *   - the SQUASHED concatenation identical, because the words keep their
   *     order and `squash` is blind to the space between them → the
   *     nothing-outside half cannot see it;
   *   - the block COUNT identical → the reachability half cannot see it;
   *   - every attribute untouched → the announced half cannot see it;
   *   - nothing suppressed → the reachability half cannot see it that way
   *     either;
   *   - and BOTH block texts different → only the block half can see it.
   *
   * It is also the defect that matters most in this file: a sentence whose
   * words have drifted across the boundary between "what the dialog is doing"
   * and "what confirming records" reads as the same paint and means something
   * else.
   *
   * The two elements must be ADJACENT in block order for the concatenation to
   * be preserved, which is asserted rather than assumed — a refactor that puts
   * a block between them would otherwise turn this into a two-owner injection
   * again without anybody noticing.
   */
  function moveWordAcrossBoundary(from: HTMLElement, to: HTMLElement) {
    const blocks = [...dialog().querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];
    expect(
      blocks.indexOf(to) - blocks.indexOf(from),
      'the boundary this injection moves a word across is no longer a boundary between adjacent blocks',
    ).toBe(1);
    const walker = to.ownerDocument.createTreeWalker(to, NodeFilter.SHOW_TEXT);
    let first: Text | null = null;
    while (walker.nextNode() && first === null) {
      if ((walker.currentNode as Text).data.trim() !== '') first = walker.currentNode as Text;
    }
    expect(first, 'the receiving block carries no text to move').toBeTruthy();
    const words = first!.data.trimStart().split(/\s+/);
    const moved = words.shift()!;
    first!.data = ' ' + words.join(' ');
    from.append(to.ownerDocument.createTextNode(' ' + moved));
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

  it('the block pin catches a DUPLICATED block and a REORDERED one', () => {
    // ROUND 5's NB1. Both of these loosenings were measured green:
    //
    //   `toEqual(expected)` -> `toEqual(expect.arrayContaining(expected))`
    //   `toEqual(expected)` -> a `new Set(...)` comparison
    //
    // The split-paragraph injection above cannot catch either, because it
    // REMOVES the original block: a loosened equality still throws, the
    // guard-the-guard still passes, and the loosening ships. So the half needs
    // the two injections that a superset check and an order-blind check
    // respectively admit.
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

    // A DUPLICATE: every expected block is still present, so a containment
    // check passes. Exact equality does not — the list is one element longer.
    const facts = modalBody().querySelectorAll('li');
    const clone = facts[0].cloneNode(true) as HTMLElement;
    facts[0].after(clone);
    expect(() => expectBlocksPinned(expected), 'a duplicated block is admitted').toThrow();
    clone.remove();
    expectBlocksPinned(expected);

    // A REORDER: the same multiset of blocks in a different order. A `Set`
    // comparison passes; a list comparison does not. The sentences are ordered
    // for a reason — "it records which key" before "it does not clear the
    // alert" before what the operator will see next — and the docblock claims
    // the order is pinned.
    const [first, second] = [...modalBody().querySelectorAll('li')];
    second.after(first);
    expect(() => expectBlocksPinned(expected), 'a reordered block list is admitted').toThrow();
    // BE EXACT ABOUT WHAT THIS TEST IS FOR, because the first draft of this
    // comment claimed the nothing-outside half was blind to both and that is
    // FALSE — measured. It compares the whole concatenation, so it sees a
    // duplicate (more text) and a reorder (the same text in a different order)
    // just as readily.
    //
    // Which makes these two injections a test of this half's STRENGTH, not of
    // its being WIRED IN. The wiring is what the split-paragraph injection
    // above establishes, because that one really is invisible to the other
    // halves. Both jobs are needed and they are not the same job; conflating
    // them is how the loosened equality stayed invisible for a round.
    expect(() => expectNothingOutside(expected), 'nothing-outside sees a reorder too').toThrow();
  });

  it('the announced pin catches an attribute nobody thought of, and a visible <input value>', () => {
    // ROUND 5's BF2, the two additions. The scan used to walk a list of
    // attributes that DO announce; both of these walked past it with the whole
    // suite green.
    renderWith({ data: rows([row()]) });
    openConfirm();
    expectNothingAnnounced('none');
    const expected = expectedDialogBlocks({
      stage: 'alerting',
      consequence: 'stays-listed',
      outcome: 'none',
      footer: 'confirmable',
      authority: AUTH,
      reason: MISMATCH,
    });

    // An ARIA attribute that was not on the old list. There is no list of these
    // that can be completed, which is why the licence is now the other way
    // round.
    modalBody().setAttribute('aria-keyshortcuts', 'Confirming clears the alert');
    expect(() => expectNothingAnnounced('none'), 'aria-keyshortcuts is admitted').toThrow();
    modalBody().removeAttribute('aria-keyshortcuts');
    expectNothingAnnounced('none');

    // A form control whose VALUE is its visible text. It is not a text node, it
    // matches none of the block selectors, and `value` was not on the old list
    // — so it evaded all three halves on every arm, not merely the unpinned
    // ones. The same escape beat the sibling registry-card guard on #95, found
    // by a different gate one day apart.
    const input = document.createElement('input');
    input.type = 'button';
    input.disabled = true;
    input.setAttribute('value', 'Confirming clears this alert and the retained head.');
    modalBody().appendChild(input);
    expect(() => expectNothingAnnounced('none'), 'an <input value> is admitted').toThrow();
    // …and the two text halves really are blind to it, which is the point.
    expect(() => expectBlocksPinned(expected)).not.toThrow();
    expect(() => expectNothingOutside(expected)).not.toThrow();
  });

  it('the reachability pin catches copy that is SILENCED rather than added', () => {
    // ROUND 5's BF2, the sharpest arm: `aria-hidden` on the three-facts `<ul>`.
    // Nothing is added, no attribute value carries copy, `textContent` is
    // unchanged — and every sentence this dialog exists to state is gone from
    // the accessibility tree. The three other halves all bound what is ADDED,
    // so all three stayed green.
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
    expectNothingSilenced(expected);

    const facts = modalBody().querySelector('ul') as HTMLElement;
    facts.setAttribute('aria-hidden', 'true');
    expect(() => expectNothingSilenced(expected), 'a silenced <ul> is admitted').toThrow();
    // …and the other three halves are blind to it, which is why there is a
    // fourth.
    expect(() => expectBlocksPinned(expected)).not.toThrow();
    expect(() => expectNothingOutside(expected)).not.toThrow();
    expect(() => expectNothingAnnounced('none')).not.toThrow();
    facts.removeAttribute('aria-hidden');

    // The lead paragraph too, so the half is not accidentally about the `<ul>`.
    const lead = modalBody().querySelector('p') as HTMLElement;
    lead.setAttribute('aria-hidden', 'true');
    expect(() => expectNothingSilenced(expected), 'a silenced lead is admitted').toThrow();
    lead.removeAttribute('aria-hidden');

    // `hidden` removes the node from both trees — the same defect, a different
    // spelling.
    facts.setAttribute('hidden', '');
    expect(() => expectNothingSilenced(expected), 'a `hidden` <ul> is admitted').toThrow();
  });

  it('the announced pin catches an id reference that points OUT of the dialog', () => {
    // ROUND 5's NB2: deleting the id-reference loop from
    // `expectNothingAnnounced` was silent, because nothing exercised it. A
    // component mutation that pointed `aria-describedby` outside the dialog WAS
    // caught — so the loop works and only its vacuity pin was missing.
    //
    // An id reference carries no text of its own, which is why it is licensed
    // as non-announcing; what it points AT is text, and if that lives outside
    // the dialog no half can see it.
    renderWith({ data: rows([row()]) });
    openConfirm();
    expectNothingAnnounced('none');

    const outside = document.createElement('p');
    outside.id = 'ack-aside';
    outside.textContent = 'The acknowledgement has been recorded and the alert is cleared.';
    document.body.appendChild(outside);
    modalBody().querySelector('p')!.setAttribute('aria-describedby', 'ack-aside');
    expect(
      () => expectNothingAnnounced('none'),
      'an aria-describedby pointing out of the dialog is admitted',
    ).toThrow();
    // …and it passes again once the target is INSIDE, so the check is about
    // where the id resolves and not about the attribute existing.
    outside.remove();
    modalBody().appendChild(outside);
    expectNothingAnnounced('none');
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

  it('each injection is seen by EXACTLY ONE half — the wiring test measures its own premise', () => {
    // ROUND 6's B5, and the reason it is a test rather than a paragraph. The
    // wiring test below says "each injection has a known owner, established
    // separately above". That sentence was TRUE when it was written and FALSE
    // one commit later, because round 5 added a fourth half whose anti-vacuity
    // pin counts blocks — and the block half's injection was a paragraph split,
    // which adds one. Nothing noticed, because the claim lived in a comment.
    //
    // An injection with two owners measures neither of them: with it, dropping
    // either owner from the composite is green. So the premise is measured
    // here, as a matrix — every injection against every half — and the
    // requirement is exactly one `throw` per row. A future half that happens to
    // see an existing injection is then a red test on the day it is added,
    // which is the day the information is cheap.
    const expectedFor = () =>
      expectedDialogBlocks({
        stage: 'alerting',
        consequence: 'stays-listed',
        outcome: 'none',
        footer: 'confirmable',
        authority: AUTH,
        reason: MISMATCH,
      });
    const halves: Array<[string, () => void]> = [
      ['blocks', () => expectBlocksPinned(expectedFor())],
      ['outside', () => expectNothingOutside(expectedFor())],
      ['announced', () => expectNothingAnnounced('none')],
      ['reachable', () => expectNothingSilenced(expectedFor())],
    ];
    const injections: Array<[string, () => void]> = [
      ['a word moved across a block boundary', () => {
        moveWordAcrossBoundary(
          modalBody().querySelector('p') as HTMLElement,
          modalBody().querySelector('li') as HTMLElement,
        );
      }],
      ['a bare span', () => {
        const el = document.createElement('span');
        el.textContent = 'and the retained head has been cleared';
        modalBody().appendChild(el);
      }],
      ['a title attribute', () => {
        modalBody().setAttribute('title', 'Confirming clears the alert.');
      }],
      ['a silenced fact list', () => {
        (modalBody().querySelector('ul') as HTMLElement).setAttribute('aria-hidden', 'true');
      }],
    ];
    // The matrix is square and each injection is meant for the half at the same
    // index, so a reordering of either list is a failure rather than a silent
    // re-attribution.
    expect(injections.length, 'the matrix is not square').toBe(halves.length);

    for (const [index, [what, inject]] of injections.entries()) {
      cleanup();
      renderWith({ data: rows([row()]) });
      openConfirm();
      // Every half passes before the injection, or the row proves nothing.
      for (const [name, half] of halves) {
        expect(half, `${what}: the ${name} half fails before the injection`).not.toThrow();
      }
      inject();
      const seenBy = halves.filter(([, half]) => {
        try {
          half();
          return false;
        } catch {
          return true;
        }
      });
      expect(
        seenBy.map(([name]) => name),
        `${what} must be visible to exactly the ${halves[index][0]} half and no other`,
      ).toEqual([halves[index][0]]);
    }
  });

  it('all four halves are WIRED IN, not merely present', () => {
    // The per-half tests above prove each half catches its own injection. They
    // say nothing about whether `expectPinnedDialog` still CALLS all four — a
    // deleted call site leaves every one of them green.
    //
    // This is not the masking the halves were split to avoid: masking is when
    // one assertion stands for two checks and either can satisfy it. Here each
    // injection has EXACTLY ONE owner, and that is measured by the test
    // immediately above rather than asserted here — round 6's B5 is what
    // happens when it is only asserted.
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
      // block half — a word moved ACROSS a block boundary. Round 6's B5: the
      // injection here used to be `splitFirstParagraph`, and once round 5 added
      // the reachability half that injection had two owners (a split adds a
      // block, and the reachability half counts blocks), so deleting
      // `expectBlocksPinned` from the composite was silent. A moved word leaves
      // the concatenation, the count, the attributes and the reachability all
      // identical, and only the per-block texts different. See
      // `moveWordAcrossBoundary`, and the exclusivity is measured in the test
      // below rather than argued here.
      ['a word moved across a block boundary', () => {
        moveWordAcrossBoundary(
          modalBody().querySelector('p') as HTMLElement,
          modalBody().querySelector('li') as HTMLElement,
        );
      }],
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
      // reachability half — a SUPPRESSION, which is the one thing none of the
      // other three can see, and therefore the only injection that can tell
      // whether this call site is still there.
      ['a silenced fact list', () => {
        (modalBody().querySelector('ul') as HTMLElement).setAttribute('aria-hidden', 'true');
      }],
    ];
    // Anti-vacuity: one injection per half, and a `for` over a shortened table
    // asserts nothing about the halves it dropped.
    expect(injections).toHaveLength(4);

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
