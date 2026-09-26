import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import type { LogWitnessCheckpoint, LogWitnessState } from '@/lib/types';

// ══════════════════════════════════════════════════════════════════════
// The witness card's null-vs-zero rule, as an operator actually sees it.
//
// `freshWitnessedCount: null` means quorum consumption is switched off — we
// never counted. `freshWitnessedCount: 0` means we counted and not one trusted
// witness attested this head. Those are opposite facts and the second is the
// one worth waking someone for, yet `x ?? 0` and `if (x)` render them
// identically. A single careless guard anywhere in this component silently
// converts an alarm into a blank.
//
// `components/**` is outside `vitest.config.mts`'s coverage `include`, so that
// substitution could never show up as uncovered. This file is the only thing
// standing between it and a green suite.
//
// The two "no such character anywhere in the card" assertions below are
// deliberate: asserting `not.toContain('0')` only proves something if every
// OTHER rendered field is free of that digit. That makes the claim "this number
// is nowhere on screen" literally checkable, instead of the weaker "the label I
// happened to think of is absent". Keeping it true takes care on two fronts,
// both of which caught this file out once already:
//
//   - The root hash must contain neither digit IN FULL, not merely after
//     `shortId` truncates it. An earlier fixture held a `7` in its middle and
//     passed only because the card happens to render 14 characters and a tail
//     of 6 — so widening that window would have turned the test red for a
//     reason having nothing to do with the behaviour under test.
//   - `timeAgo` must not put digits on screen. Two of them render per card, and
//     a timestamp of "now" formats as the digit-free "just now" for only five
//     seconds before becoming "7s ago" / "10s ago" — long enough to pass
//     locally and fail in CI. Hence a deliberately FUTURE timestamp: `timeAgo`
//     returns "just now" for any negative difference, so it stays digit-free
//     however long the suite takes.
// ══════════════════════════════════════════════════════════════════════

const getLogWitness = vi.fn();
vi.mock('@/lib/api/client', () => ({
  getLogWitness: (...a: unknown[]) => getLogWitness(...a),
  listRevocations: vi.fn(),
  getRegistryJwks: vi.fn(),
}));

vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const { LogWitnessCard } = await import('@/components/registries/log-witness-card');

/** All free of `0` and `7` in full, so the absence assertions mean what they say. */
const AUTHORITY = 'registry-x.test';
const LOG_ID = 'registry-x.test/log/v1';
const ROOT = `sha256:${'abcdef123456'.repeat(5)}abcd`;
/** Five minutes ahead, so `timeAgo` renders the digit-free "just now" forever. */
const NOW = new Date(Date.now() + 5 * 60_000).toISOString();

function checkpoint(over: Partial<LogWitnessCheckpoint> = {}): LogWitnessCheckpoint {
  return {
    logId: LOG_ID,
    treeSize: 1234,
    rootHash: ROOT,
    timestamp: NOW,
    witnessedAt: NOW,
    signatureValid: true,
    consistencyOk: true,
    witnessedCount: null,
    meetsQuorum: null,
    freshWitnessedCount: null,
    meetsFreshQuorum: null,
    historicalWitnessedCount: null,
    ...over,
  };
}

function state(cp: LogWitnessCheckpoint | null, over: Partial<LogWitnessState> = {}): LogWitnessState {
  return {
    authority: AUTHORITY,
    logId: LOG_ID,
    lastWitnessedSize: 1234,
    lastRootHash: ROOT,
    lastSuccessAt: NOW,
    consecutiveFailures: 0,
    alert: { alerted: false, reason: null, detail: null, at: null },
    checkpoints: cp ? [cp] : [],
    total: cp ? 1 : 0,
    ...over,
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LogWitnessCard authority={AUTHORITY} />
    </QueryClientProvider>,
  );
}

/**
 * The card element, once its query has settled.
 *
 * The shell — header and authority heading — renders immediately, before the
 * query resolves, so waiting on the heading alone hands back an empty card and
 * every `not.toContain` below would pass vacuously. Waiting the skeleton out is
 * what makes the absence assertions mean anything.
 */
async function card(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: AUTHORITY });
  const el = heading.closest('.card') as HTMLElement;
  await waitFor(() => expect(el.querySelector('.skeleton')).toBeNull());
  return el;
}

/** Row values keyed by their label, as the DOM presents them. */
function rowValue(el: HTMLElement, name: string): string | undefined {
  const label = Array.from(el.querySelectorAll('.metric-name')).find((n) => n.textContent === name);
  return label?.parentElement?.lastElementChild?.textContent ?? undefined;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('LogWitnessCard — quorum disabled vs quorum failed', () => {
  it('omits every quorum figure when the columns are NULL, and prints no zero anywhere', async () => {
    getLogWitness.mockResolvedValue(state(checkpoint()));
    renderCard();
    const el = await card();

    // No quorum row exists at all…
    for (const label of [
      'Fresh quorum',
      'Standing quorum',
      'Fresh witnesses',
      'Witnesses (incl. stale)',
      'Under retired keys',
    ]) {
      expect(rowValue(el, label), label).toBeUndefined();
    }
    // …and the omission is stated rather than silent, so an operator is not
    // left wondering whether the numbers failed to render.
    expect(el.textContent).toContain('Cosignature quorum not reported for this head.');
    // …and, because every other field here is free of the digit, the stronger
    // claim holds too: the card never invents a count of zero.
    expect(el.textContent).not.toContain('0');
    // Sanity that the card rendered at all — otherwise the two assertions
    // above would pass on an empty <div>.
    expect(rowValue(el, 'Checkpoint tree size')).toBe('1,234');
  });

  it('renders a counted zero as a FAILING quorum — the case a `?? 0` guard erases', async () => {
    // The three counts are deliberately DISTINCT. With them all equal, the
    // fresh and total rows could be swapped in the component and every
    // assertion here would still pass — and `freshWitnessedCount` is the
    // headline verdict's supporting number, so which row it lands in matters.
    getLogWitness.mockResolvedValue(
      state(
        checkpoint({
          witnessedCount: 1,
          meetsQuorum: false,
          freshWitnessedCount: 0,
          meetsFreshQuorum: false,
          historicalWitnessedCount: 4,
        }),
      ),
    );
    renderCard();
    const el = await card();

    expect(rowValue(el, 'Fresh witnesses')).toBe('0');
    expect(rowValue(el, 'Witnesses (incl. stale)')).toBe('1');
    expect(rowValue(el, 'Under retired keys')).toBe('4');
    expect(rowValue(el, 'Fresh quorum')).toBe('not met');
    expect(el.querySelector('.chip.bad')?.textContent).toBe('not met');
  });

  it('reads the NEWEST checkpoint, not the oldest retained one', async () => {
    // `latestForAuthority` orders newest-first and the card takes
    // `checkpoints[0]`. Nothing asserted that until now, so
    // `checkpoints[checkpoints.length - 1]` passed the whole suite — and the
    // retention window holds up to 20 heads, so the card would have shown a
    // quorum verdict up to 20 checkpoints stale while looking perfectly live.
    const newest = checkpoint({ treeSize: 4321, witnessedCount: 3, meetsQuorum: true });
    const oldest = checkpoint({ treeSize: 1234, witnessedCount: 1, meetsQuorum: false });
    getLogWitness.mockResolvedValue({ ...state(newest), checkpoints: [newest, oldest], total: 2 });
    renderCard();
    const el = await card();

    expect(rowValue(el, 'Checkpoint tree size')).toBe('4,321');
    expect(rowValue(el, 'Witnesses (incl. stale)')).toBe('3');
    expect(rowValue(el, 'Standing quorum')).toBe('met');
  });

  it('renders a cursor size of zero, and an absent one as a dash', async () => {
    // `lastWitnessedSize` runs through the same `counted()` guard, and
    // `formatNumber(null)` returns the string '0' — so dropping that guard
    // would invent a witnessed head of size zero for a log that has none. The
    // docblock claims this field gets the same treatment; this is what makes
    // the claim checkable.
    getLogWitness.mockResolvedValue(state(checkpoint(), { lastWitnessedSize: 0 }));
    const first = renderCard();
    expect(rowValue(await card(), 'Last witnessed head')).toBe('0');
    first.unmount();

    getLogWitness.mockResolvedValue(state(checkpoint(), { lastWitnessedSize: null }));
    renderCard();
    expect(rowValue(await card(), 'Last witnessed head')).toBe('—');
  });
});

describe('LogWitnessCard — tone and separation', () => {
  it('treats stale-but-valid cosignatures as a warning, never a danger', async () => {
    // meetsQuorum true + meetsFreshQuorum false is the SOFT liveness signal
    // upstream explicitly calls "never a failure". Painting it red would tell
    // an operator a trust check failed when none did.
    getLogWitness.mockResolvedValue(
      state(
        checkpoint({
          witnessedCount: 3,
          meetsQuorum: true,
          freshWitnessedCount: 1,
          meetsFreshQuorum: false,
          historicalWitnessedCount: null,
        }),
      ),
    );
    renderCard();
    const el = await card();

    // The tone…
    expect(el.querySelector('.chip.warn')).not.toBeNull();
    expect(el.querySelector('.chip.bad')).toBeNull();
    // …and, separately, the WORDS. A distinction carried only by a CSS class
    // does not survive greyscale, a printout, or a screen reader, so the two
    // cases must not render the same string. The standing verdict also has to
    // exist as text rather than only as an input to that class.
    expect(rowValue(el, 'Fresh quorum')).toBe('stale');
    expect(rowValue(el, 'Standing quorum')).toBe('met');
    expect(rowValue(el, 'Fresh witnesses')).toBe('1');
    expect(rowValue(el, 'Witnesses (incl. stale)')).toBe('3');
  });

  it('DISCRIMINATES: a fresh-quorum miss with no standing quorum reads differently, not just redder', async () => {
    getLogWitness.mockResolvedValue(
      state(
        checkpoint({ witnessedCount: 1, meetsQuorum: false, freshWitnessedCount: 1, meetsFreshQuorum: false }),
      ),
    );
    renderCard();
    const el = await card();
    expect(el.querySelector('.chip.warn')).toBeNull();
    expect(rowValue(el, 'Fresh quorum')).toBe('not met');
    expect(rowValue(el, 'Standing quorum')).toBe('not met');
  });

  it('keeps the retired-key sub-count apart and never folds it into a total', async () => {
    // 2 + 5 = 7, and nothing else in these fixtures contains a 7 — so if any
    // rendering ever sums the two axes the digit appears and this fails.
    getLogWitness.mockResolvedValue(
      state(
        checkpoint({
          witnessedCount: 2,
          meetsQuorum: true,
          freshWitnessedCount: 2,
          meetsFreshQuorum: true,
          historicalWitnessedCount: 5,
        }),
      ),
    );
    renderCard();
    const el = await card();

    expect(rowValue(el, 'Fresh witnesses')).toBe('2');
    expect(rowValue(el, 'Witnesses (incl. stale)')).toBe('2');
    expect(rowValue(el, 'Under retired keys')).toBe('5');
    expect(el.textContent).not.toContain('7');
  });

  it('never renders the deployment-internal tenant id that rides along on the row', async () => {
    const cp = { ...checkpoint({ witnessedCount: 2, meetsQuorum: true }), tenantId: 'tenant-abcdef' };
    getLogWitness.mockResolvedValue(state(cp as LogWitnessCheckpoint));
    renderCard();
    const el = await card();
    expect(el.textContent).not.toContain('tenant-abcdef');
  });
});

describe('LogWitnessCard — absence and failure', () => {
  it('renders nothing at all on a 404, with no error panel', async () => {
    // "No witness state recorded for this authority" is not a fault. An empty
    // card, or a panel, would imply a missing answer where there is as yet no
    // question.
    getLogWitness.mockRejectedValue(
      new ApiError(
        404,
        JSON.stringify({ errorCode: 'REGISTRY_NOT_FOUND' }),
        'control-plane',
        `/registries/${AUTHORITY}/log-witness`,
      ),
    );
    const { container } = renderCard();
    await waitFor(() => expect(getLogWitness).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a generic panel on an unexpected status, and never blames the admin key', async () => {
    // The revocation feed's "grant it admin scope" copy would misdiagnose this
    // endpoint: unlike /auth/revocations it carries no admin guard upstream, so
    // that advice sends an operator to fix something that was never the cause.
    getLogWitness.mockRejectedValue(
      new ApiError(500, 'boom', 'control-plane', `/registries/${AUTHORITY}/log-witness`),
    );
    renderCard();
    const el = await card();
    await waitFor(() => expect(el.textContent).toContain('Could not load transparency-log witness state'));
    expect(el.textContent).not.toMatch(/admin/i);
    expect(el.textContent).not.toMatch(/CONTROL_PLANE_API_KEY/);
  });

  it('shows the cursor half with a note when no checkpoint has been retained', async () => {
    getLogWitness.mockResolvedValue(state(null, { consecutiveFailures: 2 }));
    renderCard();
    const el = await card();
    expect(el.textContent).toContain('No checkpoint retained yet.');
    expect(rowValue(el, 'Last witnessed head')).toBe('1,234');
    expect(rowValue(el, 'Consecutive failures')).toBe('2');
  });

  it('surfaces an alert with its upstream reason and the message from detail.error', async () => {
    // `detail` is jsonb, not a string: `String(detail)` renders
    // `[object Object]`, which is why only the `error` key is read.
    getLogWitness.mockResolvedValue(
      state(checkpoint(), {
        alert: {
          alerted: true,
          reason: 'consistency_failed',
          detail: { error: 'proof 1234 to 1235 failed', previous: { tree_size: 1234 } },
          at: NOW,
        },
      }),
    );
    renderCard();
    const el = await card();
    expect(el.textContent).toContain('consistency_failed');
    expect(el.textContent).toContain('proof 1234 to 1235 failed');
    expect(el.textContent).not.toContain('[object Object]');
    // ONLY `detail.error`. `JSON.stringify(detail)` would satisfy both
    // assertions above while dumping the rest of the blob — which at real
    // call sites carries `previous: {log_id, tree_size, root_hash}` and could
    // carry anything a future alert attaches — into the card.
    expect(el.textContent).not.toContain('previous');
    expect(el.textContent).not.toContain('tree_size');
  });
});
