'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface PreferencesState {
  demoMode: boolean;
  jaegerUrl: string;
  setDemoMode(value: boolean): void;
  setJaegerUrl(url: string): void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      demoMode: process.env.NEXT_PUBLIC_ACDP_UI_DEMO_MODE !== 'false',
      jaegerUrl: process.env.NEXT_PUBLIC_JAEGER_URL ?? 'http://localhost:16686',
      setDemoMode: (demoMode) => set({ demoMode }),
      setJaegerUrl: (jaegerUrl) => set({ jaegerUrl }),
    }),
    {
      name: 'acdp-ui-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
