import { afterEach, describe, expect, it, vi } from 'vitest';

// ══════════════════════════════════════════════════════════════════════
// #101 (ui-4 Phase 21, intact): `lib/verify/wasm.ts` left 0% coverage. Its
// only importers under `test/` (`verify.test.ts`, `wasm-fixtures.test.ts`)
// `vi.mock` it away entirely, so the one behaviour with teeth — a failed
// `init()` does NOT cache its rejection, so the next call retries rather
// than handing back a dead promise forever (`wasm.ts:26-29`) — was never
// exercised. This file is the browser-side half; the SSR guard lives in the
// sibling `wasm-loader-ssr.test.ts` because `// @vitest-environment` is
// file-scoped.
//
// The dynamic `import('@agentcontextdistributionprotocol/acdp-wasm')` inside
// `getAcdpWasm()` is intercepted by `vi.mock` below; the module body itself
// never runs, so the real 6MB `.wasm` asset is never touched here (that is
// what `wasm-fixtures.test.ts` is for). `vi.resetModules()` + a dynamic
// `import('@/lib/verify/wasm')` per case gives each test a fresh
// `wasmPromise` closure, since that memo lives at module scope.
// ══════════════════════════════════════════════════════════════════════

const wasmInit = vi.fn();

vi.mock('@agentcontextdistributionprotocol/acdp-wasm', () => ({
  default: (...args: unknown[]) => wasmInit(...args),
}));

afterEach(() => {
  wasmInit.mockReset();
});

async function freshLoader() {
  vi.resetModules();
  return import('@/lib/verify/wasm');
}

describe('getAcdpWasm — browser-side loader behaviour', () => {
  it('memoizes: two calls resolve the same module object from one init() call', async () => {
    wasmInit.mockResolvedValue(undefined);
    const { getAcdpWasm } = await freshLoader();

    const [a, b] = await Promise.all([getAcdpWasm(), getAcdpWasm()]);

    expect(a).toBe(b);
    expect(wasmInit).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejection: a failed init lets the next call retry and succeed', async () => {
    wasmInit.mockRejectedValueOnce(new Error('wasm init failed')).mockResolvedValueOnce(undefined);
    const { getAcdpWasm } = await freshLoader();

    await expect(getAcdpWasm()).rejects.toThrow('wasm init failed');
    expect(wasmInit).toHaveBeenCalledTimes(1);

    // The rejection's `.catch()` clears the memo asynchronously; the second
    // call below only observes that if it happens after that microtask runs,
    // which it does simply by being a second `await`ed call in sequence.
    const mod = await getAcdpWasm();
    expect(mod).toBeDefined();
    expect(wasmInit).toHaveBeenCalledTimes(2);
  });

  it('a non-Error rejection is not cached either, and still lets the next call succeed', async () => {
    // wasm-bindgen and bundler-level failures are not guaranteed to be `Error`
    // instances (a string, or a plain `{ message }` from some loaders) — the
    // retry-on-rejection path must not assume the rejection's shape.
    wasmInit.mockRejectedValueOnce('panic: unreachable').mockResolvedValueOnce(undefined);
    const { getAcdpWasm } = await freshLoader();

    await expect(getAcdpWasm()).rejects.toBe('panic: unreachable');
    expect(wasmInit).toHaveBeenCalledTimes(1);

    await expect(getAcdpWasm()).resolves.toBeDefined();
    expect(wasmInit).toHaveBeenCalledTimes(2);
  });

  it('two rejections in a row both retry rather than getting stuck on the first', async () => {
    wasmInit
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce(undefined);
    const { getAcdpWasm } = await freshLoader();

    await expect(getAcdpWasm()).rejects.toThrow('first failure');
    await expect(getAcdpWasm()).rejects.toThrow('second failure');
    await expect(getAcdpWasm()).resolves.toBeDefined();
    expect(wasmInit).toHaveBeenCalledTimes(3);
  });
});
