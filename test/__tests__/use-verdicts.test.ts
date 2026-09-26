import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';
import { useContextVerdicts, verificationKey } from '@/lib/verify/use-verdicts';

const verifyContentHash = vi.fn();
const verifyCtxIdBinding = vi.fn();
const verifyProducerSignature = vi.fn();
const verifyRegistryReceipt = vi.fn();
const verifyLineageHeadReceipt = vi.fn();
const verifyTransparencyLog = vi.fn();
const verifyWitnessQuorum = vi.fn();

vi.mock('@/lib/verify/verify', () => ({
  verifyContentHash: (...args: unknown[]) => verifyContentHash(...args),
  verifyCtxIdBinding: (...args: unknown[]) => verifyCtxIdBinding(...args),
  verifyProducerSignature: (...args: unknown[]) => verifyProducerSignature(...args),
  verifyRegistryReceipt: (...args: unknown[]) => verifyRegistryReceipt(...args),
  verifyLineageHeadReceipt: (...args: unknown[]) => verifyLineageHeadReceipt(...args),
  verifyTransparencyLog: (...args: unknown[]) => verifyTransparencyLog(...args),
  verifyWitnessQuorum: (...args: unknown[]) => verifyWitnessQuorum(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const OK = { status: 'verified', detail: 'ok' };

describe('useContextVerdicts (UI-4: wasm-init failure must be visible)', () => {
  it('resolves ready:true with the verdicts once every check settles', async () => {
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    const ctx = MOCK_CONTEXTS[0];

    const { result } = renderHook(() => useContextVerdicts(ctx, undefined, ctx.body.ctx_id));
    expect(result.current.ready).toBe(false);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeUndefined();
    expect(result.current.contentHash).toEqual(OK);
    expect(result.current.ctxIdBinding).toEqual(OK);
  });

  it('a wasm init failure surfaces as `error`, not a permanently-pending state', async () => {
    verifyContentHash.mockRejectedValue(new Error('acdp-wasm is browser-only and cannot run during SSR'));
    const ctx = MOCK_CONTEXTS[0];

    const { result } = renderHook(() => useContextVerdicts(ctx, undefined, ctx.body.ctx_id));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.error).toBe('acdp-wasm is browser-only and cannot run during SSR');
    // The whole point of UI-4: `ready` must flip to true on failure too, so a
    // consumer never renders "verifying…" forever with no indication anything
    // went wrong.
    expect(result.current.contentHash).toBeUndefined();
  });

  it('re-runs when the ctx_id/content_hash/requestedCtxId key changes', async () => {
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    const { result, rerender } = renderHook(
      ({ ctx, requestedCtxId }) => useContextVerdicts(ctx, undefined, requestedCtxId),
      { initialProps: { ctx: MOCK_CONTEXTS[0], requestedCtxId: MOCK_CONTEXTS[0].body.ctx_id } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(verifyContentHash).toHaveBeenCalledTimes(1);

    rerender({ ctx: MOCK_CONTEXTS[1], requestedCtxId: MOCK_CONTEXTS[1].body.ctx_id });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(verifyContentHash).toHaveBeenCalledTimes(2);
  });
});

describe('useContextVerdicts > ctxIdBinding (UI-2 Phase 2: anti-tautology)', () => {
  it('passes the CALLER-supplied requestedCtxId to verifyCtxIdBinding, not ctx.body.ctx_id', async () => {
    // The whole point of this check is that `expected_ctx_id` is independent of
    // the served body. If the hook accidentally sourced it from `ctx.body.ctx_id`
    // instead of the `requestedCtxId` argument, this assertion would catch it
    // even though the verdict itself would still show green either way.
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    const ctx = MOCK_CONTEXTS[0];
    const requested = 'acdp://some-other-registry.example/11111111-1111-4111-8111-111111111111';

    renderHook(() => useContextVerdicts(ctx, undefined, requested));
    await waitFor(() => expect(verifyCtxIdBinding).toHaveBeenCalled());

    expect(verifyCtxIdBinding).toHaveBeenCalledWith(ctx.body, requested);
    expect(verifyCtxIdBinding).not.toHaveBeenCalledWith(ctx.body, ctx.body.ctx_id);
  });

  it('a mismatched requested-vs-served ctx_id surfaces as a failed verdict, not a swallowed one', async () => {
    verifyContentHash.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    const FAILED = { status: 'failed', detail: 'served body does not match the requested ctx_id' };
    verifyCtxIdBinding.mockResolvedValue(FAILED);
    const ctx = MOCK_CONTEXTS[0];

    const { result } = renderHook(() =>
      useContextVerdicts(ctx, undefined, 'acdp://wrong-registry.example/22222222-2222-4222-8222-222222222222'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.ctxIdBinding).toEqual(FAILED);
  });
});

// ══════════════════════════════════════════════════════════════════════
// UI-3 Phase 5: the memo key must cover every input the effect reads.
//
// The key was `ctx_id:content_hash:requestedCtxId` while the effect also read
// `registry_state.status`, `registry_receipt`, `lineage_head_receipt` and
// `log_inclusion` — and, through its callees, `body.signature` and
// `log_inclusion.witness_signatures`. `ctx` was not in the dep array and
// `exhaustive-deps` was suppressed, so a refetch returning the same body with
// different registry material left the effect closed over the OLD context.
//
// Two symptoms, both rendered rather than thrown, which is why no existing test
// caught them: a green chip for a verdict computed against superseded data, and
// a "verifying…" state that never resolves because the chip's material arrived
// in a refetch the hook never noticed.
//
// Every test here re-renders the SAME hook instance with a new `ctx` — the
// shape a React Query refetch actually produces. Asserting on a fresh mount
// would pass on the broken code.
// ══════════════════════════════════════════════════════════════════════
describe('useContextVerdicts > the memo key covers everything the effect reads', () => {
  /** A byte-identical context with a fresh object identity — what a refetch returns. */
  const refetch = <T,>(ctx: T): T => JSON.parse(JSON.stringify(ctx)) as T;

  // The one fixture carrying all three attestation surfaces: registry receipt,
  // lineage-head receipt, and log inclusion with witness cosignatures.
  const ATTESTED = MOCK_CONTEXTS[3];

  function allOk() {
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue({ status: 'verified', witnessed: 2, detail: '2-witnessed' });
  }

  /** Mount on `initial`, wait for the first pass to settle. */
  async function mount(initial: (typeof MOCK_CONTEXTS)[number], requested = initial.body.ctx_id) {
    const view = renderHook(
      ({ ctx, docs }: { ctx: (typeof MOCK_CONTEXTS)[number]; docs: undefined | Record<string, unknown> }) =>
        useContextVerdicts(ctx, docs, requested),
      { initialProps: { ctx: initial, docs: undefined as undefined | Record<string, unknown> } },
    );
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    return view;
  }

  // ── CRITERION 5 first: the memo must still memoize ───────────────────
  //
  // The regression risk. Widening the key is trivially "correct" if it just
  // re-verifies on every poll — and that is precisely what the key exists to
  // prevent, since the work behind it is the wasm verification suite. Every
  // test below is only meaningful because this one holds.
  it('CRITERION 5: a byte-identical refetch does NOT re-run verification', async () => {
    allOk();
    const view = await mount(ATTESTED);
    const calls = verifyContentHash.mock.calls.length;
    expect(calls).toBe(1);

    view.rerender({ ctx: refetch(ATTESTED), docs: undefined });
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    expect(verifyContentHash).toHaveBeenCalledTimes(calls);
    expect(verifyWitnessQuorum).toHaveBeenCalledTimes(1);
  });

  it('CRITERION 1: a status flip active → retracted recomputes the lineage-head receipt', async () => {
    // `verifyLineageHeadReceipt` binds `expected.head_status = status`, so the
    // verdict is a function of the status. The fresh context re-rendered the
    // status field and the retraction banner while the chip beside them kept
    // the verdict computed against `active` — green where a re-run goes red.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyLineageHeadReceipt).toHaveBeenCalledTimes(1);
    expect(verifyLineageHeadReceipt.mock.calls[0][2]).toBe('active');

    const retracted = refetch(ATTESTED);
    retracted.registry_state.status = 'retracted';
    view.rerender({ ctx: retracted, docs: undefined });

    await waitFor(() => expect(verifyLineageHeadReceipt).toHaveBeenCalledTimes(2));
    expect(verifyLineageHeadReceipt.mock.calls[1][2]).toBe('retracted');
  });

  it('CRITERION 2: a refetch that ADDS a registry receipt resolves its chip', async () => {
    // The "permanent verifying…" case. With the receipt absent on first load
    // `verdicts.registryReceipt` is undefined and `ready` is true; the Group
    // then renders from the fresh context while the chip's `!verdict` branch
    // shows "verifying…" forever — the exact UI-4 failure the hook's error
    // banner exists to prevent, reached by a different route.
    allOk();
    const without = refetch(ATTESTED);
    delete (without as { registry_receipt?: unknown }).registry_receipt;

    const view = await mount(without);
    expect(view.result.current.registryReceipt).toBeUndefined();
    expect(view.result.current.ready).toBe(true);

    view.rerender({ ctx: refetch(ATTESTED), docs: undefined });

    await waitFor(() => expect(view.result.current.registryReceipt).toEqual(OK));
  });

  it('presence → ABSENCE changes the key too, in the other direction', async () => {
    // Both directions, because a key built only from "is it there" flags would
    // pass the test above and fail this one.
    allOk();
    const view = await mount(ATTESTED);
    expect(view.result.current.registryReceipt).toEqual(OK);

    const without = refetch(ATTESTED);
    delete (without as { registry_receipt?: unknown }).registry_receipt;
    view.rerender({ ctx: without, docs: undefined });

    // Wait on the RE-RUN, not on `registryReceipt` going undefined: the key
    // change resets the verdicts to `{ready:false}`, so `registryReceipt` is
    // undefined the instant the rerender commits and a `waitFor` on it would
    // resolve against the reset rather than the result. `verifyContentHash` is
    // the one check that runs unconditionally, so its second call is the
    // signal that the new pass actually happened.
    await waitFor(() => expect(verifyContentHash).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.registryReceipt).toBeUndefined();
  });

  it('CRITERION 3: one more witness cosignature recomputes the quorum', async () => {
    // The row the other five cannot stand in for. `witness_signatures` is a
    // top-level SIBLING of `log_checkpoint`, never inside the closed, signed
    // checkpoint — so a refetch carrying a third cosignature changes NONE of
    // the receipt or checkpoint signatures. Keying only on those would leave
    // the chip reading "2-witnessed" after a third witness cosigned.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyWitnessQuorum).toHaveBeenCalledTimes(1);

    const moreWitnessed = refetch(ATTESTED);
    const cosigs = moreWitnessed.log_inclusion!.witness_signatures!;
    cosigs.push({
      ...cosigs[0],
      witness_id: 'did:web:witness-gamma.trust.example',
      signature: { ...cosigs[0].signature, value: 'Z3JvdW5kdHJ1dGgtdGhpcmQtd2l0bmVzcw==' },
    });
    view.rerender({ ctx: moreWitnessed, docs: undefined });

    await waitFor(() => expect(verifyWitnessQuorum).toHaveBeenCalledTimes(2));
  });

  it('DISCRIMINATES: the same cosignatures in a different ORDER do not re-verify', async () => {
    // The paired mirror of the test above. Cosignature order is not guaranteed
    // stable across responses, so a key that concatenated them unsorted would
    // pass criterion 3 by re-verifying on every poll — correct-looking, and
    // exactly the cost the memo exists to avoid.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyWitnessQuorum).toHaveBeenCalledTimes(1);

    const reordered = refetch(ATTESTED);
    reordered.log_inclusion!.witness_signatures!.reverse();
    view.rerender({ ctx: reordered, docs: undefined });
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    expect(verifyWitnessQuorum).toHaveBeenCalledTimes(1);
  });

  it('CRITERION 4: a key rotation over IDENTICAL content re-verifies the signature', async () => {
    // `content_hash` is the signature's INPUT, not a digest of it — the
    // producer signature is computed over the hash — so re-signing identical
    // content under a rotated key changes `signature.key_id` and `.value` and
    // changes neither `ctx_id` nor `content_hash`. Without this the green
    // "signature valid for the resolved producer key" chip would sit beside the
    // NEW key_id the same component renders two rows down.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyProducerSignature).toHaveBeenCalledTimes(1);

    const rotated = refetch(ATTESTED);
    rotated.body.signature = {
      ...rotated.body.signature!,
      key_id: `${rotated.body.signature!.key_id.split('#')[0]}#key-2`,
      value: 'cm90YXRlZC1rZXktc2lnbmF0dXJlLXZhbHVl',
    };
    // The premise of the test, asserted rather than assumed.
    expect(rotated.body.ctx_id).toBe(ATTESTED.body.ctx_id);
    expect(rotated.body.content_hash).toBe(ATTESTED.body.content_hash);

    view.rerender({ ctx: rotated, docs: undefined });

    await waitFor(() => expect(verifyProducerSignature).toHaveBeenCalledTimes(2));
    expect(verifyRegistryReceipt).toHaveBeenCalledTimes(2);
  });

  it('a mutated hashed field re-verifies even when the CLAIMED content_hash is restated', async () => {
    // `verifyContentHash` recomputes the digest from the whole body, so its
    // input cannot be enumerated field by field the way every other check's
    // can. A second response that mutates a hashed field while restating the
    // original `content_hash` would otherwise keep the green hash chip beside
    // the mutated value — the same stale-green class, through the one check
    // with an open-ended input.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyContentHash).toHaveBeenCalledTimes(1);

    const tampered = refetch(ATTESTED);
    tampered.body.title = 'Something the producer never signed';
    expect(tampered.body.content_hash).toBe(ATTESTED.body.content_hash);

    view.rerender({ ctx: tampered, docs: undefined });

    await waitFor(() => expect(verifyContentHash).toHaveBeenCalledTimes(2));
  });

  it('CRITERION 7: an in-flight verification cannot write into the newer state', async () => {
    // Regression only — the `cancelled` guard predates this phase. Asserted so
    // the rewrite of the dep array cannot quietly drop it: the first pass is
    // held open, the key is changed, and only then is the first pass allowed to
    // finish. Its result must be discarded.
    let releaseFirst: (v: unknown) => void = () => {};
    const STALE = { status: 'verified', detail: 'STALE — from the first pass' };
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);
    verifyContentHash.mockImplementationOnce(() => new Promise((res) => { releaseFirst = res; }));

    const view = renderHook(
      ({ ctx }: { ctx: (typeof MOCK_CONTEXTS)[number] }) => useContextVerdicts(ctx, undefined, ctx.body.ctx_id),
      { initialProps: { ctx: ATTESTED } },
    );
    expect(view.result.current.ready).toBe(false);

    // Key changes while the first pass is still parked.
    const FRESH = { status: 'verified', detail: 'fresh' };
    verifyContentHash.mockResolvedValue(FRESH);
    const retracted = refetch(ATTESTED);
    retracted.registry_state.status = 'retracted';
    view.rerender({ ctx: retracted });

    releaseFirst(STALE);
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    expect(view.result.current.contentHash).toEqual(FRESH);
    expect(view.result.current.contentHash).not.toEqual(STALE);
  });

  it('a new requestedCtxId re-runs the binding check on an unchanged context', async () => {
    // The memo's second dependency. `ctx` alone is the natural dep to write,
    // and no call site varies `requestedCtxId` against a stable `ctx` today —
    // which is exactly why nothing but an ungated lint warning would catch it
    // being dropped. `verifyCtxIdBinding` exists to answer "is this the
    // context I asked for", so a key blind to what was asked makes it
    // tautological.
    allOk();
    const view = renderHook(
      ({ requested }: { requested: string }) => useContextVerdicts(ATTESTED, undefined, requested),
      { initialProps: { requested: ATTESTED.body.ctx_id } },
    );
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(verifyCtxIdBinding).toHaveBeenCalledTimes(1);

    view.rerender({ requested: 'acdp://elsewhere.example/ctx/1' });

    await waitFor(() => expect(verifyCtxIdBinding).toHaveBeenCalledTimes(2));
    expect(verifyCtxIdBinding.mock.calls[1][1]).toBe('acdp://elsewhere.example/ctx/1');
  });

  it('CRITERION 8: `docs` still re-runs verification on its own', async () => {
    // Already correct before this phase (`docs` was in the dep array), and the
    // rewrite must not narrow it: a DID document arriving after first paint is
    // what turns "material only" into a real verdict.
    allOk();
    const view = await mount(ATTESTED);
    expect(verifyProducerSignature).toHaveBeenCalledTimes(1);

    view.rerender({ ctx: ATTESTED, docs: { 'did:web:example': {} } });

    await waitFor(() => expect(verifyProducerSignature).toHaveBeenCalledTimes(2));
    expect(verifyProducerSignature.mock.calls[1][1]).toEqual({ 'did:web:example': {} });
  });

  it('hands every verifier exactly the material it is supposed to check', async () => {
    // Not a memo-key property, and outside this phase's defect class — but
    // mutation testing during the gate showed the whole argument list was
    // unpinned: `verifyLineageHeadReceipt` would accept the REGISTRY receipt,
    // the body could be swapped for `{}`, and `docs` could be dropped from
    // four of the seven calls, all with the suite green. None of those can
    // produce a false green (they fail closed, into a red chip or a
    // "verification unavailable" banner), which is exactly why nothing caught
    // them. Pinned here in one sweep.
    allOk();
    const docs = { 'did:web:producer.example': { id: 'did:web:producer.example' } };
    const view = renderHook(
      ({ ctx }: { ctx: (typeof MOCK_CONTEXTS)[number] }) =>
        useContextVerdicts(ctx, docs, ctx.body.ctx_id),
      { initialProps: { ctx: ATTESTED } },
    );
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    const body = ATTESTED.body;
    expect(verifyContentHash).toHaveBeenCalledWith(body);
    expect(verifyProducerSignature).toHaveBeenCalledWith(body, docs);
    expect(verifyCtxIdBinding).toHaveBeenCalledWith(body, ATTESTED.body.ctx_id);
    expect(verifyRegistryReceipt).toHaveBeenCalledWith(ATTESTED.registry_receipt, body, docs);
    expect(verifyLineageHeadReceipt).toHaveBeenCalledWith(
      ATTESTED.lineage_head_receipt, body, ATTESTED.registry_state.status, docs,
    );
    expect(verifyTransparencyLog).toHaveBeenCalledWith(
      ATTESTED.log_inclusion, ATTESTED.registry_receipt, docs,
    );
    expect(verifyWitnessQuorum).toHaveBeenCalledWith(ATTESTED.log_inclusion, docs);
  });

  it('does not run the transparency-log check without an inclusion proof', async () => {
    allOk();
    const noLog = refetch(ATTESTED);
    delete (noLog as { log_inclusion?: unknown }).log_inclusion;

    const view = await mount(noLog);
    expect(verifyTransparencyLog).not.toHaveBeenCalled();
    expect(verifyWitnessQuorum).not.toHaveBeenCalled();
    expect(view.result.current.transparencyLog).toBeUndefined();
  });

  it('does not run the registry-receipt check without a receipt', async () => {
    allOk();
    const noReceipt = refetch(ATTESTED);
    delete (noReceipt as { registry_receipt?: unknown }).registry_receipt;

    const view = await mount(noReceipt);
    expect(verifyRegistryReceipt).not.toHaveBeenCalled();
    expect(view.result.current.registryReceipt).toBeUndefined();
  });

  it('does not run the lineage-head check when there is no such receipt', async () => {
    allOk();
    const noLhr = refetch(ATTESTED);
    delete (noLhr as { lineage_head_receipt?: unknown }).lineage_head_receipt;

    const view = await mount(noLhr);
    expect(verifyLineageHeadReceipt).not.toHaveBeenCalled();
    expect(view.result.current.lineageHeadReceipt).toBeUndefined();
  });

  it('an inclusion proof with no cosignatures yields no quorum verdict', async () => {
    // The unwitnessed-but-logged state: `verifyWitnessQuorum` must not be
    // called at all, so the quorum chip renders "not witnessed" rather than a
    // verdict computed over an empty set.
    allOk();
    const unwitnessed = refetch(ATTESTED);
    delete unwitnessed.log_inclusion!.witness_signatures;

    const view = await mount(unwitnessed);
    expect(view.result.current.transparencyLog).toEqual(OK);
    expect(view.result.current.witnessQuorum).toBeUndefined();
    expect(verifyWitnessQuorum).not.toHaveBeenCalled();
  });

  it('CRITERION 7 (failure path): a superseded pass that REJECTS cannot write its error', async () => {
    // The success path's `cancelled` guard has its own test above. This is the
    // catch branch, which is not the same line and survives deletion without
    // it: a first pass that throws after the key has moved on would otherwise
    // overwrite the newer state with `{ ready: true, error }` — a stuck red
    // banner describing material the component is no longer showing, which is
    // the stale-verdict symptom wearing the opposite colour.
    let rejectFirst: (e: Error) => void = () => {};
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);
    verifyContentHash.mockImplementationOnce(() => new Promise((_res, rej) => { rejectFirst = rej; }));

    const view = renderHook(
      ({ ctx }: { ctx: (typeof MOCK_CONTEXTS)[number] }) => useContextVerdicts(ctx, undefined, ctx.body.ctx_id),
      { initialProps: { ctx: ATTESTED } },
    );

    const FRESH = { status: 'verified', detail: 'fresh' };
    verifyContentHash.mockResolvedValue(FRESH);
    const retracted = refetch(ATTESTED);
    retracted.registry_state.status = 'retracted';
    view.rerender({ ctx: retracted });

    // The newer pass must land FIRST, then the superseded one rejects. Rejecting
    // while the newer pass is still in flight would pass with or without the
    // guard — the newer `setState` simply overwrites the error a moment later —
    // so ordering it this way is what makes the assertion discriminating.
    await waitFor(() => expect(view.result.current.contentHash).toEqual(FRESH));

    rejectFirst(new Error('stale wasm failure'));
    // `act`, not a bare `setTimeout`: without it React never commits the
    // superseded `setState` before the assertion reads it, so the test passes
    // whether or not the guard is there. That is the whole failure this test
    // exists to catch, and it is easy to reintroduce here.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.contentHash).toEqual(FRESH);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The key is computed during RENDER, so it must not be able to throw there.
// ══════════════════════════════════════════════════════════════════════
describe('a body JSON.stringify refuses', () => {
  /** A context React Query parsed but that cannot be serialised. */
  function cyclic() {
    const ctx = JSON.parse(JSON.stringify(MOCK_CONTEXTS[3])) as (typeof MOCK_CONTEXTS)[number];
    (ctx.body as unknown as { self?: unknown }).self = ctx.body;
    return ctx;
  }

  it('throws out of verificationKey — which is why the hook guards it', () => {
    expect(() => verificationKey(cyclic(), 'acdp://x/1')).toThrow();
  });

  it('renders a verdict instead of taking the page down', async () => {
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);

    const ctx = cyclic();
    const { result, rerender } = renderHook(
      ({ c }: { c: (typeof MOCK_CONTEXTS)[number] }) => useContextVerdicts(c, undefined, c.body.ctx_id),
      { initialProps: { c: ctx } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.contentHash).toEqual(OK);

    // The fallback is a FUNCTION of the context, not a fresh id per render or
    // per object: a distinct object carrying the same identity fields must not
    // re-verify. A random or counter-based fallback fails this and re-runs the
    // whole wasm suite for as long as such a context stays mounted.
    const calls = verifyContentHash.mock.calls.length;
    rerender({ c: cyclic() });
    rerender({ c: cyclic() });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(verifyContentHash).toHaveBeenCalledTimes(calls);

    // A different ctx_id does re-verify — the fallback still discriminates.
    const other = cyclic();
    other.body.ctx_id = 'acdp://registry-a.example/ctx/other-unserialisable';
    rerender({ c: other });
    await waitFor(() => expect(verifyContentHash).toHaveBeenCalledTimes(calls + 1));
  });

  it('the fallback tracks ctx_id independently of what was requested', async () => {
    // Holding `requestedCtxId` fixed is what makes this discriminating: the
    // two move together at every call site, so a fallback that dropped
    // `ctx_id` and kept only the requested id would look correct.
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);

    const REQUESTED = 'acdp://registry-a.example/ctx/requested';
    const { result, rerender } = renderHook(
      ({ c }: { c: (typeof MOCK_CONTEXTS)[number] }) => useContextVerdicts(c, undefined, REQUESTED),
      { initialProps: { c: cyclic() } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const calls = verifyContentHash.mock.calls.length;

    const served = cyclic();
    served.body.ctx_id = 'acdp://registry-a.example/ctx/something-else';
    rerender({ c: served });
    await waitFor(() => expect(verifyContentHash).toHaveBeenCalledTimes(calls + 1));
  });

  it('the fallback tracks requestedCtxId independently of what was served', async () => {
    // The mirror of the test above, and the reason both are needed: the two
    // fields move together at every call site, so pinning only one leaves the
    // other free. Dropping `requestedCtxId` here would strand the
    // `ctxIdBinding` verdict — this phase's own defect class, one level down
    // on the path that runs when the body cannot be serialised.
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);

    const ctx = cyclic();
    const { result, rerender } = renderHook(
      ({ requested }: { requested: string }) => useContextVerdicts(ctx, undefined, requested),
      { initialProps: { requested: ctx.body.ctx_id } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const calls = verifyCtxIdBinding.mock.calls.length;

    rerender({ requested: 'acdp://elsewhere.example/ctx/1' });

    await waitFor(() => expect(verifyCtxIdBinding).toHaveBeenCalledTimes(calls + 1));
    expect(verifyCtxIdBinding.mock.calls[calls][1]).toBe('acdp://elsewhere.example/ctx/1');
  });

  it('the fallback still tracks content_hash, and declares what it cannot see', async () => {
    // Pins the tradeoff the docblock declares, in both directions, so that
    // narrowing it further is a test failure rather than a silent loss.
    verifyContentHash.mockResolvedValue(OK);
    verifyCtxIdBinding.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    verifyRegistryReceipt.mockResolvedValue(OK);
    verifyLineageHeadReceipt.mockResolvedValue(OK);
    verifyTransparencyLog.mockResolvedValue(OK);
    verifyWitnessQuorum.mockResolvedValue(OK);

    const { result, rerender } = renderHook(
      ({ c }: { c: (typeof MOCK_CONTEXTS)[number] }) => useContextVerdicts(c, undefined, c.body.ctx_id),
      { initialProps: { c: cyclic() } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const calls = verifyContentHash.mock.calls.length;

    // KEPT: a new content_hash re-verifies.
    const rehashed = cyclic();
    rehashed.body.content_hash = `sha256:${'b'.repeat(64)}`;
    rerender({ c: rehashed });
    await waitFor(() => expect(verifyContentHash).toHaveBeenCalledTimes(calls + 1));

    // NOT KEPT, and deliberately so: with the body unserialisable there is
    // nothing to hash it with, so a body-field edit under an unchanged id and
    // hash is invisible. Reachable only if something in-process mutated the
    // context after parsing — `JSON.parse` cannot produce a cycle.
    const retitled = cyclic();
    retitled.body.content_hash = `sha256:${'b'.repeat(64)}`;
    retitled.body.title = 'a field the fallback cannot see';
    rerender({ c: retitled });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(verifyContentHash).toHaveBeenCalledTimes(calls + 1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// CRITERION 6: the suppression must not come back.
//
// `react-hooks/exhaustive-deps` is a WARNING in this config, and both
// `package.json`'s lint script and `ci.yml` run `eslint .` without
// `--max-warnings 0`. So re-adding the disable comment — the exact mechanism
// that let the effect close over a previous fetch's `ctx` — would be a silent
// no-op in CI. This asserts it directly instead of trusting a soft gate.
// ══════════════════════════════════════════════════════════════════════
describe('the exhaustive-deps suppression stays gone', () => {
  it('has no eslint-disable for react-hooks in the hook source', async () => {
    // `process.cwd()`, not `import.meta.url`: under the jsdom environment the
    // module URL is not a `file:` scheme and `readFileSync` rejects it. Vitest
    // runs from the repo root.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/verify/use-verdicts.ts'), 'utf8');
    expect(src).not.toMatch(/eslint-disable[^\n]*react-hooks/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The key, row by row.
//
// The hook-level suite above proves the DEFECT is fixed. What it cannot reach
// is a receipt re-issued under the same key id with a new signature value, a
// cosignature re-attributed to another witness, or a witness set in a
// different order — each needs one fixture differing from another in a single
// field, which is more surface than asserting the key directly. The first of
// those is the mistake the plan warns about: `receipt.signature.signature` is
// `undefined`, which produces a key that looks complete and silently never
// changes.
//
// The key's structural invariants live here too, because nothing observable
// depends on them: that the signature row stays disjoint from the serialised
// body, and that no row restates another. Both are how a row stops being
// killable without any test going red.
//
// So each row is asserted directly: change exactly one input, and the key must
// change. Deleting any row turns one of these red.
// ══════════════════════════════════════════════════════════════════════
describe('verificationKey — every row is load-bearing', () => {
  const ATTESTED = MOCK_CONTEXTS[3];
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const keyOf = (ctx: typeof ATTESTED) => verificationKey(ctx, ctx.body.ctx_id);
  const base = () => keyOf(ATTESTED);

  /** Mutate one input on a fresh clone and return the resulting key. */
  function keyAfter(mutate: (ctx: typeof ATTESTED) => void): string {
    const ctx = clone(ATTESTED);
    mutate(ctx);
    return verificationKey(ctx, ATTESTED.body.ctx_id);
  }

  it('is stable for a byte-identical context — the memo must still memoize', () => {
    expect(keyOf(clone(ATTESTED))).toBe(base());
  });

  it('keeps the signature row disjoint from the serialised body', () => {
    // The invariant that makes the signature row load-bearing rather than a
    // comment riding on the body serialisation. Putting `signature` back
    // inside the body is behaviourally equivalent — the key stays a superset —
    // so no verdict test can see it, and the moment it happens the signature
    // row becomes unkillable. Asserted structurally instead.
    const rows = JSON.parse(base()) as unknown[];
    expect(rows[1]).toMatchObject({ value: expect.any(String) });
    expect(rows[2]).not.toHaveProperty('signature');
  });

  it('does not restate the body id and hash as rows of their own', () => {
    // Both live inside the serialised body. Naming them again would be the
    // redundancy this file removes everywhere else — protection no test can
    // distinguish from its absence.
    const rows = JSON.parse(base()) as unknown[];
    expect(rows).not.toContain(ATTESTED.body.content_hash);
    expect(rows.filter((r) => r === ATTESTED.body.ctx_id)).toHaveLength(1); // requestedCtxId only
  });

  it('changes when the independently-requested ctx_id changes', () => {
    expect(verificationKey(ATTESTED, 'acdp://elsewhere.example/1')).not.toBe(base());
  });

  it('changes on the producer signature VALUE alone, key_id unchanged', () => {
    // A re-signature under the same key. The signature row must carry `.value`,
    // not just `.key_id`.
    expect(keyAfter((c) => { c.body.signature!.value = 'ZGlmZmVyZW50LXNpZ25hdHVyZQ=='; })).not.toBe(base());
  });

  it('changes on the producer signature KEY_ID alone, value unchanged', () => {
    expect(keyAfter((c) => { c.body.signature!.key_id = 'did:web:producer.example#key-9'; })).not.toBe(base());
  });

  it('changes when the producer signature is removed entirely', () => {
    expect(keyAfter((c) => { delete c.body.signature; })).not.toBe(base());
  });

  it('changes on the registry-state status alone', () => {
    expect(keyAfter((c) => { c.registry_state.status = 'retracted'; })).not.toBe(base());
  });

  for (const [label, mutate] of [
    ['registry receipt', (c: typeof ATTESTED) => { c.registry_receipt!.signature.value = 'cmVpc3N1ZWQ='; }],
    ['lineage-head receipt', (c: typeof ATTESTED) => { c.lineage_head_receipt!.signature.value = 'cmVpc3N1ZWQ='; }],
    ['log checkpoint', (c: typeof ATTESTED) => { c.log_inclusion!.log_checkpoint.signature.value = 'cmVpc3N1ZWQ='; }],
  ] as const) {
    it(`changes when the ${label} is re-signed under the SAME key id`, () => {
      // The `.value`-not-`.signature` trap, one row at a time. Reaching for
      // `receipt.signature.signature` yields `undefined` on all three of these
      // and the key never moves.
      expect(keyAfter(mutate)).not.toBe(base());
    });
  }

  for (const [label, drop] of [
    ['registry_receipt', (c: typeof ATTESTED) => { delete (c as { registry_receipt?: unknown }).registry_receipt; }],
    ['lineage_head_receipt', (c: typeof ATTESTED) => { delete (c as { lineage_head_receipt?: unknown }).lineage_head_receipt; }],
    ['log_inclusion', (c: typeof ATTESTED) => { delete (c as { log_inclusion?: unknown }).log_inclusion; }],
  ] as const) {
    it(`changes when ${label} goes from present to absent`, () => {
      expect(keyAfter(drop)).not.toBe(base());
    });
  }

  it('changes on a body field that is neither an id nor a signature', () => {
    // The row `content_hash` cannot stand in for: `verifyContentHash`
    // recomputes the digest from the whole body, so a response that mutates a
    // hashed field while restating the original hash must still re-verify.
    expect(keyAfter((c) => { c.body.title = 'not what the producer signed'; })).not.toBe(base());
  });

  it('distinguishes an ABSENT witness set from an EMPTY one', () => {
    // `lib/types.ts` documents `witness_signatures` as "Absent — never `[]`".
    // Today both yield the same verdict, so this is hygiene — but the gate is
    // one line from changing, and a collision here would skip a re-verify.
    const absent = keyAfter((c) => { delete c.log_inclusion!.witness_signatures; });
    const empty = keyAfter((c) => { c.log_inclusion!.witness_signatures = []; });
    expect(absent).not.toBe(empty);
    expect(absent).not.toBe(base());
    expect(empty).not.toBe(base());
  });

  it('changes when one cosignature is added, and is order-insensitive', () => {
    const added = keyAfter((c) => {
      const cosigs = c.log_inclusion!.witness_signatures!;
      cosigs.push({ ...cosigs[0], witness_id: 'did:web:witness-gamma.example', signature: { ...cosigs[0].signature, value: 'dGhpcmQ=' } });
    });
    expect(added).not.toBe(base());
    expect(keyAfter((c) => { c.log_inclusion!.witness_signatures!.reverse(); })).toBe(base());
  });

  // ── Fields that are NOT the signature, on each envelope ──────────────
  //
  // These are why the three envelopes are keyed as objects instead of by
  // `signature.key_id`/`.value`. Every one of them is dereferenced by the
  // effect or its callees and rendered on a trust surface, and every one of
  // them survived the signature-only key.
  for (const [label, mutate] of [
    ['the DID that selects the receipt-verifying key document',
      (c: typeof ATTESTED) => { c.lineage_head_receipt!.registry_did = 'did:web:other-registry.example'; }],
    ['the head status the lineage-head receipt binds',
      (c: typeof ATTESTED) => { c.lineage_head_receipt!.head_status = 'retracted'; }],
    ['the registry receipt content_hash',
      (c: typeof ATTESTED) => { c.registry_receipt!.content_hash = 'sha256:0000'; }],
    ['the inclusion path',
      (c: typeof ATTESTED) => { c.log_inclusion!.inclusion_path[0] = 'sha256:ffff'; }],
    ['the leaf index',
      (c: typeof ATTESTED) => { c.log_inclusion!.leaf_index += 1; }],
    ['the tree size',
      (c: typeof ATTESTED) => { c.log_inclusion!.tree_size += 1; }],
    ['the log id',
      (c: typeof ATTESTED) => { c.log_inclusion!.log_id = 'log-other'; }],
  ] as const) {
    it(`changes on ${label}`, () => {
      expect(keyAfter(mutate)).not.toBe(base());
    });
  }

  it('changes when a cosignature keeps its value but swaps witness_id', () => {
    // `witness_id` selects the DID document the cosignature is checked against
    // and is what the quorum set is counted over. Keying only the signature
    // values would let a re-attributed cosignature keep a green quorum chip.
    expect(keyAfter((c) => {
      c.log_inclusion!.witness_signatures![0].witness_id = 'did:web:witness-impostor.example';
    })).not.toBe(base());
  });

  it('changes when a cosignature keeps its witness_id but is re-cosigned', () => {
    expect(keyAfter((c) => {
      c.log_inclusion!.witness_signatures![0].signature.value = 'cmUtY29zaWduZWQ=';
    })).not.toBe(base());
  });

  // `verifyWitnessQuorum` passes the WHOLE cosignature array into
  // `wasm.evaluateWitnessQuorum` and separately reads `signature.key_id` to
  // select the verification method — so an enumeration of two fields was
  // narrower than what the callee reads. Each of these decides whether a
  // cosignature verifies, and each left the key unmoved before the row was
  // widened to the whole object.
  for (const [label, mutate] of [
    ['the witness verification-method key id',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].signature.key_id = 'did:web:w#rotated'; }],
    ['the cosignature algorithm',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].signature.algorithm = 'ed25519-x'; }],
    ['the checkpoint the witness actually cosigned',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].witnessed_checkpoint.root_hash = 'sha256:ffff'; }],
    ['the tree size the witness cosigned over',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].witnessed_checkpoint.tree_size += 1; }],
    ['the witness observation time',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].witnessed_at = '2030-01-01T00:00:00.000Z'; }],
    ['the cosignature envelope version',
      (c: typeof ATTESTED) => { c.log_inclusion!.witness_signatures![0].cosignature_version = 'acdp-cosig/2' as 'acdp-cosig/1'; }],
  ] as const) {
    it(`changes on ${label}`, () => {
      expect(keyAfter(mutate)).not.toBe(base());
    });
  }

  it('does not reorder the caller’s cosignature array', () => {
    // `sort` is in-place and `witness_signatures` belongs to React Query's
    // cache, shared with every other consumer of this context. Computing a key
    // must not rewrite the data it is keying — and the quorum panel renders
    // cosignatures in array order.
    const ctx = clone(ATTESTED);
    const w = ctx.log_inclusion!.witness_signatures!;
    // Force an order the comparator would change.
    w.reverse();
    const before = w.map((c) => c.witness_id);

    verificationKey(ctx, ctx.body.ctx_id);

    expect(w.map((c) => c.witness_id)).toEqual(before);
  });

  it('is stable when a registry repeats an identical cosignature', () => {
    // The comparator's tie branch, exercised in the only way that can fail:
    // two byte-identical cosignatures plus a third, shuffled. `dup(X) === dup(X)`
    // would be true of any deterministic function and pins nothing.
    const withDuplicate = (order: number[]) => keyAfter((c) => {
      const w = c.log_inclusion!.witness_signatures!;
      const [a, b] = [clone(w[0]), { ...clone(w[0]), witness_id: 'did:web:witness-zeta.example' }];
      const all = [a, clone(a), b];
      w.length = 0;
      for (const i of order) w.push(all[i]);
    });
    expect(withDuplicate([0, 1, 2])).toBe(withDuplicate([2, 1, 0]));
    expect(withDuplicate([0, 1, 2])).toBe(withDuplicate([1, 2, 0]));
  });

  /** Two cosignatures identical but for `witness_id` and `signature.value`. */
  const pair = (first: [string, string], second: [string, string]) =>
    keyAfter((c) => {
      const w = c.log_inclusion!.witness_signatures!;
      const template = w[0];
      w.length = 0;
      for (const [id, value] of [first, second]) {
        w.push({ ...clone(template), witness_id: id, signature: { ...clone(template.signature), value } });
      }
    });

  it('orders cosignatures deterministically, whatever order they arrive in', () => {
    // `Array#sort` with no comparator coerces each element with `String()`,
    // which for a cosignature object is `"[object Object]"` — every pair
    // compares equal, the sort degenerates to a no-op, and input order lands
    // in the key.
    const A: [string, string] = ['did:web:a', 'b,c'];
    const B: [string, string] = ['did:web:a,b', 'c'];
    expect(pair(A, B)).toBe(pair(B, A));
  });

  it('orders on the WHOLE cosignature, not just witness_id', () => {
    // One witness can appear twice — a re-cosign the registry has not yet
    // deduplicated. A comparator keyed on `witness_id` ties on those, and a
    // stable sort then preserves whatever order the response happened to use.
    const A: [string, string] = ['did:web:witness-alpha.example', 'YWFh'];
    const B: [string, string] = ['did:web:witness-alpha.example', 'YmJi'];
    expect(pair(A, B)).toBe(pair(B, A));
  });

  it('orders on more than signature.value alone', () => {
    // The mirror: two witnesses sharing a signature value. Contrived, but it
    // is the other half of "the WHOLE cosignature" and the only thing standing
    // between the comparator and a one-field narrowing.
    const A: [string, string] = ['did:web:witness-alpha.example', 'c2FtZQ=='];
    const B: [string, string] = ['did:web:witness-beta.example', 'c2FtZQ=='];
    expect(pair(A, B)).toBe(pair(B, A));
  });

  it('does not order on a bare concatenation of the two fields', () => {
    // `witness_id + value` with no delimiter is the join divergence 7 forbids
    // for the key itself, and it ties here for the same reason:
    // ('did:web:a','bc') and ('did:web:ab','c') concatenate identically. The
    // comma-bearing fixture above cannot catch this one.
    const A: [string, string] = ['did:web:a', 'bc'];
    const B: [string, string] = ['did:web:ab', 'c'];
    expect(pair(A, B)).toBe(pair(B, A));
  });

  // ── The encoding itself ──────────────────────────────────────────────
  it('cannot be forged by registry-controlled strings', () => {
    // The encoding is a single `JSON.stringify` of a structured array, so row
    // boundaries are quotes and commas the values cannot contain unescaped.
    // A delimited key would fail this: the earlier draft joined parts with
    // U+001F and wrote `<absent>` for a missing receipt, and BOTH are strings
    // a registry can simply send. Here a context whose fields are made of the
    // old delimiters and sentinels must still not collide with anything.
    const hostile = clone(ATTESTED);
    const evil = `<absent>${String.fromCharCode(0x1f)}<empty>",null,"`;
    hostile.body.title = evil;
    hostile.body.ctx_id = `${ATTESTED.body.ctx_id}${evil}`;
    hostile.lineage_head_receipt!.registry_did = evil;

    const hostileKey = verificationKey(hostile, ATTESTED.body.ctx_id);
    expect(hostileKey).not.toBe(base());
    // And it is still a single well-formed JSON document, not a torn one.
    expect(() => JSON.parse(hostileKey)).not.toThrow();
    expect(JSON.parse(hostileKey)).toHaveLength(8);
  });

  it('gives a receipt-bearing and a receipt-less context different keys', () => {
    // The specific collision a sentinel makes reachable: a context with no
    // receipts whose neighbouring fields spell the absent-marker, against one
    // that genuinely carries them.
    const stripped = keyAfter((c) => {
      delete (c as { registry_receipt?: unknown }).registry_receipt;
      delete (c as { lineage_head_receipt?: unknown }).lineage_head_receipt;
      c.body.title = '<absent>';
    });
    expect(stripped).not.toBe(base());
  });

  it('assigns every fixture context a distinct key', () => {
    const keys = MOCK_CONTEXTS.map((c) => verificationKey(c, c.body.ctx_id));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
