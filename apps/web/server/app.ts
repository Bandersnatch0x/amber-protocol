import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './app-router';
import { handleSSE } from './routes/sse';

export function createApp() {
  const app = express();

  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: () => ({}),
    })
  );

  app.get('/api/sessions/:sessionId/events', handleSSE);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
