import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';
import { parsePortEnv, resolveApiPort, SERVER_PORT_CANDIDATES } from './server/lib/api-port';

export default defineConfig(async (): Promise<UserConfig> => {
  const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
  // API proxy target. Under `npm run dev`, server/dev-bootstrap.ts resolves
  // the port exactly once before spawning anything and injects it as
  // API_PORT/PORT, so this config consumes that value verbatim and never
  // probes in the shared dev flow. (The old assumption that "both sides
  // probe the same list and converge" is false under concurrent startup:
  // once the API bound e.g. 4101, this probe saw EADDRINUSE and targeted
  // 4102, drifting the /api proxy away from the real server.) The probe
  // below only remains as a fallback for a standalone `vite` run; explicit
  // API_PORT/PORT are the escape hatch and always win without probing.
  const apiPort = await resolveApiPort({
    explicit: parsePortEnv(process.env.API_PORT) ?? parsePortEnv(process.env.PORT),
    candidates: SERVER_PORT_CANDIDATES,
    host: '127.0.0.1',
  });

  return {
    plugins: [TanStackRouterVite(), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@server': path.resolve(__dirname, './server'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: devPort,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'esnext',
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'vendor';
            }
            if (id.includes('node_modules/@tanstack/react-router')) {
              return 'router';
            }
            if (id.includes('node_modules/@tanstack/react-query')) {
              return 'query';
            }
            if (id.includes('node_modules/@trpc/')) {
              return 'trpc';
            }
          },
        },
      },
    },
  };
});
