import fs from 'fs';
import path from 'path';
import { resolveWithin } from './safe-path';
import { resolveRepoRoot } from './repo-root';

export interface Route {
  id: string;
  name: string;
  description: string;
  category?: string;
  stages?: string[];
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
  };
}

function getAmberRoutesPath(): string {
  const repoRoot = resolveRepoRoot();
  const routesPath = path.join(repoRoot, 'routes');

  // Debug logging for E2E tests
  if (process.env.AMBER_REPO_ROOT) {
    console.log('[route-reader] AMBER_REPO_ROOT:', process.env.AMBER_REPO_ROOT);
    console.log('[route-reader] Resolved repo root:', repoRoot);
    console.log('[route-reader] Routes path:', routesPath);
    console.log('[route-reader] Routes dir exists:', fs.existsSync(routesPath));
  }

  return routesPath;
}

export function listRoutes(): Route[] {
  const routesDir = getAmberRoutesPath();

  if (!fs.existsSync(routesDir)) {
    return [];
  }

  const files = fs.readdirSync(routesDir);
  const routeFiles = files.filter(f => f.endsWith('.route.json'));

  return routeFiles
    .map(file => {
      try {
        const filePath = path.join(routesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const route = JSON.parse(content);

        return {
          id: route.id || file.replace('.route.json', ''),
          name: route.name || route.id || 'Unnamed Route',
          description: route.description || 'No description available',
          category: route.category || 'uncategorized',
          stages: route.stages || [],
          metadata: route.metadata || {},
        };
      } catch (error) {
        console.error(`Failed to read route ${file}:`, error);
        return null;
      }
    })
    .filter((r): r is Route => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getRouteById(id: string): Route | null {
  const routesDir = getAmberRoutesPath();
  // `id` is an unconstrained tRPC input; embed it in the filename only after a
  // traversal guard so `../`-style ids cannot read files outside routes/.
  const routePath = resolveWithin(routesDir, `${id}.route.json`);
  if (!routePath || !fs.existsSync(routePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(routePath, 'utf8');
    const route = JSON.parse(content);

    return {
      id: route.id || id,
      name: route.name || 'Unnamed Route',
      description: route.description || 'No description available',
      category: route.category || 'uncategorized',
      stages: route.stages || [],
      metadata: route.metadata || {},
    };
  } catch (error) {
    console.error(`Failed to read route ${id}:`, error);
    return null;
  }
}

export function groupRoutesByCategory(routes: Route[]): Record<string, Route[]> {
  const grouped: Record<string, Route[]> = {};

  for (const route of routes) {
    const category = route.category || 'uncategorized';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(route);
  }

  return grouped;
}
