import { router } from './trpc';
import { sessionRouter } from './routers/session';
import { routeRouter } from './routers/route';
import { sessionControlRouter } from './routers/session-control';
import { gateRouter } from './routers/gate';
import { transcriptRouter } from './routers/transcript';

export const appRouter = router({
  session: sessionRouter,
  route: routeRouter,
  sessionControl: sessionControlRouter,
  gate: gateRouter,
  transcript: transcriptRouter,
});

export type AppRouter = typeof appRouter;
