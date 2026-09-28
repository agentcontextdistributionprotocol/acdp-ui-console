// ══════════════════════════════════════════════════════════════════════
// The scenario launch modal keeps the error object long enough to explain it.
//
// The last of #88's seventeen sites, and the only one that was not a string
// substitution. `components/scenarios/launch-modal.tsx` hand-rolls a
// `try/catch` into `useState<string | null>` via `setError(String(e))`, so the
// `ApiError` was DISCARDED at the catch — by render time there was nothing left
// to ask about status, service or provenance. A 503 and a network `TypeError`
// and a console-minted 401 all arrived as `String(e)`, which for an `ApiError`
// is `ApiError: <the upstream's raw body>` (its constructor passes the body
// straight to `super`, `fetcher.ts:81`).
//
// So this phase is a small state refactor, not a copy change, and these tests
// are about the state as much as the string.
//
// NOTE ON THE WRAPPER OBJECT. The state holds `{ err: unknown } | null`, not
// `unknown`. `useState`'s setter treats a FUNCTION argument as a functional
// update, so `setCaught(e)` would silently invoke a callable thrown value, and
// `setCaught(() => e)` is the same trap reversed — it schedules the error AS an
// updater and stores its return. A wrapper makes the ambiguity unrepresentable;
// `'stores the thrown value, not a pre-stringified message'` below is what
// holds that shape in place.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import type { ScenarioDef } from '@/lib/types';

const startRun = vi.fn();
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  startRun: (...a: unknown[]) => startRun(...a),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/scenarios',
  useSearchParams: () => new URLSearchParams(),
}));

import { LaunchModal } from '@/components/scenarios/launch-modal';

const SCENARIO: ScenarioDef = {
  id: 'sc-supply-chain',
  name: 'Supply chain',
  description: 'Three agents publish and consume contexts.',
  registry_mode: 'single',
  agent_count: 3,
  framework: 'langgraph',
  default_inputs: { region: 'emea', batches: 4 },
};

// A body an operator must never be shown as their primary sentence. FastAPI's
// own shape, because the playground is what this surface talks to:
// `HTTPException(404, "unknown scenario: …")` serialises as `{"detail": …}`,
// which carries NO `errorCode` — `parseErrorCode` reads `errorCode` and
// `error.code` only. Every arm this surface reaches is a status arm.
const RAW = '{"detail":"unknown scenario: sc-supply-chain"}';

function playgroundError(status: number, fromUpstream = true): ApiError {
  return new ApiError(status, RAW, 'playground', '/runs', fromUpstream);
}

// `onClose` is a spy, not a no-op. The modal's visibility is driven by its
// `scenario` PROP (`open={!!scenario}`), which a test holding that prop constant
// can never change — so `expect(querySelector('[role="dialog"]')).not.toBeNull()`
// is unfalsifiable and stayed green with `onClose()` called from the catch.
// `app/scenarios/page.tsx:73` wires `onClose={() => setSelected(null)}`, which
// really does unmount it. The observable fact is therefore the CALL.
const onClose = vi.fn();

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <LaunchModal scenario={SCENARIO} onClose={onClose} />
    </QueryClientProvider>,
  );
}

async function launch(): Promise<HTMLElement> {
  const { container } = mount();
  fireEvent.click(screen.getByRole('button', { name: /Run scenario/ }));
  return container;
}

beforeEach(() => {
  startRun.mockResolvedValue({ run_id: 'run-1' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the four rejection shapes', () => {
  it('a stamped 404 says the id is unknown to THIS playground, not that it is transient', async () => {
    startRun.mockRejectedValue(playgroundError(404));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    expect(container.textContent).toContain('no scenario with that id exists on this playground.');
    // The generic 404 arm it displaced — "the playground has no record of it" —
    // is true but says nothing about what to do. This is a demo/deployment
    // mismatch, and naming that is the point of the override.
    expect(container.textContent).not.toContain('has no record of it');
  });

  it('a stamped 503 says wait and retry, and does NOT say not-found', async () => {
    startRun.mockRejectedValue(playgroundError(503));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    expect(container.textContent).toContain('the playground is unavailable or rate limiting');
    expect(container.textContent).not.toMatch(/no scenario with that id/);
  });

  it('an UNSTAMPED 401 blames this console, not the playground', async () => {
    // The bytes never left the box — `middleware.ts` minting a 401 for an
    // expired session, or Next's 500 for an unset `PLAYGROUND_BASE_URL`.
    // Naming the playground here points the operator at a service that was
    // never reached.
    startRun.mockRejectedValue(playgroundError(401, false));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    expect(container.textContent).toContain('This console could not complete the request');
    expect(container.textContent).not.toContain('the playground');
  });

  it('a bare TypeError renders the lead alone — no service, no status', async () => {
    // `fetch` itself rejecting never reaches the `!response.ok` branch, so no
    // `ApiError` is ever constructed. The catch narrows nothing, which is
    // exactly why `operatorErrorMessage` takes `unknown`.
    startRun.mockRejectedValue(new TypeError('Failed to fetch'));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario.'),
    );
    expect(container.textContent).not.toContain('playground');
    expect(container.textContent).not.toMatch(/\b\d{3}\b/);
    expect(container.textContent).not.toContain('Failed to fetch');
  });

  it('demotes the raw body into the disclosure rather than deleting it', async () => {
    startRun.mockRejectedValue(playgroundError(500));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    const det = container.querySelector('details.error-detail')!;
    expect(det.textContent).toContain('unknown scenario: sc-supply-chain');
    det.remove();
    expect(container.textContent).not.toContain('unknown scenario: sc-supply-chain');
    expect(container.textContent).not.toContain('ApiError');
  });

  it('renders NO empty disclosure for a non-ApiError throw', async () => {
    // A `<details>` that opens onto nothing is worse than no disclosure, and
    // `errorDiagnostic` returns `undefined` here — there are no upstream bytes.
    startRun.mockRejectedValue(new TypeError('Failed to fetch'));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario.'),
    );
    expect(container.querySelector('details')).toBeNull();
  });
});

describe('the modal survives a failure and forgets it on the next try', () => {
  it('stays open after a failed launch', async () => {
    // The operator needs the message beside the form they submitted. `onClose`
    // runs only after a successful `startRun`.
    startRun.mockRejectedValue(playgroundError(503));
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    // …and the form is still usable: the launch button is re-enabled, not left
    // in its "Launching…" state.
    expect(screen.getByRole('button', { name: /Run scenario/ })).not.toBeDisabled();
    expect(push).not.toHaveBeenCalled();
  });

  it('clears the previous error before the next attempt, not after it', async () => {
    startRun.mockRejectedValueOnce(playgroundError(503));
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Run scenario/ }));
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );

    // Second attempt succeeds. A stale red line under a launch that worked is
    // worse than no line at all.
    fireEvent.click(screen.getByRole('button', { name: /Run scenario/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/runs/run-1'));
    expect(container.textContent).not.toContain('Could not start this scenario');
  });
});

describe('the state holds the error, not a string', () => {
  it('never invokes a callable thrown value', async () => {
    // The behavioural form of "the state is wrapped". `useState`'s setter reads
    // a FUNCTION argument as a functional update, so storing the caught value
    // bare would INVOKE it — silently, with React's previous state as the
    // argument, and then store whatever it returned. A thrown function is
    // exotic but not impossible (a rejected promise carrying a callable, a
    // library that throws a constructor), and the failure mode is arbitrary
    // code running inside a state update.
    //
    // This replaces a source-text assertion that string-matched
    // `setCaught({ err: e })` and the exact `useState<…>` type argument.
    // Verification showed that test FAILING on a pure rename of the state
    // variable — a behaviour-preserving edit — which is a guard that costs more
    // than it protects. This one kills the same mutation with no false
    // positive.
    const spy = vi.fn(() => 'invoked');
    startRun.mockRejectedValue(spy);
    const container = await launch();
    await waitFor(() =>
      expect(container.textContent).toContain('Could not start this scenario'),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('derives the message from the stored value, not from a string it kept', async () => {
    // The other half, and the one the raw-body tests already cover from the
    // other direction: a 404 and a 503 rendered from the SAME code path produce
    // different sentences, which is only possible if the status survived to
    // render time.
    startRun.mockRejectedValueOnce(playgroundError(404));
    const a = await launch();
    await waitFor(() => expect(a.textContent).toContain('no scenario with that id'));
    cleanup();

    startRun.mockRejectedValueOnce(playgroundError(503));
    const b = await launch();
    await waitFor(() => expect(b.textContent).toContain('unavailable or rate limiting'));
  });

  it('keeps the form-input coercion at :43, which is not an error site', () => {
    // `String(v ?? '')` turns a scenario's default input into a text-input
    // value. A whole-file `String(` grep would have demanded its removal; the
    // criterion is about `String(` applied to a caught error, not the token.
    const src = readFileSync(
      join(process.cwd(), 'components/scenarios/launch-modal.tsx'),
      'utf8',
    );
    expect(src).toContain("String(v ?? '')");
  });
});
