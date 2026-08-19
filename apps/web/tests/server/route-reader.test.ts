import { describe, it, expect } from 'vitest';
import { listRoutes, getRouteById, groupRoutesByCategory } from '@server/lib/route-reader';

describe('route-reader', () => {
  describe('groupRoutesByCategory', () => {
    it('groups routes by category', () => {
      const routes = [
        { id: '1', name: 'A', description: '', category: 'delivery', stages: [] },
        { id: '2', name: 'B', description: '', category: 'delivery', stages: [] },
        { id: '3', name: 'C', description: '', category: 'governance', stages: [] },
      ];

      const grouped = groupRoutesByCategory(routes);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['delivery']).toHaveLength(2);
      expect(grouped['governance']).toHaveLength(1);
    });

    it('uses "uncategorized" for routes without a category', () => {
      const routes = [{ id: '1', name: 'A', description: '', stages: [] }];

      const grouped = groupRoutesByCategory(routes);

      expect(grouped['uncategorized']).toHaveLength(1);
    });

    it('returns an empty object for empty input', () => {
      const grouped = groupRoutesByCategory([]);
      expect(Object.keys(grouped)).toHaveLength(0);
    });
  });

  describe('listRoutes', () => {
    it('returns a non-empty array of routes from the real routes directory', () => {
      const routes = listRoutes();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0]).toHaveProperty('id');
      expect(routes[0]).toHaveProperty('name');
      expect(routes[0]).toHaveProperty('description');
      expect(routes[0]).toHaveProperty('stages');
    });

    it('returns routes sorted by name', () => {
      const routes = listRoutes();
      const names = routes.map((r) => r.name);

      expect(names).toEqual([...names].sort());
    });
  });

  describe('getRouteById', () => {
    it('returns a route for a valid id', () => {
      const routes = listRoutes();
      if (routes.length === 0) return;

      const first = routes[0];
      const route = getRouteById(first.id);

      expect(route).not.toBeNull();
      expect(route!.id).toBe(first.id);
    });

    it('returns null for a nonexistent id', () => {
      const route = getRouteById('nonexistent-route-id');
      expect(route).toBeNull();
    });

    it('rejects path traversal attempts', () => {
      const route = getRouteById('../../../etc/passwd');
      expect(route).toBeNull();
    });

    it('rejects relative path segments', () => {
      const route = getRouteById('../../package');
      expect(route).toBeNull();
    });
  });
});
