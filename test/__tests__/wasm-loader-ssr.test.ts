// @vitest-environment node
import { describe, expect, it } from 'vitest';

// ══════════════════════════════════════════════════════════════════════
// #101 (ui-4 Phase 21, intact): the SSR guard at `lib/verify/wasm.ts:17-19`
// — a plain `typeof window === 'undefined'` check — is the one branch a
// jsdom test environment can never reach, since jsdom always defines
// `window`. `// @vitest-environment node` is file-scoped, which is why this
// lives apart from `wasm-loader.test.ts`'s browser-side cases.
//
// No `vi.mock` needed: the guard returns before the dynamic import of
// `@agentcontextdistributionprotocol/acdp-wasm` is ever reached, so the real
// package (unmocked) would only be touched if this guard regressed.
// ══════════════════════════════════════════════════════════════════════

describe('getAcdpWasm — SSR guard', () => {
  it('rejects with the SSR message rather than attempting to load the wasm module', async () => {
    expect(typeof window).toBe('undefined');
    const { getAcdpWasm } = await import('@/lib/verify/wasm');

    await expect(getAcdpWasm()).rejects.toThrow('acdp-wasm is browser-only and cannot run during SSR');
  });

  it('the SSR rejection is not memoized: it is safe to call again from a later request', async () => {
    const { getAcdpWasm } = await import('@/lib/verify/wasm');

    await expect(getAcdpWasm()).rejects.toThrow('acdp-wasm is browser-only and cannot run during SSR');
    await expect(getAcdpWasm()).rejects.toThrow('acdp-wasm is browser-only and cannot run during SSR');
  });
});
