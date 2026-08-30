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
      // Pure type modules and the data-fetching React hooks (covered by
      // integration, not unit). use-debounced / use-mounted do have unit tests,
      // but the whole hooks dir stays excluded to keep the coverage config simple.
      exclude: ['lib/types.ts', 'lib/colors.ts', 'lib/hooks/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
