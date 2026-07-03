import fs from 'fs';
import path from 'path';
import { resolveWithin } from './safe-path';
import { resolveRepoRoot } from './repo-root';

export interface RouteStage {
  name: string;
  displayName: string;
  type?: string;
  target?: string;
  gateAfter?: string;
}

export interface RouteGate {
  id: string;
  type: string;
  description: string;
}

export interface Route {
  id: string;
  name: string;
  description: string;
  category?: string;
  stages?: RouteStage[];
  gates?: RouteGate[];
  trigger?: {
    goalPattern?: string;
    complexity?: string;
  };
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
  };
}

function getAmberRoutesPath(): string {
  const repoRoot = resolveRepoRoot();
  const routesPath = path.join(repoRoot, 'routes');
  return routesPath;
}

// Map a raw `.route.json` (the on-disk amber schema) to the UI's Route shape.
// The disk schema and the viewer were written against different field names;
// this is the single place that reconciles them:
//   routeId      -> id        (UI used route.id, which never existed on disk)
//   displayName  -> name      (UI used route.name; disk has displayName)
//   version      -> metadata.version (disk keeps version at the root)
//   trigger.complexity -> category   (disk has no category; complexity is the
//                                      natural grouping dimension)
// stages/gates are passed through as the structured objects they already are.
function mapRoute(raw: Record<string, unknown>, fallbackId: string): Route {
  const trigger = (raw.trigger as Route['trigger']) || undefined;
  const rawMetadata = (raw.metadata as Route['metadata']) || {};
  const routeId = (raw.routeId as string) || (raw.id as string) || fallbackId;

  return {
    id: routeId,
    name: (raw.displayName as string) || (raw.name as string) || routeId || 'Unnamed Route',
    description: (raw.description as string) || 'No description available',
    category: trigger?.complexity || (raw.category as string) || 'uncategorized',
    stages: Array.isArray(raw.stages) ? (raw.stages as RouteStage[]) : [],
    gates: Array.isArray(raw.gates) ? (raw.gates as RouteGate[]) : [],
    trigger,
    metadata: {
      ...rawMetadata,
      version: rawMetadata.version || (raw.version as string),
    },
  };
}

export function listRoutes(): Route[] {
  const routesDir = getAmberRoutesPath();

  if (!fs.existsSync(routesDir)) {
    return [];
  }

  const files = fs.readdirSync(routesDir);
  const routeFiles = files.filter(f => f.endsWith('.route.json'));

  const routes = routeFiles
    .map(file => {
      try {
        const filePath = path.join(routesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const route = JSON.parse(content);

        return mapRoute(route, file.replace('.route.json', ''));
      } catch (error) {
        console.error(`Failed to read route ${file}:`, error);
        return null;
      }
    })
    .filter((r): r is Route => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return routes;
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

    return mapRoute(route, id);
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
