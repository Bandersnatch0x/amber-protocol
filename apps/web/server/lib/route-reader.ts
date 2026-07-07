import fs from 'fs';
import { resolveRepoPath, readJsonSafe, readJsonDir } from './artifact-store';

export interface RouteStage {
  name: string;
  displayName: string;
  type?: string;
  target?: string;
  gateAfter?: string;
  note?: string;
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

export function listRoutes(): Route[] {
  const routesDir = resolveRepoPath('routes');

  if (!routesDir) {
    return [];
  }

  return readJsonDir(routesDir, { suffix: '.route.json' })
    .map(({ name, value }) => mapRoute(value as Record<string, unknown>, name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getRouteById(id: string): Route | null {
  const routePath = resolveRepoPath('routes', `${id}.route.json`);
  if (!routePath || !fs.existsSync(routePath)) {
    return null;
  }

  const { value, error } = readJsonSafe(routePath);
  if (error) {
    console.error(`Failed to read route ${id}:`, error);
    return null;
  }

  return mapRoute(value as Record<string, unknown>, id);
}

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
