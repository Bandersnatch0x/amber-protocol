import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    // Playwright owns tests/e2e (*.spec.ts); vitest must not collect them.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    // issues/0136: without an explicit bound vitest's 5000ms default applies,
    // and the knowledge suites (tests/server/knowledge-*, suggestions-*) read
    // the repository corpus and build the knowledge graph, so individual tests
    // exceed 5s on a loaded machine. They are slow, not broken: with a raised
    // bound the whole web suite is green (85 files / 799 tests). A false red is
    // worse than a longer wait — it hides real failures. The bound stays finite
    // so a genuinely hung test still fails.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
});
