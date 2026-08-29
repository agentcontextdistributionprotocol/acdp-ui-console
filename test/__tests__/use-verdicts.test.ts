import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';
import { useContextVerdicts } from '@/lib/verify/use-verdicts';

const verifyContentHash = vi.fn();
const verifyProducerSignature = vi.fn();
const verifyRegistryReceipt = vi.fn();
const verifyLineageHeadReceipt = vi.fn();
const verifyTransparencyLog = vi.fn();
const verifyWitnessQuorum = vi.fn();

vi.mock('@/lib/verify/verify', () => ({
  verifyContentHash: (...args: unknown[]) => verifyContentHash(...args),
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
    verifyProducerSignature.mockResolvedValue(OK);
    const ctx = MOCK_CONTEXTS[0];

    const { result } = renderHook(() => useContextVerdicts(ctx, undefined));
    expect(result.current.ready).toBe(false);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeUndefined();
    expect(result.current.contentHash).toEqual(OK);
  });

  it('a wasm init failure surfaces as `error`, not a permanently-pending state', async () => {
    verifyContentHash.mockRejectedValue(new Error('acdp-wasm is browser-only and cannot run during SSR'));
    const ctx = MOCK_CONTEXTS[0];

    const { result } = renderHook(() => useContextVerdicts(ctx, undefined));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.error).toBe('acdp-wasm is browser-only and cannot run during SSR');
    // The whole point of UI-4: `ready` must flip to true on failure too, so a
    // consumer never renders "verifying…" forever with no indication anything
    // went wrong.
    expect(result.current.contentHash).toBeUndefined();
  });

  it('re-runs when the ctx_id/content_hash key changes', async () => {
    verifyContentHash.mockResolvedValue(OK);
    verifyProducerSignature.mockResolvedValue(OK);
    const { result, rerender } = renderHook(({ ctx }) => useContextVerdicts(ctx, undefined), {
      initialProps: { ctx: MOCK_CONTEXTS[0] },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(verifyContentHash).toHaveBeenCalledTimes(1);

    rerender({ ctx: MOCK_CONTEXTS[1] });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(verifyContentHash).toHaveBeenCalledTimes(2);
  });
});
