import { router } from './trpc';
import { sessionRouter } from './routers/session';
import { routeRouter } from './routers/route';

export const appRouter = router({
  session: sessionRouter,
  route: routeRouter,
});

export type AppRouter = typeof appRouter;
