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
      // `components/**` and the page files were outside this glob, so every
      // component test in `test/__tests__` ran and reported nothing. The number
      // at the bottom of CI described `lib/` and `app/api/` only, while reading
      // as the coverage of the repo — and the surfaces it omitted are the ones
      // that render verdicts to an operator. Several defects this plan fixed
      // (a hardcoded "all healthy" tile, `Pre-compromise 0` over a payload
      // saying 2, a chip prop that did nothing) lived in exactly the unmeasured
      // half.
      //
      // Widening drops the headline figure from 91.18% to 64.51% in one step.
      // That drop is not a regression: the same lines were uncovered yesterday
      // and are now counted. Recorded here so the next reader does not go
      // looking for what "broke" — and so nobody narrows the glob back to make
      // the number look better, which is what produced the misleading one.
      include: ['lib/**/*.ts', 'app/api/**/*.ts', 'components/**/*.tsx', 'app/**/*.tsx'],
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
