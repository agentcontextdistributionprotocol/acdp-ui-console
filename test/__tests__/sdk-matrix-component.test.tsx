import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthResult } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// The SDK matrix's version column, as an operator actually sees it.
//
// Two defects from issue #69a live here, and neither is visible to
// `sdk-matrix-utils.test.ts` — that file tests the row DATA, and a row can
// carry a correct `versionIsLive` while the component renders it backwards or
// renders the explanation somewhere no one can reach.
//
//   1. Polarity. The marker used to sit on the REFERENCE version. After
//      Phase 8 most rows are reference in every mode, so the common case was
//      marked and the rare, notable one — a version actually read off a live
//      /healthz — was the plain default. The ink was on the wrong state.
//   2. Reachability. The explanation was a `title` attribute: invisible on
//      touch, invisible to keyboard focus, inconsistently announced. The
//      people most likely to need "is this number real?" were the least
//      likely to be able to get the answer.
//
// `components/**` is outside `vitest.config.mts`'s coverage `include`, so
// neither could ever show up as uncovered. Without this file, reverting the
// polarity or restoring the tooltip leaves the whole suite green.
// ══════════════════════════════════════════════════════════════════════

const pingHealth = vi.fn();
vi.mock('@/lib/api/client', () => ({ pingHealth: (...a: unknown[]) => pingHealth(...a) }));

let demoMode = false;
vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode }),
}));

const { SdkMatrix } = await import('@/components/config/sdk-matrix');
const { MOCK_SDK_MATRIX } = await import('@/lib/data/mock-data');
const { SDK_MATRIX_ROW_SERVICE } = await import('@/lib/utils/sdk-matrix');

const REGISTRY_ROW = Object.keys(SDK_MATRIX_ROW_SERVICE).find(
  (k) => SDK_MATRIX_ROW_SERVICE[k] === 'registry-a',
)!;

/** The accessible name the live marker must carry; asserted, not guessed. */
const LIVE_MARKER = /live: confirmed against the running service/i;

/**
 * Find the marker by ROLE plus accessible name, never by the raw `aria-label`
 * attribute.
 *
 * This distinction is the whole point. `getByLabelText` matches the attribute
 * as text, so it cannot tell a name the browser will honour from one it will
 * throw away — and the first version of this component put `aria-label` on a
 * bare `<span>`, whose implicit `generic` role is name-prohibited in ARIA 1.2.
 * Chromium drops the label there and axe flags `aria-prohibited-attr`, yet
 * every `getByLabelText` assertion passed.
 *
 * Querying by role pins the element to a role that CAN be named: the bare-span
 * form is `generic`, so it stops matching at all. Note the kill comes from the
 * ROLE filter, not from name computation — `dom-accessibility-api` implements
 * the prohibition for an explicit `role="paragraph"` but not for an implicit
 * `generic`, and will happily compute a name for the defective form. Matching
 * the role is what makes this query see what `getByLabelText` cannot.
 */
function markerIn(row: HTMLElement): HTMLElement | null {
  return within(row).queryByRole('img', { name: LIVE_MARKER });
}

function renderMatrix(health: Partial<Record<string, HealthResult>>) {
  pingHealth.mockImplementation(async (service: string) => health[service] ?? { ok: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SdkMatrix />
    </QueryClientProvider>,
  );
}

/** The <tr> whose first cell is this component name. */
function rowFor(component: string): HTMLElement {
  const cell = screen.getAllByRole('cell').find((c) => c.textContent === component);
  if (!cell) throw new Error(`No SDK matrix row for '${component}'`);
  return cell.closest('tr') as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
  demoMode = false;
});

describe('SdkMatrix version column', () => {
  it('marks the live-verified version and leaves reference versions plain', async () => {
    renderMatrix({ 'registry-a': { ok: true, version: '0.1.4+gdeadbee' } });

    // The marked row: a version read off this service's own /healthz.
    await waitFor(() => expect(markerIn(rowFor(REGISTRY_ROW))).not.toBeNull());
    expect(rowFor(REGISTRY_ROW).textContent).toContain('0.1.4+gdeadbee');

    // An unbacked row: reference data, no marker. This is the polarity check —
    // before this phase THIS is the row that carried the annotation.
    const specRow = rowFor('ACDP spec');
    expect(markerIn(specRow)).toBeNull();
    expect(specRow.textContent).toContain('0.4.0 Final');
  });

  it('gives the marker an accessible name a browser will actually honour', async () => {
    renderMatrix({ 'registry-a': { ok: true, version: '9.9.9' } });
    await waitFor(() => expect(markerIn(rowFor(REGISTRY_ROW))).not.toBeNull());
    const marker = markerIn(rowFor(REGISTRY_ROW))!;

    // `queryByRole(..., { name })` above already ran the accessible-name
    // computation against a nameable role — that is the assertion a raw
    // `getAttribute('aria-label')` check cannot make, since an element found
    // BY that attribute trivially has it.
    expect(marker.getAttribute('role')).toBe('img');

    // Not conveyed by colour alone, and not by a glyph alone either: the chip
    // carries a readable WORD, so it survives greyscale and survives a browser
    // discarding the label.
    expect(marker.textContent).toMatch(/[a-z]{2,}/i);
  });

  it('renders the legend exemplar and the row marker from the same source', async () => {
    // A legend whose exemplar has drifted from the marker it explains is worse
    // than no legend — it points at something not on screen. Nothing else in
    // this file would catch that: change the marker's text or class and leave
    // the legend alone, and every other assertion here still passes.
    renderMatrix({ 'registry-a': { ok: true, version: '9.9.9' } });
    await waitFor(() => expect(markerIn(rowFor(REGISTRY_ROW))).not.toBeNull());

    const all = screen.getAllByRole('img', { name: LIVE_MARKER });
    expect(all.length).toBeGreaterThanOrEqual(2); // at least one row + the legend
    const shapes = new Set(all.map((m) => `${m.className}|${m.textContent?.trim()}`));
    expect(shapes.size).toBe(1);
  });

  it('shows the legend with no hover or focus, and it reads correctly with zero marked rows', async () => {
    // Demo mode after Phase 8: nothing is live-verified, so every row is
    // unmarked. The legend must still explain what the marker means rather
    // than dangling as a reference to something not on screen.
    demoMode = true;
    renderMatrix({});

    const legend = await screen.findByText(/marks a version read from/i);
    expect(legend.textContent).toMatch(/Unmarked versions are reference data/i);
    // No interaction happened before this assertion — that is the point.
    // The legend's own exemplar is the only marker on screen; no ROW carries one.
    for (const row of MOCK_SDK_MATRIX) expect(markerIn(rowFor(row.component))).toBeNull();
    // And every row is still rendered, with its reference version visible.
    for (const row of MOCK_SDK_MATRIX) {
      expect(rowFor(row.component).textContent).toContain(row.version);
    }
  });

  it('never renders a title attribute — the explanation must not be a tooltip', async () => {
    const { container } = renderMatrix({ 'registry-a': { ok: true, version: '9.9.9' } });
    await waitFor(() => expect(markerIn(rowFor(REGISTRY_ROW))).not.toBeNull());
    // A `title` here would regress exactly what this phase fixed, and would do
    // it invisibly: the text still "exists" in the DOM, so a naive text
    // assertion would keep passing.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('does not mark a down service that reported no version', async () => {
    // `status` and `versionIsLive` answer different questions, and this is the
    // pair that proves the marker tracks the version rather than the service.
    renderMatrix({ 'registry-a': { ok: false } });
    const row = rowFor(REGISTRY_ROW);
    await waitFor(() => expect(within(row).getByText(/down/i)).toBeTruthy());
    expect(markerIn(row)).toBeNull();
    expect(row.textContent).toContain(
      MOCK_SDK_MATRIX.find((m) => m.component === REGISTRY_ROW)?.version,
    );
  });

  it('DOES mark a down service that reported its own version on the failure body', async () => {
    // Phase 7's behaviour reaching the screen: the version was observed live,
    // on that very failure response, so it is marked even though the row is
    // `✗ down`. A row naming WHICH build is down is the useful failure display.
    renderMatrix({ 'registry-a': { ok: false, version: '0.1.4+gdeadbee' } });
    const row = rowFor(REGISTRY_ROW);
    await waitFor(() => expect(markerIn(row)).not.toBeNull());
    expect(within(row).getByText(/down/i)).toBeTruthy();
    expect(row.textContent).toContain('0.1.4+gdeadbee');
  });
});

// ══════════════════════════════════════════════════════════════════════
// The failure WORD in the badge, and the legend that defines it (#100).
//
// `buildSdkMatrixRows` carrying `detail` is tested next door; what cannot be
// seen from there is whether the word reaches the cell, and whether an operator
// who reads it can find out what it means. The legend is the disclosure
// mechanism this component already settled on for `✓ live` — #100 names that as
// the worked example to copy — so the same test shape applies: the word in the
// cell, the definition in the legend, and no tooltip anywhere.
// ══════════════════════════════════════════════════════════════════════
describe('a down row says WHICH kind of down', () => {
  it('renders ✗ degraded for a service that answered badly', async () => {
    renderMatrix({ 'registry-a': { ok: false, detail: 'degraded', latencyMs: 8 } });
    const row = rowFor(REGISTRY_ROW);
    await waitFor(() => expect(within(row).getByText(/degraded/i)).toBeTruthy());
    // The collapsed word is gone from this row, which is the half that would
    // still pass if `detail` were merely appended rather than substituted.
    expect(within(row).queryByText(/✗ down/)).toBeNull();
  });

  it('renders ✗ unreachable for a service that never answered', async () => {
    renderMatrix({ 'registry-a': { ok: false, detail: 'unreachable', latencyMs: 30 } });
    const row = rowFor(REGISTRY_ROW);
    await waitFor(() => expect(within(row).getByText(/unreachable/i)).toBeTruthy());
    expect(within(row).queryByText(/degraded/i)).toBeNull();
  });

  it('distinguishes two simultaneously-failing services from each other', async () => {
    // The assertion that makes the pair load-bearing rather than decorative: if
    // the badge ignored `detail`, these two rows would read identically.
    renderMatrix({
      'registry-a': { ok: false, detail: 'degraded', latencyMs: 8 },
      'control-plane': { ok: false, detail: 'unreachable', latencyMs: 30 },
    });
    const reg = rowFor(REGISTRY_ROW);
    const cp = rowFor('Control Plane (NestJS)');
    await waitFor(() => expect(within(reg).getByText(/degraded/i)).toBeTruthy());
    expect(within(cp).getByText(/unreachable/i)).toBeTruthy();
    expect(within(reg).queryByText(/unreachable/i)).toBeNull();
    expect(within(cp).queryByText(/degraded/i)).toBeNull();
  });

  it('falls back to the old word when the probe reported no detail', async () => {
    // `pingHealth` always sets `detail`, so this is the fixture-shaped input
    // only — but `✗ down` is what the badge said for every failure before this
    // phase, and it is still the right thing to say when there is no word to
    // substitute.
    renderMatrix({ 'registry-a': { ok: false } });
    const row = rowFor(REGISTRY_ROW);
    await waitFor(() => expect(within(row).getByText(/down/i)).toBeTruthy());
  });

  it('defines both words in the legend, not in a tooltip', async () => {
    const { container } = renderMatrix({ 'registry-a': { ok: false, detail: 'degraded' } });
    await waitFor(() => expect(within(rowFor(REGISTRY_ROW)).getByText(/degraded/i)).toBeTruthy());

    // The legend is the last <p> in the card and carries both definitions. A
    // word rendered in a cell with no definition anywhere is a new piece of
    // jargon, which is what the `✓ live` legend exists to avoid.
    const legend = container.querySelector('p')!.textContent ?? '';
    expect(legend).toMatch(/degraded/);
    expect(legend).toMatch(/unreachable/);

    // ANCHORED PER CLAUSE, not with a floating `.*` across the whole paragraph.
    // The first version of this test matched `/degraded.*answered/s` and
    // `/unreachable.*nothing beyond this console answered/s` over one paragraph
    // containing both words — which is satisfied by almost any arrangement of
    // them. Verified by mutation: SWAPPING the two definitions passed, and so
    // did replacing the pair with "both mean the console could not get a
    // healthy answer; treat them as the same thing". The one sentence whose
    // entire job is to separate the two words could be replaced by one that
    // collapses them, on a green suite.
    //
    // So each clause is isolated first and asserted on its own. A sentence is
    // the clause from its `<code>` word up to the next full stop.
    const clause = (word: string) => {
      const from = legend.indexOf(word);
      expect(from, `the legend never mentions ${word}`).toBeGreaterThan(-1);
      const end = legend.indexOf('.', from);
      return legend.slice(from, end === -1 ? undefined : end);
    };

    // `degraded` is the arm where something DID answer...
    expect(clause('degraded')).toMatch(/answered/);
    expect(clause('degraded')).not.toMatch(/nothing/);
    // ...and `unreachable` is the arm where nothing did.
    expect(clause('unreachable')).toMatch(/nothing/);

    // The over-claim guard. `failureKind`'s own docblock
    // (`lib/api/client.ts`) states that `degraded` "does NOT claim the service
    // diagnosed itself; only that the bytes came from out there" — an upstream
    // 404 from a build with no `/healthz`, or an edge proxy's 502 for a dead
    // app, both land here. A legend saying the SERVICE answered, or that it is
    // therefore running, asserts more than the field can support, which is the
    // exact defect #100 exists to remove.
    expect(clause('degraded')).not.toMatch(/the service answered/);
    expect(clause('degraded')).not.toMatch(/it is running/);

    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });
});
