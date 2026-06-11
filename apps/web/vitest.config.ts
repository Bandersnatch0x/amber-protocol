import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@server': path.resolve(__dirname, './server'),
      '@lib': path.resolve(__dirname, './lib'),
      '@components': path.resolve(__dirname, './components'),
      '@types': path.resolve(__dirname, './types'),
    },
  },
});
