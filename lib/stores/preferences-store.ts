'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProxyService } from '@/lib/types';

export interface ServiceUrls {
  playground: string;
  'control-plane': string;
  'registry-a': string;
  'registry-b': string;
}

interface PreferencesState {
  demoMode: boolean;
  serviceUrls: ServiceUrls;
  controlPlaneApiKey: string;
  jaegerUrl: string;
  setDemoMode(value: boolean): void;
  setServiceUrl(service: ProxyService, url: string): void;
  setControlPlaneApiKey(key: string): void;
  setJaegerUrl(url: string): void;
}

const defaultServiceUrls: ServiceUrls = {
  playground: 'http://localhost:8000',
  'control-plane': 'http://localhost:3001',
  'registry-a': 'http://localhost:8100',
  'registry-b': 'http://localhost:8200',
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      demoMode: process.env.NEXT_PUBLIC_ACDP_UI_DEMO_MODE !== 'false',
      serviceUrls: defaultServiceUrls,
      controlPlaneApiKey: '',
      jaegerUrl: process.env.NEXT_PUBLIC_JAEGER_URL ?? 'http://localhost:16686',
      setDemoMode: (demoMode) => set({ demoMode }),
      setServiceUrl: (service, url) =>
        set((state) => ({ serviceUrls: { ...state.serviceUrls, [service]: url } })),
      setControlPlaneApiKey: (controlPlaneApiKey) => set({ controlPlaneApiKey }),
      setJaegerUrl: (jaegerUrl) => set({ jaegerUrl }),
    }),
    {
      name: 'acdp-ui-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
