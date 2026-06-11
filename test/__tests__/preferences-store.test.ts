import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

const initial = usePreferencesStore.getState();

beforeEach(() => {
  // Reset to a known baseline between tests (the store is a singleton).
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
  it('exposes the action functions', () => {
    expect(typeof initial.setDemoMode).toBe('function');
    expect(typeof initial.setServiceUrl).toBe('function');
    expect(typeof initial.setControlPlaneApiKey).toBe('function');
    expect(typeof initial.setJaegerUrl).toBe('function');
  });

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
