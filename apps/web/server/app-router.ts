import { router } from './trpc';
import { sessionRouter } from './routers/session';
import { routeRouter } from './routers/route';
import { sessionControlRouter } from './routers/session-control';
import { gateRouter } from './routers/gate';

export const appRouter = router({
  session: sessionRouter,
  route: routeRouter,
  sessionControl: sessionControlRouter,
  gate: gateRouter,
});

export type AppRouter = typeof appRouter;
