interface RouteLike {
  trigger?: {
    complexity?: string;
    goalPattern?: string;
  };
  metadata?: {
    version?: string;
    author?: string;
    tags?: readonly string[];
  };
  gates?: ReadonlyArray<{ id: string }>;
}

interface StageLike {
  name: string;
  type?: string;
  target?: string;
}

export interface RouteMetadataItem {
  labelKey: 'complexity' | 'version' | 'goalPattern' | 'gateCount' | 'author' | 'tags';
  value: string;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildRouteMetadata(route: RouteLike): RouteMetadataItem[] {
  const items: RouteMetadataItem[] = [];

  if (route.trigger?.complexity) {
    items.push({ labelKey: 'complexity', value: titleCase(route.trigger.complexity) });
  }

  if (route.metadata?.version) {
    items.push({ labelKey: 'version', value: route.metadata.version });
  }

  if (route.trigger?.goalPattern) {
    items.push({ labelKey: 'goalPattern', value: route.trigger.goalPattern });
  }

  items.push({ labelKey: 'gateCount', value: String(route.gates?.length ?? 0) });

  if (route.metadata?.author) {
    items.push({ labelKey: 'author', value: route.metadata.author });
  }

  if (route.metadata?.tags && route.metadata.tags.length > 0) {
    items.push({ labelKey: 'tags', value: route.metadata.tags.join(', ') });
  }

  return items;
}

export function buildStageDetailLine(stage: StageLike): string {
  return [stage.name, stage.type, stage.target].filter(Boolean).join(' · ');
}
