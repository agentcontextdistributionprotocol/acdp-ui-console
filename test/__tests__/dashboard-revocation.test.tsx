// ══════════════════════════════════════════════════════════════════════
// The dashboard's Key Revocation card.
//
// UI-2 gated the card on `{d.keyRevocation && …}`, on the premise that the
// control plane omits the field when `KEY_REVOCATION_CHECK_ENABLED=false`. It
// does not: `dashboard.service.ts` builds the object unconditionally with
// `?? 0` on every member and no reference to the flag — which defaults to
// false. So the shipped render was a green "Pre-compromise (authorized) 0", a
// red "Revoked at/after boundary 0" and an amber "Revoked time unverifiable 0"
// from a deployment that never checked anything.
//
// These tests come in discriminating pairs: for each "renders absent" case
// there is a sibling that differs only in the payload and demands the numbers
// back. Inverting the render condition, or deleting it, fails one of each pair
// — neither can pass on an empty render.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpDashboardOverview } from '@/lib/types';

const useDashboard = vi.fn();
vi.mock('@/lib/hooks/use-dashboard', () => ({ useDashboard: () => useDashboard() }));
vi.mock('@/lib/hooks/use-scenarios', () => ({ useScenarios: () => ({ data: [] }) }));
vi.mock('@/lib/hooks/use-global-events', () => ({ useGlobalEvents: () => ({ events: [], live: false }) }));
// recharts needs a measured container it never gets in jsdom, and this page
// loads it through `next/dynamic`. The chart is not what is under test.
vi.mock('@/components/charts/bar-chart-card', () => ({ BarChartCard: () => <div data-testid="chart" /> }));
// `RecentRunsTable` calls `useRouter`, which throws outside an App Router tree.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DashboardPage from '@/app/dashboard/page';

function overview(over: Partial<CpDashboardOverview> = {}): CpDashboardOverview {
  return {
    window: '24h',
    totalRuns: 4,
    totalContexts: 9,
    totalAgents: 2,
    recentRuns: [],
    byScenario: [],
    byRegistry: [{ registry_authority: 'registry-a.playground.local', event_count: 9 }],
    ...over,
  };
}

function renderWith(data: CpDashboardOverview) {
  useDashboard.mockReturnValue({ isLoading: false, error: null, data });
  return render(<DashboardPage />);
}

/** The Key Revocation card, located by its heading rather than by position. */
function revocationCard(): HTMLElement {
  const el = screen.getByText('Key Revocation').closest('.card');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

afterEach(() => {
  cleanup();
  useDashboard.mockReset();
});

// ══════════════════════════════════════════════════════════════════════
// MIGRATED, not deleted (#97). Every test in the block below predates
// `features` and passes NO flags, so each one now exercises the `unknown` arm
// — a control plane predating acdp-control-plane#178, where the old prose
// (hedge included) is still exactly the honest thing to say. That is the
// mapping criterion 8 asks for, and it is why these read unchanged:
//
//   "all-zero payload renders no figure"      -> kind `unknown`
//   "one non-zero renders all three figures"  -> kind `reported`
//   "omitted field lands in the same state"   -> kind `unknown`
//   "scopes the absence to the WINDOW"        -> kind `unknown`
//   "counters are window-scoped"              -> kind `reported`
//
// The four-arm coverage the flags make possible is the describe that follows.
// ══════════════════════════════════════════════════════════════════════
describe('dashboard — Key Revocation with no feature flags (the pre-#178 backend)', () => {
  it('keeps the card but renders NO figure — not even a 0', () => {
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    // Half one: the card is still there. A card that vanishes is
    // indistinguishable from a control plane that predates the feature.
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('Nothing in this window carried a revocation classification');
    // Half two: no numeric KPI inside it. Asserted structurally rather than by
    // searching for the string "0" — the surrounding prose has carried digits
    // before (it used to cite an upstream issue number), and a substring check
    // would have been satisfied by those.
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(card.textContent).not.toContain('Pre-compromise (authorized)');
    expect(card.textContent).not.toContain('Revoked at/after boundary');
    expect(card.textContent).not.toContain('Revoked time unverifiable');
  });

  it('DISCRIMINATES: one non-zero count renders all three figures, zeros included', () => {
    // The 9 proves the check ran, which makes the two zeros beside it real
    // information rather than an unexamined default.
    renderWith(
      overview({ keyRevocation: { preCompromise: 9, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const card = revocationCard();
    const values = [...card.querySelectorAll('.kpi-value')].map((v) => v.textContent);
    expect(values).toEqual(['9', '0', '0']);
    expect(card.textContent).not.toContain('Nothing in this window carried');
  });

  it('a pre-Phase-14 backend that omits the field lands in the same absent state', () => {
    renderWith(overview({ keyRevocation: undefined }));
    const card = revocationCard();
    expect(card.textContent).toContain('Nothing in this window carried a revocation classification');
    expect(card.querySelectorAll('.kpi-value')).toHaveLength(0);
  });

  it('scopes the absence claim to the WINDOW, never to the deployment', () => {
    // The copy used to read "Revocation checking is not reported by this
    // deployment" — a claim this card cannot support and that the demo dataset
    // refutes one click away: `DEMO_WINDOW_REVOCATION` is all-zero at 1h and
    // non-zero at 6h, so the same deployment produced both verdicts. Evidence
    // gathered over a window can only ever license a statement about that
    // window; /trust's equivalent copy already got this right.
    renderWith(
      overview({ keyRevocation: { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }),
    );
    const text = revocationCard().textContent ?? '';
    expect(text).toContain('window');
    expect(text).not.toMatch(/not reported by this deployment/);
    expect(text).not.toMatch(/this deployment (does not|never)/);
  });

  it('records that the counters are window-scoped and counted at audit time', () => {
    // A retroactive re-audit deliberately never touches `checked_at` upstream,
    // so an amendment marking hundreds of older events fail-closed leaves this
    // card at its old figures while the per-run panel is current. An operator
    // reading the card cannot infer that; it has to be written down.
    renderWith(overview({ keyRevocation: { preCompromise: 1, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 } }));
    expect(revocationCard().textContent).toContain('a re-audit amending an event older than this window is not reflected here');
  });
});

// ══════════════════════════════════════════════════════════════════════
// The four arms (#97).
//
// The card used to have two: figures, or one paragraph of prose. That prose
// asserted "the check is disabled by default" in EVERY not-reported case, which
// is simply false whenever the deployment says the check is on — the last
// surviving could-not-establish claim on this page.
//
// The arms must be distinguishable from each other, not merely present, or an
// operator gains nothing: the whole point is that a clean estate and an
// unmonitored one stop looking alike.
// ══════════════════════════════════════════════════════════════════════
const FEATURES: NonNullable<CpDashboardOverview['features']> = {
  receiptAudit: true,
  keyRevocationCheck: true,
  logWitness: true,
  logInclusionAudit: true,
  witnessCosigning: true,
  witnessQuorum: true,
};
const CLEAN = { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 };
const SOME = { preCompromise: 9, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 };

/** The one phrase that may appear in exactly one arm. */
const HEDGE = 'the check is disabled by default';

describe('dashboard — Key Revocation says which of four states it is', () => {
  it('reported: figures, no prose', () => {
    renderWith(overview({ keyRevocation: SOME, features: FEATURES }));
    const card = revocationCard();
    expect([...card.querySelectorAll('.kpi-value')].map((v) => v.textContent)).toEqual(['9', '0', '0']);
    expect(card.textContent).not.toContain(HEDGE);
  });

  it('checked-clean: the flag is on and this window is empty — stated as two facts, not one inference', () => {
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).toContain('Revocation checking is enabled');
    expect(text).toContain('nothing in this window is classified against a revoked key');
    expect(revocationCard().querySelectorAll('.kpi-value')).toHaveLength(0);
    expect(text).not.toContain(HEDGE);
  });

  it('checked-clean does NOT claim the check ran over this window\u2019s events', () => {
    // The gate's finding. The console holds two facts: a flag describing the
    // deployment NOW, and counters persisted AT AUDIT TIME. Enabling the check
    // does not re-classify rows already audited (`lib/types.ts` records that
    // `key_revocation_status` is NOT NULL DEFAULT 'none'), and the console
    // cannot know when the flag was flipped — so "the check ran over this
    // window" is exactly the inference that does not follow. It is the same
    // argument this change uses to deny /trust a clean arm; it transfers here
    // unchanged.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).not.toMatch(/checking ran over this window/i);
    expect(text).not.toMatch(/(ran|checked) (over|across) (this|the selected) window/i);
    expect(text).not.toMatch(/every event .{0,30}(was|were) checked(?! )/i);
    // And it says so positively, rather than merely omitting the claim.
    expect(text).toMatch(/does not follow that every event in the window was checked/i);
    expect(text).toMatch(/audit time/i);
  });

  it('every clean claim in the checked-clean arm is scoped to the window, sentence by sentence', () => {
    // `toContain('this window')` over the whole card is not the assertion the
    // docblock claims. The arm makes the clean statement more than once, so one
    // sentence can lose its scope while another keeps the substring green — a
    // mutation dropping "in this window" from the result sentence passed. The
    // scope has to hold per sentence, because a sentence is what a reader takes
    // as a unit: "nothing was classified against a revoked key" reads as a
    // deployment-level all-clear regardless of what preceded it.
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    // `<br />` contributes no whitespace to textContent, so split on the period
    // itself rather than on a space after it.
    const sentences = text.split(/(?<=\.)\s*/).filter((s) => s.trim().length > 0);
    const claims = sentences.filter((s) =>
      /classified against a revoked key|counters are zero/.test(s),
    );
    // Without this the loop below goes vacuous the moment the copy is reworded.
    expect(claims.length).toBeGreaterThanOrEqual(2);
    for (const s of claims) expect(s).toMatch(/this window|selected window/);
  });

  it('checked-clean never states a DEPLOYMENT-level clean', () => {
    renderWith(overview({ keyRevocation: CLEAN, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    // "this deployment reports the check as enabled" is fine — that IS about
    // the deployment. What must not appear is a claim that the deployment is
    // clean, which no window-scoped counter can support.
    expect(text).not.toMatch(/nothing is revoked/i);
    expect(text).not.toMatch(/no(thing)? .{0,30}revoked .{0,20}deployment/i);
  });

  it('disabled: states the fact, without the hedge that made it false', () => {
    renderWith(
      overview({ keyRevocation: CLEAN, features: { ...FEATURES, keyRevocationCheck: false } }),
    );
    const text = revocationCard().textContent ?? '';
    expect(text).toContain('Revocation checking is switched off on this deployment');
    // The distinction the whole issue turns on: nothing MEASURED is not the
    // same as nothing FOUND.
    expect(text).toMatch(/nothing was measured/i);
    expect(text).not.toContain(HEDGE);
  });

  it('disabled: reached by a null payload too, which is what upstream actually sends', () => {
    // `dashboard.service.ts:240` emits literal `null` when the check is off.
    renderWith(overview({ keyRevocation: null, features: { ...FEATURES, keyRevocationCheck: false } }));
    expect(revocationCard().textContent).toContain('Revocation checking is switched off');
  });

  it('unknown: and ONLY unknown keeps the hedge', () => {
    // The pre-#178 backend. Here "the check is disabled by default" is still
    // true and still load-bearing, because we genuinely cannot tell whether it
    // ran. The three tests above assert the phrase absent; this one asserts it
    // present, so the pair cannot both be satisfied by deleting the phrase.
    renderWith(overview({ keyRevocation: CLEAN, features: undefined }));
    expect(revocationCard().textContent).toContain(HEDGE);
  });

  it('all FIVE renderings are DISTINGUISHABLE text', () => {
    // Four kinds, but five renderings: `unknown` splits on `because`, and the
    // whole point of that split is that the two read differently. Without this,
    // arms could collapse onto one paragraph and every test above would still
    // pass in isolation.
    const texts: string[] = [];
    for (const [k, f] of [
      [SOME, FEATURES],                                        // reported
      [CLEAN, FEATURES],                                       // checked-clean
      [CLEAN, { ...FEATURES, keyRevocationCheck: false }],     // disabled
      [CLEAN, undefined],                                      // unknown/no-flags
      [null, FEATURES],                                        // unknown/flags-disagree
    ] as const) {
      renderWith(overview({ keyRevocation: k, features: f }));
      texts.push(revocationCard().textContent ?? '');
      cleanup();
    }
    expect(new Set(texts).size).toBe(5);
  });

  it('a non-zero count is REPORTED even when the flag says the check is off', () => {
    // Self-evidencing. A count means the check ran and found that, whatever the
    // deployment claims about itself — and rendering "switched off" over live
    // figures would be the worse error of the two.
    renderWith(overview({ keyRevocation: SOME, features: { ...FEATURES, keyRevocationCheck: false } }));
    expect([...revocationCard().querySelectorAll('.kpi-value')].map((v) => v.textContent)).toEqual(['9', '0', '0']);
  });

  it('a null payload with the check ENABLED is unknown, not clean — and is NOT explained as disabled', () => {
    // Upstream cannot produce this — both derive from one config value — so it
    // means something is wrong, and a clean estate must not be asserted from a
    // contradiction.
    //
    // The hedge assertion here used to be `toContain(HEDGE)`, which PINNED the
    // defect the gate found: the console holds `keyRevocationCheck === true`
    // and rendered "the check is disabled by default" over it — stating a
    // cause it has direct evidence against, which is the exact sentence #97
    // exists to delete. The `because` discriminator is what lets this arm
    // decline to explain itself.
    renderWith(overview({ keyRevocation: null, features: FEATURES }));
    const text = revocationCard().textContent ?? '';
    expect(text).not.toContain(HEDGE);
    expect(text).not.toMatch(/disabled|switched off/i);
    expect(text).not.toContain('classified against a revoked key');
    expect(text).toMatch(/does not add up/i);
  });

  it('a non-boolean flag lands in the same no-explanation arm, not on the pre-#178 hedge', () => {
    // A `features` object DID arrive, so this is not a pre-#178 backend and the
    // "disabled by default" explanation is not ours to reach for.
    const stringy = { ...FEATURES, keyRevocationCheck: 'true' } as unknown as typeof FEATURES;
    renderWith(overview({ keyRevocation: CLEAN, features: stringy }));
    const text = revocationCard().textContent ?? '';
    expect(text).not.toContain(HEDGE);
    expect(text).toMatch(/does not add up/i);
  });
});

describe('dashboard — Recent Runs', () => {
  it('shows no count when the window has no runs, rather than "Most recent 0"', () => {
    // The table already has its own "No runs yet" empty state; a count beside
    // it would be a header contradicting the body.
    renderWith(overview({ recentRuns: [] }));
    expect(screen.queryByText(/Most recent/)).toBeNull();
  });

  it('DISCRIMINATES: it does show the count when there are runs', () => {
    renderWith(overview({ recentRuns: [{ runId: 'r1' }] as unknown as CpDashboardOverview['recentRuns'] }));
    expect(screen.getByText('Most recent 1')).toBeInTheDocument();
  });
});

describe('dashboard — the window is selectable', () => {
  it('offers exactly the windows the control plane accepts', () => {
    renderWith(overview());
    const picker = screen.getByLabelText('Dashboard time window') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['1h', '6h', '24h', '7d', '30d']);
  });

  it('is reachable on the error path too, so a failed window is recoverable', () => {
    useDashboard.mockReturnValue({ isLoading: false, error: new Error('boom'), data: undefined });
    render(<DashboardPage />);
    expect(screen.getByLabelText('Dashboard time window')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The KPI row, and the health claim that used to sit under it (#100).
//
// `<KpiCard label="Registries" … delta="● all healthy" />` was a LITERAL. It had
// no input, so it was true of every dataset, every deployment and every outage —
// including the one #100 describes, a control plane whose database is gone,
// where this page's own data comes from the service that is down.
//
// Wiring it to a probe was rejected rather than deferred. The figure above the
// caption is `byRegistry.length`, an event count, so health is not what the tile
// is about; and demo mode — the default — returns `{ ok: true }` from
// `pingHealth` unconditionally, so a wired delta would render the identical
// sentence forever with a probe's authority behind it.
//
// Paired assertions, per this file's convention: the absence test cannot pass by
// the page failing to render, because its sibling demands the surviving delta
// and the tile's own figure.
// ══════════════════════════════════════════════════════════════════════
describe('the KPI row makes no health claim', () => {
  it('renders no "all healthy" caption anywhere on the page', () => {
    renderWith(overview());
    expect(screen.queryByText(/all healthy/i)).toBeNull();
    // Not just the exact literal — any restored variant of the claim, but
    // scoped to the KPI ROW rather than the page. A page-wide `/healthy/i`
    // would trip on any future legitimate use of the word anywhere on
    // `/dashboard`, which is a guard that eventually gets deleted rather than
    // understood.
    const row = screen.getByText('Registries').closest('.kpi-grid') as HTMLElement;
    expect(row.textContent).not.toMatch(/healthy/i);
  });

  it('still renders the Registries tile and its count', () => {
    // The sibling. Deleting the tile, or the page throwing, would satisfy the
    // assertion above; this is what makes it mean something.
    renderWith(overview({ byRegistry: [
      { registry_authority: 'registry-a.playground.local', event_count: 9 },
      { registry_authority: 'registry-b.playground.local', event_count: 4 },
    ] }));
    const tile = screen.getByText('Registries').closest('.kpi-card') as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.textContent).toContain('2');
    expect(tile.querySelector('.kpi-delta')).toBeNull();
  });

  it('leaves the one other delta on that row intact', () => {
    // Only `Total Runs` has a delta — `window 24h`, `deltaTone="muted"`.
    // `Contexts Published` and `Active Agents` never had one, so "the other
    // three still render theirs" would have been an assertion about two cards
    // that have nothing to render.
    renderWith(overview({ window: '24h' }));
    const runs = screen.getByText('Total Runs').closest('.kpi-card') as HTMLElement;
    expect(runs.querySelector('.kpi-delta')?.textContent).toBe('window 24h');
    for (const label of ['Contexts Published', 'Active Agents']) {
      const tile = screen.getByText(label).closest('.kpi-card') as HTMLElement;
      expect(tile.querySelector('.kpi-delta')).toBeNull();
    }
  });

  // REMOVED: a `expect(src).toContain('{delta && (')` assertion on
  // `kpi-card.tsx`'s source text. It broke on a harmless reformat while adding
  // nothing — "the fix is the removal of one prop at one call site" is already
  // established by the two tests above, which show `Total Runs` still rendering
  // its delta (so the component was not broken) and the other tiles rendering
  // none (so the prop really is gone). Asserting on a component's source
  // spelling to prove a caller changed is the wrong instrument.
});
