import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

const STORAGE_KEY = 'acdp-ui-preferences';

beforeEach(() => {
  // Reset to a known baseline between tests (the store is a singleton and
  // every `set` writes through the persist middleware to localStorage).
  localStorage.clear();
  usePreferencesStore.setState({
    demoMode: true,
    jaegerUrl: 'http://localhost:16686',
  });
});

describe('preferences store', () => {
  it('toggles demo mode', () => {
    usePreferencesStore.getState().setDemoMode(false);
    expect(usePreferencesStore.getState().demoMode).toBe(false);
  });

  it('stores the jaeger url', () => {
    usePreferencesStore.getState().setJaegerUrl('https://jaeger.prod');
    expect(usePreferencesStore.getState().jaegerUrl).toBe('https://jaeger.prod');
  });
});

describe('preferences store — persistence', () => {
  it('writes state through to localStorage under the persist key (no functions serialized)', () => {
    usePreferencesStore.getState().setDemoMode(false);
    usePreferencesStore.getState().setJaegerUrl('https://jaeger.prod');

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.demoMode).toBe(false);
    expect(persisted.jaegerUrl).toBe('https://jaeger.prod');
    // JSON serialization drops the action functions — only data is persisted.
    expect(persisted.setDemoMode).toBeUndefined();
  });

  it('rehydrates state from a previously persisted payload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 0,
        state: {
          demoMode: false,
          jaegerUrl: 'https://jaeger.seeded',
        },
      }),
    );

    await usePreferencesStore.persist.rehydrate();

    const state = usePreferencesStore.getState();
    expect(state.demoMode).toBe(false);
    expect(state.jaegerUrl).toBe('https://jaeger.seeded');
  });

  it('regression lock: persists only demoMode/jaegerUrl — never a credential (API key, password, token, etc.)', () => {
    usePreferencesStore.getState().setDemoMode(false);
    usePreferencesStore.getState().setJaegerUrl('https://jaeger.prod');

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state as Record<string, unknown>;

    expect(Object.keys(persisted).sort()).toEqual(['demoMode', 'jaegerUrl']);

    // Belt-and-suspenders: no key or value anywhere in the persisted payload
    // should look like a secret, however this store evolves.
    const serialized = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of ['password', 'passphrase', 'apikey', 'api_key', 'token', 'secret', 'bearer']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
