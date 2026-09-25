import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';
import { useContextVerdicts } from '@/lib/verify/use-verdicts';

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
