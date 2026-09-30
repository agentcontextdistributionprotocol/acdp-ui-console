import '@testing-library/jest-dom/vitest';

// #101 (ui-4 Phase 23, numbers corrected): Node 26 ships its own native
// `globalThis.localStorage`/`sessionStorage` (the Web Storage API). Vitest's
// jsdom-environment global population only overrides an already-existing
// global with jsdom's own implementation when the key is on its own explicit
// allow-list — `localStorage`/`sessionStorage` are not on it — so on Node 26
// both names resolve to Node's own storage instead of jsdom's, and Node's
// throws on any member access (`Cannot read properties of undefined`) unless
// `NODE_OPTIONS` carries `--localstorage-file`, which nothing in this repo's
// dev/CI setup sets. jsdom's real, working `Storage` instances are still one
// level down: `jsdom`'s `Window.js` assigns them directly to the window's own
// `_localStorage`/`_sessionStorage` properties, which vitest's global
// population copies across regardless of Node version (nothing Node defines
// shadows those names) — so redefine the public getters to point there
// instead. A no-op on Node 24, where nothing shadowed jsdom's own getter to
// begin with; guarded so a non-jsdom (`// @vitest-environment node`) test
// file, which has neither underscored property, is left untouched.
for (const key of ['localStorage', 'sessionStorage'] as const) {
  const jsdomStorage = (globalThis as unknown as Record<string, unknown>)[`_${key}`];
  if (jsdomStorage) {
    Object.defineProperty(globalThis, key, {
      value: jsdomStorage,
      configurable: true,
      writable: true,
    });
  }
}
