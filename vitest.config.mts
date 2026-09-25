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
        // `use-trust.ts` is deliberately NOT excluded: the blanket rationale
        // above ("React Query wrappers — covered by integration, not unit") is
        // no longer true of it. It holds the totals reduce, the fail-closed
        // revocation aggregation and the violation sort — real logic, unit
        // tested, and exactly the code whose unmeasured state let a
        // revoked-only run sort to the bottom of the trust page.
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
