import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        'lib/types.ts',
        'lib/colors.ts',
        // React Query wrappers — covered by integration, not unit.
        'lib/hooks/use-dashboard.ts',
        'lib/hooks/use-registries.ts',
        'lib/hooks/use-runs.ts',
        'lib/hooks/use-scenarios.ts',
        'lib/hooks/use-security.ts',
        'lib/hooks/use-trust.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
