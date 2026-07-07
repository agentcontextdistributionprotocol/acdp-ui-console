// ══════════════════════════════════════════════════════════════════════
// Lazy, browser-only loader for the ACDP WebAssembly verifier.
//
// `@agentcontextdistributionprotocol/acdp-wasm` is a `wasm-pack --target web`
// ESM module: it must be `await init()`-ed once before any export is called,
// and it resolves its `.wasm` asset via `new URL('…_bg.wasm', import.meta.url)`
// which webpack 5 rewrites at build time. We `import()` it dynamically so the
// module (and its wasm asset) is NEVER pulled into the server/SSR bundle — it
// only loads in the browser, on first use.
// ══════════════════════════════════════════════════════════════════════
import type * as AcdpWasm from '@agentcontextdistributionprotocol/acdp-wasm';

let wasmPromise: Promise<typeof AcdpWasm> | null = null;

/** Resolve the initialized wasm module (memoized). Browser-only. */
export function getAcdpWasm(): Promise<typeof AcdpWasm> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('acdp-wasm is browser-only and cannot run during SSR'));
  }
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const mod = await import('@agentcontextdistributionprotocol/acdp-wasm');
      await mod.default(); // wasm-bindgen init()
      return mod;
    })();
    // Let a failed init retry on the next call rather than caching the rejection.
    wasmPromise.catch(() => {
      wasmPromise = null;
    });
  }
  return wasmPromise;
}
