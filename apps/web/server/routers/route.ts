import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { listRoutes, getRouteById, groupRoutesByCategory } from '../lib/route-reader';

export const routeRouter = router({
  list: publicProcedure.query(() => {
    return listRoutes();
  }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const route = getRouteById(input.id);
      if (!route) {
        throw new Error('Route not found');
      }
      return route;
    }),

  grouped: publicProcedure.query(() => {
    const routes = listRoutes();
    return groupRoutesByCategory(routes);
  }),
});
