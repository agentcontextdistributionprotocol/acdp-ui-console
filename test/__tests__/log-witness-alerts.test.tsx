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
import ts from 'typescript';
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
  AckRecordEffect,
} from '@/components/registries/log-witness-alerts';
import {
  ackListingConsequence,
  ackOutcome,
  ackRecordEffect,
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
  ALL_RECORD_EFFECTS,
  ALL_STAGES,
  ID_REFERENCE_ATTRS,
  NON_ANNOUNCING_ATTRS,
  VALUELESS_ATTRS,
  expectedAnnounced,
  expectedDialogBlocks,
  normalize,
  squash,
  inlineStyleDeclarations,
  type AckFooterState,
} from '@/test/support/witness-ack-prose';
import * as PROSE from '@/test/support/witness-ack-prose';

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
 * Every text-bearing LEAF inside `root`, in document order.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ROUND 8's B2/B3. The DIALOG's copy is bounded by a closed set — every
 * block pinned by wording, order and count, plus "and nothing else". The
 * CARD's copy was bounded by four regexes: `/healthy/i`, `/all (logs|
 * registries) (are )?(ok|fine|verified)/i`, `/no (problems|issues)\b/i` and
 * `/logs? (are|is) healthy|all clear|everything is fine/i`.
 *
 * That is an enumeration of four ways to over-claim, on a surface whose
 * entire reason for existing is that an absence of rows must not read as an
 * all-clear. "Nothing to worry about here", "Transparency looks good",
 * "You're covered" and "No alerts — you're all set" all pass every one of
 * them. The dialog got the closed set because round 4 found the open one
 * failing; the card never got the same treatment.
 *
 * ── WHY A DERIVED LEAF WALK AND NOT A TAG LIST ───────────────────────
 *
 * `BLOCK_SELECTOR` (`h2, p, li, .card, .modal-footer button`) is itself an
 * enumeration — closed for the dialog only because `expectNothingOutside`
 * bounds whatever it missed. It could not be reused here: the card's copy
 * arrives through `EmptyState`, which renders its title and description in
 * bare `<div>`s, through `ErrorPanel`, and through `<th>`/`<td>`. The list
 * would have to grow once per component wired into this card, and a
 * component added later would contribute copy no pin could see.
 *
 * So a LEAF is defined structurally: an element carrying text with no
 * descendant element that also carries text — plus any text node sitting
 * loose beside such children, which is the bare-sentence case half two of
 * the dialog pin exists to catch. Every string a reader can see is in the
 * product exactly once, and a new component contributes its copy to the pin
 * by construction rather than by somebody remembering to widen a selector.
 *
 * Because the walk is total, there is no "and nothing else" half to write:
 * the dialog needs one because its selector can miss, and this cannot. The
 * guard-the-guard below proves that by feeding it the two shapes
 * `BLOCK_SELECTOR` does miss.
 * ══════════════════════════════════════════════════════════════════════
 */
function textLeaves(root: HTMLElement): string[] {
  const out: string[] = [];
  const hasText = (n: Node): boolean => (n.textContent ?? '').trim() !== '';
  const walk = (el: Element): void => {
    const textBearingKids = [...el.children].filter(hasText);
    if (textBearingKids.length === 0) {
      const t = normalize(el.textContent);
      if (t !== '') out.push(t);
      return;
    }
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (hasText(node)) out.push(normalize(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        walk(node as Element);
      }
    }
  };
  walk(root);
  return out;
}

/** The card's copy, closed. */
function cardCopy(): string[] {
  return textLeaves(section());
}

/**
 * The table's header row, in the order the cells are rendered.
 *
 * Shared between the header test and the card's copy pin. Written out once and
 * asserted twice: a column renamed in the component is red in both places, and
 * neither copy of the list can drift into agreeing with a stale one.
 */
const TABLE_COLUMNS: readonly string[] = [
  'Authority',
  'Reason',
  'Detail',
  // "environmental" is load-bearing: the counter tracks transport failures
  // only, so unqualified beside "Root mismatch (split view)" the number reads
  // as this alert's recurrence count. Pinned so the qualification cannot
  // quietly revert.
  'Consecutive environmental failures',
  'Detected',
  'State',
  // Phase 3's column. The header is `Acknowledge`; the CELL's control is
  // labelled per row ("Acknowledge <authority>" / "Re-acknowledge …"), so the
  // two are checked separately.
  'Acknowledge',
];

/**
 * The chrome every arm of the card carries: heading, subtitle, toggle.
 *
 * Written once and spread into each arm's expectation rather than repeated,
 * so the six arms differ in exactly the part that is supposed to differ. The
 * subtitle's third clause is a function of the toggle, which is why it takes
 * the flag.
 */
function cardChrome(showAcknowledged: boolean): string[] {
  return [
    'Witness alert worklist',
    showAcknowledged
      ? 'Durable transparency-log detections · one row per alerting authority · acknowledged alerts stay listed until the condition clears'
      : 'Durable transparency-log detections · one row per alerting authority · acknowledged alerts are filtered out of this view, but stay open until the condition clears',
    showAcknowledged ? 'Acknowledged shown' : 'Acknowledged hidden',
  ];
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
    // ROUND 8's B3: these three are a FAST LINT, not the bound. They name the
    // specific over-claims this surface was built to avoid, so a reader learns
    // why the copy is worded as it is — but "Nothing to worry about here"
    // passes all three. The bound is the closed set in "the CARD says exactly
    // what it says", which pins this arm's copy word for word, and which
    // asserts these same regexes over the union of all six arms so the two
    // cannot drift apart.
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
    // The same prohibitions as the default arm — and, as there, a fast lint
    // over the closed set that actually bounds this arm (see "the CARD says
    // exactly what it says"). A filtered emptiness is even further from an
    // all-clear than a full one.
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
    // Fast lint again; the word-for-word bound on this arm is the card copy
    // pin at the bottom of this file.
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
  it('names all seven columns, in the order the cells are rendered', () => {
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
    expect(headers).toEqual(TABLE_COLUMNS);
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

function openConfirm(authority = 'registry-c.playground.local', reAcknowledge = false) {
  // `fireEvent`, matching every other component test in this suite —
  // `@testing-library/user-event` is not a dependency here.
  //
  // The control is named `Acknowledge <authority>` or `Re-acknowledge
  // <authority>`, and round 6's B1 found that the second was never clicked by
  // any test in this file. Anchored at the start so `Acknowledge` does not
  // match `Re-acknowledge` — without the anchor the default argument would
  // silently open a re-acknowledge dialog and the axis would test nothing.
  const prefix = reAcknowledge ? 'Re-acknowledge' : 'Acknowledge';
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(`^${prefix} ${authority.replace(/\./g, '\\.')}$`, 'i'),
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
function expectNothingAnnounced(outcome: AckOutcome, label?: string, hasDiagnostic = true) {
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
    new Set(expectedAnnounced(outcome, hasDiagnostic)),
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

  // ── ROUND 8's B1: THE STYLING CHANNEL, WHICH THIS COMPONENT USES ────
  //
  // Everything above reads ATTRIBUTES. `<div style={{ display: 'none' }}>`
  // around the body grid was green on the whole suite while `aria-hidden` on
  // the same element is red — the walk caught the weaker suppression and not
  // the stronger one. See `inlineStyleDeclarations` for why the ALLOW side is
  // bounded rather than a denylist of properties.
  //
  // The scan root is the OVERLAY, not the dialog: the overlay covers the
  // viewport and is above every block.
  const unpinned = inlineStyleDeclarations(dialogScanRoot(), blocks).filter(
    (d) => !INLINE_STYLES_ON_DIALOG.includes(d),
  );
  expect(
    unpinned,
    `${label ?? ''} — inline style declarations on or above the dialog that nothing has pinned`,
  ).toEqual([]);
}

/** Every inline style declaration on or above the confirm dialog. Measured. */
const INLINE_STYLES_ON_DIALOG: readonly string[] = [
  'button background: none',
  'button border: medium',
  'button color: var(--muted)',
  'button cursor: pointer',
  'button display: flex',
  'div align-items: center',
  'div color: var(--muted)',
  'div display: flex',
  'div display: grid',
  'div font-size: 12px',
  'div gap: 10px',
  'div.card align-items: center',
  'div.card align-items: stretch',
  'div.card display: flex',
  'div.card flex-direction: column',
  'div.card gap: 10px',
  'div.card padding: 20px',
  'p margin: 0px',
  'ul display: grid',
  'ul gap: 6px',
  'ul margin: 0px',
  'ul padding-left: 18px',
];

type PinOpts = {
  stage: AckStage;
  consequence: AckListingConsequence | null;
  outcome: AckOutcome;
  footer: AckFooterState;
  // ROUND 7's N12: whether this acknowledgement is the first one on the row or
  // overwrites an existing one. Required, not optional, for the same reason
  // `AckStage` is exhaustive — a new arm must state what it claims the write
  // records, rather than inheriting the previous arm's sentence.
  recordEffect: AckRecordEffect;
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
  // ROUND 6's N9: whether the disclosure control is expected is a function
  // of whether there IS a diagnostic, not of the outcome alone — a non-
  // `ApiError` failure has none, and `ErrorDetail` correctly renders nothing.
  expectNothingAnnounced(opts.outcome, opts.label, opts.diagnostic !== undefined);
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
  // ── ROUND 6's B1: AN ENUMERATION OF FOUR IS NOT AN ENUMERATION ───────
  //
  // The docblock above said this "enumerates the dialog's INPUTS", and it
  // enumerated four of them. The dialog reads more, and round 6 measured a
  // fabricated, FALSE sentence into each missing axis, every one at 1122/1122
  // green with typecheck and lint clean:
  //
  //   demoMode                    `{!demoMode && <p>The acknowledgement was
  //                               recorded anyway and the alert is now
  //                               cleared.</p>}`. The sharpest of the four,
  //                               because the gate is INVERTED relative to the
  //                               harness: `afterEach` forces demo mode on, so
  //                               this renders in every REAL deployment — the
  //                               only place the write actually reaches the
  //                               control plane — and never where the tests
  //                               look.
  //   live.reason                 a sentence gated on `reason ===
  //                               'log_id_changed'`. Every pinned arm used
  //                               `root_mismatch`.
  //   openedOn.acknowledgedAt     a sentence gated on a row that has been
  //                               acknowledged before. The Re-acknowledge
  //                               dialog was entirely unpinned: no test
  //                               anywhere opened one.
  //   the error's KIND            a sentence gated on `!(error instanceof
  //                               ApiError)`. Reachable: `fetchJson` lets a
  //                               `fetch()` TypeError propagate raw, so a
  //                               browser going offline mid-write lands here.
  //
  // The recurring shape, again: an enumeration under a closed-set docblock.
  // Three of the four are now AXES of this product, and `reason` is bounded
  // structurally instead — see `the dialog may read NOTHING this enumeration
  // does not model`, which parses the component and refuses a read of anything
  // outside a pinned set. The two answer different halves: the product proves
  // the copy is the same across the values of an input, and the structural
  // bound proves there is no input the product has not heard of. Neither is
  // sufficient, which is why round 6 found four holes behind a docblock that
  // claimed the first one alone was enough.

  /**
   * What upstream answered. `none` is "nothing yet", not "success".
   *
   * `offline` is round 6's fourth axis: a raw `TypeError`, which is what
   * `fetch()` throws when the network is gone and what `fetchJson` lets
   * through untouched. It is NOT an `ApiError`, so `errorDiagnostic` returns
   * `undefined` and the failed arm has nothing to disclose — a state the arm
   * space could not previously reach and whose expected copy the announced
   * table got wrong (N9).
   */
  const ACK_ERRORS = {
    none: () => undefined,
    'resolved-404': ack404,
    'forbidden-403': ackForbidden,
    'other-503': ack503,
    offline: () => new TypeError('Failed to fetch'),
  } as const;
  type ErrKind = keyof typeof ACK_ERRORS;

  type DialogInput = {
    live: 'listed' | 'gone';
    error: ErrKind;
    pending: boolean;
    showAcknowledged: boolean;
    /** Round 6's B1: the mode the write is issued in. */
    demoMode: boolean;
    /** Round 6's B1: whether the dialog was opened from a Re-acknowledge row. */
    reAcknowledge: boolean;
    /**
     * Whether the row is acknowledged AS THE LISTING HOLDS IT NOW — which is a
     * different fact from `reAcknowledge`, the snapshot the dialog opened on.
     *
     * ── ROUND 8's B5: TWO INPUTS, ONE AXIS ───────────────────────────
     *
     * `ackRecordEffect(live, openedOn)` reads `(live ?? openedOn)
     * .acknowledgedAt`, and the preference for the LIVE row is the whole
     * reason the function takes two arguments. Round 7 gave the product ONE
     * axis for both — `subjectRow(reAcknowledge)` was handed over as the
     * snapshot AND put in the listing — so `live.acknowledgedAt !==
     * openedOn.acknowledgedAt` was never rendered, and rewriting the function
     * as `openedOn.acknowledgedAt === null ? 'first' : 'replaces'` was green.
     * The two-argument signature was untested in the one respect that made it
     * two arguments.
     *
     * Both disagreements are reachable, and neither is exotic:
     *
     *   live acked, snapshot not — another operator acknowledged the row while
     *     this dialog stood open, and the listing refetched underneath it.
     *   live NOT acked, snapshot acked — the alert re-fired with a DIFFERENT
     *     reason, which is the one case upstream clears `acknowledgedAt` on
     *     (see the resurfacing rule this dialog's own copy states).
     *
     * Meaningless when `live` is `gone`, and constrained to one value there by
     * `reachableInputs` so the arm space does not double with duplicates.
     */
    liveAcked: boolean;
  };

  type Arm = {
    stage: AckStage;
    consequence: AckListingConsequence | null;
    outcome: AckOutcome;
    footer: AckFooterState;
    recordEffect: AckRecordEffect;
  };

  /**
   * The row the operator opened the dialog on.
   *
   * ROUND 7's N12. One helper, used by BOTH `armOf` and `enterDialog`, because
   * the expected copy and the rendered copy now disagree about the whole first
   * bullet if the two builds of this row drift apart — and "the fixture the
   * expectation derives from is not the fixture the component rendered" is a
   * failure that reads as a copy bug.
   */
  const subjectRow = (reAcknowledge: boolean): LogWitnessAlertRow =>
    reAcknowledge
      ? row({ acknowledgedAt: '2026-09-27T09:00:00.000Z', acknowledgedBy: 'a1b2c3d4...' })
      : row();

  function armOf(i: DialogInput): Arm {
    const error = ACK_ERRORS[i.error]();
    // The row AS THE LISTING HOLDS IT — round 8's B5. Built from `liveAcked`,
    // not from `reAcknowledge`, so the two can disagree.
    const liveRow = i.live === 'listed' ? subjectRow(i.liveAcked) : null;
    const stage = ackStage(liveRow, error);
    return {
      stage,
      consequence: ackListingConsequence(stage, i.showAcknowledged),
      outcome: ackOutcome(stage, error),
      // ══════════════════════════════════════════════════════════════
      // ROUND 8's B5, SECOND HALF: THE EXPECTATION CAME FROM THE SUBJECT
      //
      // This read `ackRecordEffect(liveRow, subject)` — the component's own
      // function, on the component's own arguments — under a docblock saying a
      // hand copy "would not have" the fall-back to `openedOn`. It is a
      // tautology: rewriting the function as `openedOn.acknowledgedAt === null
      // ? 'first' : 'replaces'` — deleting the live-row preference that is the
      // entire reason it takes two arguments — was 101/101 green WITH the new
      // disagreement axis in place, because the expectation moved with the
      // mutation.
      //
      // So it is expressed from the INPUT AXES instead. A hand expression that
      // drifts from a correct component change is RED, which is the right
      // outcome: copy that chooses between two sentences is a thing a reviewer
      // should have to re-state. A tautology has no such failure mode and no
      // such value.
      //
      // `ackRecordEffect`'s own truth table is pinned separately, below, so
      // this expression and the function are two derivations rather than one.
      // ══════════════════════════════════════════════════════════════
      recordEffect: (i.live === 'listed' ? i.liveAcked : i.reAcknowledge) ? 'replaces' : 'first',
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
            for (const demoMode of [true, false]) {
              for (const reAcknowledge of [false, true]) {
               for (const liveAcked of [false, true]) {
                if (pending && error !== 'none') continue;
                // ROUND 8's B5. With no live row there is nothing for
                // `liveAcked` to describe, so the `gone` arm takes one value
                // rather than two identical ones.
                if (live === 'gone' && liveAcked) continue;
                // A row that has never been acknowledged cannot be re-opened
                // from a Re-acknowledge control, and a row that HAS been
                // acknowledged is hidden from the filtered view — so it cannot
                // be confirmed from there. This is a fact about the listing,
                // not about the dialog, and stating it here is what keeps it
                // from being spread through a hand-written table.
                if (reAcknowledge && !showAcknowledged) continue;
                // The same fact about the listing, applied to the row as it is
                // NOW: an acknowledged row is not in the unacknowledged-only
                // view, so it cannot be the live row there.
                if (liveAcked && !showAcknowledged) continue;
                out.push({ live, error, pending, showAcknowledged, demoMode, reAcknowledge, liveAcked });
               }
              }
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * The identity of a rendered arm, derived from the arm's OWN members.
   *
   * ROUND 7's N12 found this hand-written as `${a.stage} / ${a.consequence} /
   * ${a.outcome} / ${a.footer}` — four members spelled out — so adding
   * `recordEffect` to `Arm` left the coverage set collapsing arms that differ
   * only in the new member, and the "every enumerated arm was rendered" check
   * silently compared a coarser partition than the one the copy depends on.
   * (The absolute counts that used to be quoted here went stale within two
   * rounds — the same defect in miniature. The arm count is asserted below,
   * against the enumeration, rather than narrated in a comment.)
   * `tsc` cannot catch that: a template literal that reads four of five
   * members is well typed.
   *
   * Keyed off `Object.keys(a)` instead, so a new member of `Arm` is in the key
   * the moment it is in the object. There is no list to keep complete.
   */
  const armKey = (a: Arm) =>
    (Object.keys(a) as (keyof Arm)[])
      .sort()
      .map((k) => `${k}=${a[k] ?? 'no bullets'}`)
      .join(' / ');

  // ── THE OTHER HALF OF B1: WHAT THE DIALOG MAY READ ──────────────────
  //
  // The product above proves the copy is the same across the values of every
  // input it MODELS. It says nothing about an input it has never heard of, and
  // that is exactly how round 6 got four fabricated sentences onto this dialog
  // — `demoMode`, `reason`, `acknowledgedAt` and the error's kind were all
  // read by a mutation and by nothing that was looking.
  //
  // Adding three of them as axes fixes those three. It does not fix the NEXT
  // one, and "add another axis" has now failed twice in this file's history
  // (round 4 added two, round 5 replaced the table, round 6 found four more).
  // So the supply is bounded instead: the dialog's rendered output may depend
  // on nothing outside a pinned set, and that is read off the component's own
  // source rather than remembered.
  //
  // The rule is per-IDENTIFIER, and the identifiers are the closed side. Every
  // name the dialog's JSX evaluates must be licensed, and a licence says what
  // the name may be used FOR, because "the dialog reads `reason`" and "the
  // dialog BRANCHES on `reason`" are different claims and only the second is a
  // defect. `reason` may be an argument to `reasonLabel` and nothing else;
  // `demoMode` may not appear in the returned JSX at all.

  /**
   * Names the dialog's rendered output may depend on, and how.
   *
   * `interpolated` — the value reaches the screen through a pinned formatter
   * and is a parameter of `expectedDialogBlocks`, so the product does not need
   * an axis for it: every value produces the same sentence with a different
   * word in it, and `reasonLabel`'s own six-way test covers the words.
   *
   * `modelled` — the value CHOOSES copy, and `DialogInput` carries an axis for
   * it, so the product renders every one of its values.
   */
  const DIALOG_READS: Record<string, 'interpolated' | 'modelled'> = {
    // Interpolated into the lead paragraph and the heading.
    authority: 'interpolated',
    reason: 'interpolated',
    // Modelled by an axis of `DialogInput`.
    live: 'modelled',
    openedOn: 'modelled',
    showAcknowledged: 'modelled',
    stage: 'modelled',
    consequence: 'modelled',
    outcome: 'modelled',
    mut: 'modelled',
    error: 'modelled',
    // ROUND 7's N12. `recordEffect` chooses between two spellings of the first
    // bullet, so it is `modelled` and `DialogInput`'s `reAcknowledge` axis is
    // the thing that renders both of its values.
    recordEffect: 'modelled',
    // ROUND 8's B4. `const resolved = stage === 'resolved'` is a read, and it
    // was invisible to this guard for as long as the guard skipped every
    // lower-case identifier. It is `modelled` because it is a function of
    // `stage`, which the product renders every value of.
    resolved: 'modelled',
  };

  /** Identifiers that are structure, not data: components, helpers, hooks. */
  const DIALOG_CALLS = [
    'Modal',
    'Button',
    'ErrorPanel',
    'ErrorDetail',
    'reasonLabel',
    'operatorErrorMessage',
    'errorDiagnostic',
    'onClose',
    'ackStage',
    'ackListingConsequence',
    'ackOutcome',
    'ackRecordEffect',
  ];

  /**
   * Copy constants the dialog renders, which must come from the prose module.
   *
   * The third licence class, and it exists because the first run of the
   * structural guard found two names nobody had classified —
   * `ACK_ALREADY_RESOLVED` and `ADMIN_ROUTE_FORBIDDEN` — which is the guard
   * doing its job on the code as it stands rather than on a mutation.
   *
   * A copy constant is safe for a reason the other two classes do not have: it
   * is a fixed string, so it cannot vary with an input, and it is compared
   * character for character by `expectedDialogBlocks`. What makes the class
   * closed rather than an allow-list is the assertion below — every member
   * must be a string EXPORTED BY `witness-ack-prose.ts`, so a local constant
   * spelled in the component (which is how unreviewed copy gets onto a screen)
   * is refused whatever it is called.
   */
  const DIALOG_COPY = ['ACK_ALREADY_RESOLVED', 'ADMIN_ROUTE_FORBIDDEN'];

  /** Put the dialog into the state `i` describes. */
  async function enterDialog(i: DialogInput) {
    const error = ACK_ERRORS[i.error]();
    if (i.pending) acknowledgeLogWitnessAlert.mockImplementation(() => new Promise(() => {}));
    else if (error) acknowledgeLogWitnessAlert.mockRejectedValue(error);
    else acknowledgeLogWitnessAlert.mockResolvedValue({ authority: AUTH, alerted: true });
    // ROUND 6's B1: the mode the write is issued in is an input the dialog
    // reads, and the harness pinned it to `true` in `afterEach` — so a gate on
    // `!demoMode` rendered only in real deployments and never here.
    usePreferencesStore.setState({ demoMode: i.demoMode });

    // …and whether this row has been acknowledged before, which decides the
    // control the operator clicks and was never once set in this file.
    const subject = subjectRow(i.reAcknowledge);
    const { rerender } = renderWith({ data: rows([subject]) });
    // The toggle starts at "Acknowledged shown" — the unfiltered worklist — so
    // reaching `leaves-view` means switching AWAY from the default.
    if (!i.showAcknowledged) fireEvent.click(ackToggle());
    openConfirm(AUTH, i.reAcknowledge);

    // ROUND 8's B5: the listing refetches while the dialog stands, and the row
    // comes back with a DIFFERENT acknowledgement state from the snapshot the
    // dialog captured. Both directions are reachable — someone else
    // acknowledged it, or the alert re-fired with a new reason and upstream
    // cleared the marker — and neither had ever been rendered, because one
    // fixture was handed over as both inputs.
    if (i.live === 'listed' && i.liveAcked !== i.reAcknowledge) {
      refetchTo([subjectRow(i.liveAcked)], rerender);
    }

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

  it('the dialog may read NOTHING this enumeration does not model', () => {
    // ROUND 6's B1, structurally. The product below renders every value of
    // every input it MODELS; this refuses an input it does not. The two are
    // different claims and round 6 measured the gap between them four times —
    // `demoMode`, `reason`, `acknowledgedAt` and the error's kind were each
    // read by a fabricated sentence with the whole suite green, because a
    // product can only be wrong about the axes it has.
    //
    // Read off the component's own AST, not a list somebody maintains: the
    // subject is `AcknowledgeDialog`'s RETURNED JSX, and every identifier
    // evaluated inside it must be licensed by `DIALOG_READS` or by
    // `DIALOG_CALLS`. An identifier nobody has classified is a failure naming
    // it, which is the loud version of the four silent reads.
    const src = readFileSync(
      join(process.cwd(), 'components/registries/log-witness-alerts.tsx'),
      'utf8',
    );
    const sf = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    let dialogFn: ts.FunctionDeclaration | undefined;
    const findFn = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'AcknowledgeDialog') dialogFn = node;
      ts.forEachChild(node, findFn);
    };
    findFn(sf);
    expect(dialogFn, 'AcknowledgeDialog is no longer a function declaration — this guard lost its subject').toBeTruthy();

    // The RETURN statement's expression is the rendered tree. Bounding the
    // whole function body would refuse the mutation wiring, which legitimately
    // reads `demoMode` — the defect is a read that reaches the SCREEN. The
    // LAST top-level return is the JSX one; earlier ones are guards.
    let returned: ts.Expression | undefined;
    for (const stmt of dialogFn!.body!.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) returned = stmt.expression;
    }
    expect(returned, 'AcknowledgeDialog has no top-level return').toBeTruthy();

    const licensed = new Set([...Object.keys(DIALOG_READS), ...DIALOG_CALLS, ...DIALOG_COPY]);
    const seen = new Set<string>();
    const unlicensed: string[] = [];
    const visit = (node: ts.Node): void => {
      // Only the ROOT of a property access: `mut.error` is a read of `mut`.
      // A property NAME is not an identifier read — `openedOn.acknowledgedAt`
      // must be caught, and it is, because `openedOn` is `modelled` and the
      // rule for a modelled name is checked below.
      if (ts.isPropertyAccessExpression(node)) {
        visit(node.expression);
        return;
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
        // An attribute NAME is markup, not a read; its initializer is a read.
        if (node.initializer) visit(node.initializer);
        return;
      }
      // ══════════════════════════════════════════════════════════════
      // ROUND 8's B4: "LOWER-CASE" WAS NOT "A TAG NAME"
      //
      // This used to read `if (/^[a-z]/.test(name) || licensed.has(name))
      // return;` ANYWHERE an identifier appeared, with the comment "lower-case
      // ones are intrinsic HTML tags and are not reads at all". Intrinsic-ness
      // is a property of the POSITION, not of the spelling: `<p>` is markup and
      // `{p}` is a read, and both are the identifier `p`. So every lower-case
      // name in the dialog's JSX was unlicensed and invisible — which is most
      // of the names a component has.
      //
      // The tag-name position is a node KIND, so it is decided that way. An
      // intrinsic tag (lower-case, in a tagName slot) is markup; a COMPONENT
      // tag in the same slot is a read of that component's binding and goes
      // through the licence like any other.
      // ══════════════════════════════════════════════════════════════
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const intrinsic = ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
        if (!intrinsic) visit(tag);
        visit(node.attributes);
        return;
      }
      // A closing tag names the same element the opening one did.
      if (ts.isJsxClosingElement(node)) return;
      // A property NAME in an object literal is a key, not a read — `{ display:
      // 'grid' }` depends on nothing. Its INITIALIZER is a read. Same rule as
      // the JSX attribute above, and both are positions rather than spellings.
      if (ts.isPropertyAssignment(node)) {
        if (ts.isComputedPropertyName(node.name)) visit(node.name.expression);
        visit(node.initializer);
        return;
      }
      // …but SHORTHAND is both at once (`{ stage }` is a read of `stage`), so
      // it goes through the licence.
      if (ts.isShorthandPropertyAssignment(node)) {
        visit(node.name);
        return;
      }
      if (ts.isIdentifier(node)) {
        const name = node.text;
        // `undefined` is a language value, not a name this component supplies.
        // Listed here rather than in a licence table because licensing it
        // would say the dialog's copy may DEPEND on it, which is not what it
        // means — it is the second argument of `mutate(undefined, …)`.
        if (name === 'undefined') return;
        if (licensed.has(name)) {
          seen.add(name);
          return;
        }
        unlicensed.push(name);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(returned!);

    expect(
      [...new Set(unlicensed)].sort(),
      'the dialog reads a name no licence in this file has classified',
    ).toEqual([]);

    // ANTI-VACUITY, and it is the half that matters: a walk that visited
    // nothing licenses everything. The dialog demonstrably reads its stage, its
    // consequence, its outcome and its mutation.
    for (const required of ['stage', 'consequence', 'outcome', 'mut']) {
      expect(seen, `the AST walk never reached \`${required}\``).toContain(required);
    }

    // Every copy constant the dialog renders must have a character-for-
    // character HAND COPY in the prose module. That is what makes the third
    // class closed rather than an allow-list: adding a name here licenses
    // nothing unless somebody has also written the string down under `test/`,
    // where it is reviewed as copy rather than as code.
    //
    // The two members are reached differently and both are checked the same
    // way. `ADMIN_ROUTE_FORBIDDEN` is imported from `api-error-messages` and is
    // shared with `/registries`; `ACK_ALREADY_RESOLVED` is declared locally in
    // the component. A local declaration is not a defect — it is where a
    // one-surface string belongs — but it IS the shape unreviewed copy takes,
    // so its value is lifted out of the AST and required to match a hand copy
    // exactly.
    const proseStrings = new Set(
      Object.values(PROSE as Record<string, unknown>).filter(
        (v): v is string => typeof v === 'string',
      ),
    );
    for (const record of Object.values(PROSE as Record<string, unknown>)) {
      if (record && typeof record === 'object') {
        for (const v of Object.values(record as Record<string, unknown>)) {
          if (typeof v === 'string') proseStrings.add(v);
        }
      }
    }
    const constantValue = (name: string): string | undefined => {
      if (name === 'ADMIN_ROUTE_FORBIDDEN') return ADMIN_ROUTE_FORBIDDEN;
      let found: string | undefined;
      const findConst = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === name &&
          node.initializer
        ) {
          // A concatenation of literals is how long copy is written here.
          const parts: string[] = [];
          const collect = (n: ts.Node): void => {
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
            else ts.forEachChild(n, collect);
          };
          collect(node.initializer);
          found = parts.join('');
        }
        ts.forEachChild(node, findConst);
      };
      findConst(sf);
      return found;
    };
    for (const name of DIALOG_COPY) {
      const value = constantValue(name);
      expect(value, `\`${name}\` is rendered by the dialog but its value could not be read`)
        .toEqual(expect.any(String));
      expect(
        proseStrings,
        `\`${name}\` is rendered by the dialog and no hand copy under test/ matches it`,
      ).toContain(value);
    }
    // Anti-vacuity: an empty hand-copy set would licence every constant.
    expect(proseStrings.size, 'the hand-copy set is empty').toBeGreaterThan(10);

    // …and the rule that separates "reads `reason`" from "branches on
    // `reason`". An interpolated value may only be an ARGUMENT — `reasonLabel(
    // live.reason)` is fine, `live.reason === 'log_id_changed'` is the escape
    // round 6 measured. Checked over the whole returned tree by looking at
    // every comparison, because a comparison is the only way a value chooses
    // copy without being a separate branch the product would model.
    const comparisons: string[] = [];
    const findComparisons = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        comparisons.push(node.left.getText(sf).replace(/\s+/g, ''));
      }
      ts.forEachChild(node, findComparisons);
    };
    findComparisons(returned!);
    const interpolatedOnly = Object.entries(DIALOG_READS)
      .filter(([, how]) => how === 'interpolated')
      .map(([name]) => name);
    for (const compared of comparisons) {
      for (const name of interpolatedOnly) {
        expect(
          compared.split(/[.?[]/),
          `the dialog BRANCHES on \`${name}\` (\`${compared}\`), which the product models as ` +
            'an interpolated value and therefore renders at exactly one value',
        ).not.toContain(name);
      }
    }
    // Anti-vacuity for that half too: the dialog demonstrably compares things.
    expect(comparisons.length, 'the comparison walk found no comparisons').toBeGreaterThan(5);
  });

  it('ackRecordEffect prefers the LIVE row, which is why it takes two arguments', () => {
    // ═════════════════════════════════════════════════════════════════
    // ROUND 8's B5. The function's whole contract is `(live ?? openedOn)`: the
    // listing as it is NOW decides, and the snapshot is the fall-back for when
    // the row has gone. Nothing asserted that. The product above derived its
    // expectation by calling this function, so deleting the live-row
    // preference moved both sides together and was 101/101 green.
    //
    // The table is written out by hand, against every combination of the two
    // arguments, because the point of a truth table is that it is not derived
    // from the thing it is about. Six cells, and the two that matter are the
    // DISAGREEMENTS — rows 3 and 4 — which are reachable in production two
    // ways: another operator acknowledging the row under an open dialog, and
    // the alert re-firing with a different reason, which is the one case
    // upstream clears the marker on.
    // ═════════════════════════════════════════════════════════════════
    const acked = subjectRow(true);
    const fresh = subjectRow(false);
    expect(acked.acknowledgedAt, 'the acknowledged fixture is not acknowledged').not.toBeNull();
    expect(fresh.acknowledgedAt, 'the fresh fixture is already acknowledged').toBeNull();
    const table: Array<[label: string, live: LogWitnessAlertRow | null, openedOn: LogWitnessAlertRow, want: AckRecordEffect]> = [
      ['live fresh, snapshot fresh', fresh, fresh, 'first'],
      ['live acked, snapshot acked', acked, acked, 'replaces'],
      ['live ACKED, snapshot fresh — someone else acknowledged it', acked, fresh, 'replaces'],
      ['live FRESH, snapshot acked — the alert re-fired on a new reason', fresh, acked, 'first'],
      ['row gone, snapshot fresh', null, fresh, 'first'],
      ['row gone, snapshot acked', null, acked, 'replaces'],
    ];
    for (const [label, live, openedOn, want] of table) {
      expect(ackRecordEffect(live, openedOn), label).toBe(want);
    }
    // Anti-vacuity: both values appear, and the two DISAGREEMENT rows disagree
    // with what the snapshot alone would have said — which is the property that
    // makes the second argument a fall-back rather than the answer.
    expect(new Set(table.map((t) => t[3])), 'the truth table lost a value').toEqual(
      new Set(ALL_RECORD_EFFECTS),
    );
    expect(table, 'the truth table is no longer complete over both arguments').toHaveLength(6);
    expect(
      table.filter(([, live, openedOn]) => live !== null && live.acknowledgedAt !== openedOn.acknowledgedAt),
      'no row of the table has the two arguments disagreeing',
    ).toHaveLength(2);
  });

  it('renders exactly the pinned copy, in every reachable arm', async () => {
    const inputs = reachableInputs();
    const armsWanted = new Set(inputs.map((i) => armKey(armOf(i))));

    // Anti-vacuity, asserted BEFORE the loop — and it is now about the PRODUCT,
    // not about four marginals. Twenty-two is not a number anyone chose: it is
    // what the FOUR exported functions produce over the input space, and it is
    // pinned so that a change to the state machine which silently collapses two
    // arms into one shows up here rather than as a quietly smaller matrix.
    //
    // It was 13 before round 7's N12 added `ackRecordEffect`. The jump is the
    // measurement that matters: 9 of the arms this file has rendered since
    // round 3 were two distinct arms wearing one key, and the first bullet of
    // the dialog said the same thing in both.
    //
    // ROUND 8's B5 took the input space from 72 to 96 without changing the arm
    // count, and that is the point rather than a disappointment: the new axis
    // does not add an arm, it makes `ackRecordEffect`'s two arguments actually
    // two. The 24 new tuples are the ones where the live row and the snapshot
    // DISAGREE about acknowledgement, and rewriting the function to read the
    // snapshot alone is red on them and was green on all 72 before.
    expect(inputs.length, 'the input enumeration collapsed').toBe(96);
    expect(armsWanted.size, 'the reachable arm space changed shape').toBe(22);
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
    expect(new Set(arms.map((a) => a.recordEffect))).toEqual(new Set(ALL_RECORD_EFFECTS));
    // …and the marginals are checked against the MEMBERS of `Arm`, not against
    // a list of four names somebody keeps. A new member with no marginal
    // assertion is a red test here rather than a coverage claim nobody re-read.
    expect(
      new Set(Object.keys(arms[0])),
      'a member of `Arm` has no marginal assertion above',
    ).toEqual(new Set(['stage', 'consequence', 'outcome', 'footer', 'recordEffect']));

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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
        recordEffect: 'first',
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
        recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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
      recordEffect: 'first',
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

describe('witness alert worklist — the CARD says exactly what it says', () => {
  /**
   * ROUND 8's B3. The four forbidden-phrase regexes elsewhere in this file stay
   * where they are as a fast lint that names the specific over-claims this
   * surface was built to avoid — but they are not the bound. This is.
   *
   * Six arms, because the card has six reachable copy states and the empty ones
   * are where an all-clear would be written. Each is pinned as a LIST: wording,
   * order and count together, so a sentence added anywhere in the card — an
   * `EmptyState` `action`, a caption, a footnote under the table, a word moved
   * across a boundary — is a diff a reviewer reads rather than a string four
   * regexes happen not to match.
   */
  const FIXTURE_ROW = row({ at: null });

  const ARMS: { label: string; enter: () => void; expected: string[] }[] = [
    {
      label: 'loading',
      enter: () => renderWith({ isLoading: true }),
      expected: [...cardChrome(true)],
    },
    {
      label: 'error (stamped 500)',
      enter: () =>
        renderWith({ error: new ApiError(500, 'boom', 'control-plane', '/x', true) }),
      expected: [
        ...cardChrome(true),
        'Could not load the witness alert worklist — the control plane did not answer successfully (500).',
        'Technical detail',
        '500 from control-plane /x — boom',
      ],
    },
    {
      label: 'forbidden (stamped 403)',
      enter: () =>
        renderWith({
          error: new ApiError(403, JSON.stringify({ message: 'nope' }), 'control-plane', '/x', true),
        }),
      expected: [
        ...cardChrome(true),
        'Could not load the witness alert worklist — not authorized by the control plane.',
        'Technical detail',
        '403 from control-plane /x — {"message":"nope"}',
      ],
    },
    {
      label: 'empty — all',
      enter: () => renderWith({ data: rows([]) }),
      expected: [
        ...cardChrome(true),
        EMPTY_TITLE_ALL,
        'The control plane is reporting no transparency-log detection, acknowledged or not. Authorities it has never witnessed produce no row here either way, so an empty worklist says nothing about them.',
      ],
    },
    {
      label: 'empty — filtered',
      enter: () => {
        renderWith({ data: rows([]) });
        fireEvent.click(ackToggle());
      },
      expected: [
        ...cardChrome(false),
        EMPTY_TITLE_FILTERED,
        'The control plane is reporting no UNACKNOWLEDGED transparency-log detection. Acknowledged alerts are still alerts and are hidden in this view — show them to check. Authorities it has never witnessed produce no row either way, so this says nothing about them.',
      ],
    },
    {
      label: 'populated — one row',
      enter: () => renderWith({ data: rows([FIXTURE_ROW]) }),
      expected: [
        ...cardChrome(true),
        // The header row, from the same list the header test asserts against.
        ...TABLE_COLUMNS,
        // The one fixture row. Data, but it arrives through the same leaves as
        // the copy does, and excluding `tbody` would leave the cell that says
        // "Detail not readable" — a sentence, not a datum — outside every bound
        // on this surface.
        'registry-c.playground.local',
        'Root mismatch (split view)',
        'two distinct roots witnessed at tree_size 100',
        '2',
        // `at: null` on the fixture, so this arm pins COPY and not a clock. The
        // discriminator below proves the masking is honest: with a real `at`,
        // this is the ONLY leaf that moves.
        'Time not recorded',
        'Open',
        'Acknowledge',
      ],
    },
  ];

  it.each(ARMS)('pins every word the card renders — $label', ({ enter, expected, label }) => {
    enter();
    expect(cardCopy(), label).toEqual(expected);
  });

  it('GUARDS THE GUARD: the leaf walk sees the two shapes a tag list misses', () => {
    // The reason this pin is a derived walk and not `BLOCK_SELECTOR`. Both
    // injections are copy an operator reads; neither is an `h2`, `p`, `li`,
    // `.card` or `.modal-footer button`.
    renderWith({ data: rows([]) });
    const clean = cardCopy();
    const body = section().querySelector('.card-body');
    expect(body, 'the card renders no .card-body').toBeTruthy();

    // (1) A bare text node, loose beside element children.
    const bare = document.createTextNode('Nothing to worry about here.');
    body!.appendChild(bare);
    // (2) A sentence in a `<div>` — the shape `EmptyState` itself uses, and the
    //     shape every future panel component will use.
    const wrapped = document.createElement('div');
    wrapped.textContent = 'Transparency looks good.';
    body!.appendChild(wrapped);

    const withBoth = cardCopy();
    expect(withBoth).toContain('Nothing to worry about here.');
    expect(withBoth).toContain('Transparency looks good.');
    expect(withBoth).not.toEqual(clean);

    // …and the tag list this file's dialog pin uses sees NEITHER, which is the
    // measurement that makes the previous three assertions worth having.
    const viaTagList = [...section().querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].map((n) =>
      normalize(n.textContent),
    );
    expect(viaTagList).not.toContain('Nothing to worry about here.');
    expect(viaTagList).not.toContain('Transparency looks good.');
  });

  it('GUARDS THE GUARD: the six arms are six different card states', () => {
    // A pin whose arms all render the same thing tests one arm six times. Each
    // list is compared against every other, so an arm that stops being
    // reachable — a toggle that no longer changes the copy, an error state that
    // falls through to the empty one — is red here rather than silently
    // collapsing the coverage this describe claims.
    const seen = new Map<string, string>();
    for (const arm of ARMS) {
      cleanup();
      arm.enter();
      const key = JSON.stringify(cardCopy());
      const clash = seen.get(key);
      expect(clash, `"${arm.label}" renders exactly what "${clash}" renders`).toBeUndefined();
      seen.set(key, arm.label);
      // …and each arm's measured copy really is the list the pin above holds,
      // so this guard and that pin cannot disagree about what was rendered.
      expect(JSON.parse(key), arm.label).toEqual(arm.expected);
    }
    expect(seen.size).toBe(ARMS.length);
  });

  it('GUARDS THE GUARD: nulling the fixture clock masks ONE leaf and no other', () => {
    // The populated arm pins `at: null` so the expectation is copy rather than
    // a wall-clock difference. That is only honest if the null changes exactly
    // the cell it is supposed to change — otherwise the arm is quietly pinning
    // a reduced surface and calling it the populated one.
    renderWith({ data: rows([FIXTURE_ROW]) });
    const nulled = cardCopy();
    cleanup();
    renderWith({ data: rows([row({ at: '2026-09-27T10:00:00.000Z' })]) });
    const dated = cardCopy();

    expect(dated).toHaveLength(nulled.length);
    const moved = dated.map((v, i) => (v === nulled[i] ? null : i)).filter((i) => i !== null);
    expect(moved, 'more than the Detected cell moves when the fixture clock is real').toHaveLength(
      1,
    );
    expect(nulled[moved[0]!]).toBe('Time not recorded');
    expect(dated[moved[0]!]).not.toBe('Time not recorded');
    // And it is the cell under the Detected header, not some other cell that
    // happens to differ.
    expect(
      nulled.indexOf('Time not recorded') - nulled.indexOf('Detected'),
      'the masked leaf is not the cell sitting under the Detected header',
    ).toBe(TABLE_COLUMNS.length);
  });

  it('SUBSUMES the four forbidden-phrase regexes kept elsewhere as a fast lint', () => {
    // ROUND 8's B3. The regexes stay — they name the specific over-claims this
    // surface exists to avoid, and a reader of those tests learns why the copy
    // is worded as it is. What they are NOT is the bound: this is.
    //
    // Asserted as a relationship rather than as four more `not.toMatch` calls,
    // so the two cannot drift into disagreeing about which strings ship.
    const LINT = [
      /healthy/i,
      /all (logs|registries) (are )?(ok|fine|verified)/i,
      /no (problems|issues)\b/i,
      /logs? (are|is) healthy|all clear|everything is fine/i,
    ];
    const everything = ARMS.flatMap((a) => a.expected).join(' ');
    for (const re of LINT) {
      expect(everything, `the pinned card copy contains ${re}`).not.toMatch(re);
    }
    // Anti-vacuity: the union is the real copy, not an empty string — and it is
    // big enough that a regex passing over it means something.
    expect(everything.length).toBeGreaterThan(1000);
    expect(everything).toContain('never witnessed');
  });
});
