import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeRouter } from '@server/routers/route';
import * as routeReader from '@server/lib/route-reader';

vi.mock('@server/lib/route-reader', () => ({
  listRoutes: vi.fn(),
  getRouteById: vi.fn(),
  groupRoutesByCategory: vi.fn(),
}));

const listRoutes = routeReader.listRoutes as ReturnType<typeof vi.fn>;
const getRouteById = routeReader.getRouteById as ReturnType<typeof vi.fn>;
const groupRoutesByCategory = routeReader.groupRoutesByCategory as ReturnType<typeof vi.fn>;

const caller = routeRouter.createCaller({});

describe('routeRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('passes through the reader result', async () => {
      const routes = [{ id: 'feature-standard' }];
      listRoutes.mockReturnValue(routes);

      const result = await caller.list();

      expect(result).toBe(routes);
      expect(listRoutes).toHaveBeenCalledOnce();
    });
  });

  describe('byId', () => {
    it('returns the route when found', async () => {
      const route = { id: 'feature-standard', name: 'Feature Standard' };
      getRouteById.mockReturnValue(route);

      const result = await caller.byId({ id: 'feature-standard' });

      expect(result).toBe(route);
      expect(getRouteById).toHaveBeenCalledWith('feature-standard');
    });

    it('throws Route not found when the reader returns null', async () => {
      getRouteById.mockReturnValue(null);

      await expect(caller.byId({ id: 'missing' })).rejects.toThrow('Route not found');
    });
  });

  describe('grouped', () => {
    it('groups the routes returned by listRoutes', async () => {
      const routes = [{ id: 'feature-standard' }];
      const grouped = { feature: routes };
      listRoutes.mockReturnValue(routes);
      groupRoutesByCategory.mockReturnValue(grouped);

      const result = await caller.grouped();

      expect(groupRoutesByCategory).toHaveBeenCalledWith(routes);
      expect(result).toBe(grouped);
    });
  });
});
