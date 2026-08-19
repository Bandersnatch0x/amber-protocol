import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './app-router';
import { handleSSE } from './routes/sse';
import { handleErrorReport } from './routes/errors';

export function createApp() {
  const app = express();

  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: () => ({}),
    }),
  );

  app.get('/api/sessions/:sessionId/events', handleSSE);

  // Client error reports are forwarded to external monitoring server-side,
  // where process.env (Sentry DSN / webhook URL) is reachable. The 64kb cap
  // bounds the payload before it hits the handler's own field limits.
  app.post('/api/errors', express.json({ limit: '64kb' }), handleErrorReport);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      cwd: process.cwd(),
      amberRepoRoot: process.env.AMBER_REPO_ROOT || null,
    });
  });

  return app;
}
