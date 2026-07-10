import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

const STORAGE_KEY = 'acdp-ui-preferences';

beforeEach(() => {
  // Reset to a known baseline between tests (the store is a singleton and
  // every `set` writes through the persist middleware to localStorage).
  localStorage.clear();
  usePreferencesStore.setState({
    demoMode: true,
    serviceUrls: {
      playground: 'http://localhost:8000',
      'control-plane': 'http://localhost:3001',
      'registry-a': 'http://localhost:8100',
      'registry-b': 'http://localhost:8200',
    },
    controlPlaneApiKey: '',
    jaegerUrl: 'http://localhost:16686',
  });
});

describe('preferences store', () => {
  it('toggles demo mode', () => {
    usePreferencesStore.getState().setDemoMode(false);
    expect(usePreferencesStore.getState().demoMode).toBe(false);
  });

  it('updates a single service url without disturbing the others', () => {
    usePreferencesStore.getState().setServiceUrl('registry-a', 'https://reg-a.prod');
    const urls = usePreferencesStore.getState().serviceUrls;
    expect(urls['registry-a']).toBe('https://reg-a.prod');
    expect(urls['registry-b']).toBe('http://localhost:8200');
    expect(urls.playground).toBe('http://localhost:8000');
  });

  it('stores the control-plane api key and jaeger url', () => {
    usePreferencesStore.getState().setControlPlaneApiKey('tok-123');
    usePreferencesStore.getState().setJaegerUrl('https://jaeger.prod');
    expect(usePreferencesStore.getState().controlPlaneApiKey).toBe('tok-123');
    expect(usePreferencesStore.getState().jaegerUrl).toBe('https://jaeger.prod');
  });
});

describe('preferences store — persistence', () => {
  it('writes state through to localStorage under the persist key (no functions serialized)', () => {
    usePreferencesStore.getState().setDemoMode(false);
    usePreferencesStore.getState().setServiceUrl('registry-a', 'https://reg-a.prod');

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.demoMode).toBe(false);
    expect(persisted.serviceUrls['registry-a']).toBe('https://reg-a.prod');
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
          serviceUrls: {
            playground: 'https://pg.seeded',
            'control-plane': 'https://cp.seeded',
            'registry-a': 'https://reg-a.seeded',
            'registry-b': 'https://reg-b.seeded',
          },
          controlPlaneApiKey: 'seeded-key',
          jaegerUrl: 'https://jaeger.seeded',
        },
      }),
    );

    await usePreferencesStore.persist.rehydrate();

    const state = usePreferencesStore.getState();
    expect(state.demoMode).toBe(false);
    expect(state.serviceUrls.playground).toBe('https://pg.seeded');
    expect(state.controlPlaneApiKey).toBe('seeded-key');
    expect(state.jaegerUrl).toBe('https://jaeger.seeded');
  });
});
