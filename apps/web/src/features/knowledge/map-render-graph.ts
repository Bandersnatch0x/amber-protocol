import type {
  GraphLayer,
  KnowledgeEdgeDTO,
  KnowledgeGraphDTO,
  KnowledgeNode,
} from '@/lib/knowledge-dto';

/**
 * F060 folded-by-default render graph (tickets #264/#265): pure derivation
 * from the deterministic DTO plus session-only view state. The default view
 * is document scale; each expanded feature reveals its code neighbourhood
 * (anchored files plus what those files import, one hop); code nodes whose
 * in-degree exceeds the code p99 collapse into one "shared foundation"
 * super-node in the renderer only — the CLI graph carries zero derived
 * nodes, and nothing here is persisted.
 */

export const FOUNDATION_NODE_ID = 'foundation:shared-code';

export interface RenderNode {
  id: string;
  kind: KnowledgeNode['kind'] | 'foundation';
  layer: GraphLayer;
  title: string;
  /** Null exactly for the synthetic shared-foundation node. */
  dto: KnowledgeNode | null;
  /** Foundation only: the aggregated Code Node ids, sorted. */
  memberIds?: string[];
}

export interface RenderEdge {
  id: string;
  src: string;
  dst: string;
  verb: KnowledgeEdgeDTO['verb'];
  origin: KnowledgeEdgeDTO['origin'];
  /** True when an endpoint was remapped into the shared-foundation node. */
  aggregated: boolean;
  /** True when a contributing deterministic edge carries an anomaly mark. */
  anomalous: boolean;
}

export interface RenderGraph {
  nodes: RenderNode[];
  edges: RenderEdge[];
  /** Code Nodes hidden by the fold (not in any expanded neighbourhood). */
  foldedCodeCount: number;
  /** Code ids revealed by expansion, before aggregation. */
  expandedCodeIds: Set<string>;
  /** Members currently absorbed into the rendered foundation node. */
  foundationMemberIds: string[];
}

export interface RenderGraphOptions {
  expandedFeatures: ReadonlySet<string>;
  /** User-facing toggle; the rule and threshold live in the Spec. */
  aggregateFoundation: boolean;
  /** Analytics codeAggregation.memberIds (in-degree > code p99). */
  foundationMembers: readonly string[];
  /** Analytics anomaly keys as `src\u0000verb\u0000dst`. */
  anomalousKeys?: ReadonlySet<string>;
}

export function anomalyKey(edge: { src: string; verb: string; dst: string }): string {
  return `${edge.src}\u0000${edge.verb}\u0000${edge.dst}`;
}

/**
 * A feature's code neighbourhood: the Code Nodes it anchors plus what those
 * files import (one hop out) — "which code realizes this feature, and what
 * does that code depend on". Never a whole-graph floodgate.
 */
export function codeNeighbourhoodOf(
  dto: Pick<KnowledgeGraphDTO, 'edges'>,
  featureId: string,
): Set<string> {
  const anchored = new Set<string>();
  for (const edge of dto.edges) {
    if (edge.verb === 'anchors' && edge.src === featureId) anchored.add(edge.dst);
  }
  const neighbourhood = new Set(anchored);
  if (anchored.size === 0) return neighbourhood;
  for (const edge of dto.edges) {
    if (edge.verb === 'imports' && anchored.has(edge.src)) neighbourhood.add(edge.dst);
  }
  return neighbourhood;
}

/** Features whose neighbourhood contains the code node, sorted by id. */
export function owningFeaturesOf(
  dto: Pick<KnowledgeGraphDTO, 'nodes' | 'edges'>,
  codeId: string,
): string[] {
  const owners: string[] = [];
  for (const node of dto.nodes) {
    if (node.kind !== 'feature') continue;
    if (codeNeighbourhoodOf(dto, node.id).has(codeId)) owners.push(node.id);
  }
  return owners.sort();
}

/**
 * Fold-piercing search domain (ticket #265): documents match on title, id,
 * status, and body; Code Nodes match on title, id, POSIX path, and exported
 * symbol names — never full source text.
 */
export function searchKnowledgeNodes(nodes: readonly KnowledgeNode[], query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const hits = new Set<string>();
  if (!q) return hits;
  for (const node of nodes) {
    if (node.title.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)) {
      hits.add(node.id);
      continue;
    }
    if (node.kind === 'code') {
      if (
        node.sourcePath.toLowerCase().includes(q) ||
        (node.symbols ?? []).some((symbol) => symbol.name.toLowerCase().includes(q))
      ) {
        hits.add(node.id);
      }
      continue;
    }
    if (
      (node.status ?? '').toLowerCase().includes(q) ||
      (node.body ?? '').toLowerCase().includes(q)
    ) {
      hits.add(node.id);
    }
  }
  return hits;
}

export function buildRenderGraph(
  dto: Pick<KnowledgeGraphDTO, 'nodes' | 'edges'>,
  options: RenderGraphOptions,
): RenderGraph {
  const anomalousKeys = options.anomalousKeys ?? new Set<string>();
  const expandedCodeIds = new Set<string>();
  for (const featureId of [...options.expandedFeatures].sort()) {
    for (const id of codeNeighbourhoodOf(dto, featureId)) expandedCodeIds.add(id);
  }

  const foundationSet = options.aggregateFoundation
    ? new Set(options.foundationMembers)
    : new Set<string>();
  const foundationMemberIds = [...expandedCodeIds].filter((id) => foundationSet.has(id)).sort();
  const absorbed = new Set(foundationMemberIds);

  const nodes: RenderNode[] = [];
  let foldedCodeCount = 0;
  for (const node of dto.nodes) {
    if (node.kind !== 'code') {
      nodes.push({ id: node.id, kind: node.kind, layer: node.layer, title: node.title, dto: node });
      continue;
    }
    if (!expandedCodeIds.has(node.id)) {
      foldedCodeCount += 1;
      continue;
    }
    if (absorbed.has(node.id)) continue;
    nodes.push({ id: node.id, kind: 'code', layer: node.layer, title: node.title, dto: node });
  }
  if (foundationMemberIds.length > 0) {
    nodes.push({
      id: FOUNDATION_NODE_ID,
      kind: 'foundation',
      layer: 'implementation',
      title: 'shared foundation',
      dto: null,
      memberIds: foundationMemberIds,
    });
  }

  const renderedIds = new Set(nodes.map((node) => node.id));
  const mapId = (id: string): string => (absorbed.has(id) ? FOUNDATION_NODE_ID : id);
  const byKey = new Map<string, RenderEdge>();
  for (const edge of dto.edges) {
    const src = mapId(edge.src);
    const dst = mapId(edge.dst);
    if (src === dst) continue;
    if (!renderedIds.has(src) || !renderedIds.has(dst)) continue;
    const key = `${src}\u0000${edge.verb}\u0000${dst}\u0000${edge.origin}`;
    const aggregated = src !== edge.src || dst !== edge.dst;
    const anomalous = anomalousKeys.has(anomalyKey(edge));
    const existing = byKey.get(key);
    if (existing) {
      existing.aggregated = existing.aggregated || aggregated;
      existing.anomalous = existing.anomalous || anomalous;
      continue;
    }
    byKey.set(key, {
      id: `${src}|${edge.verb}|${dst}|${edge.origin}`,
      src,
      dst,
      verb: edge.verb,
      origin: edge.origin,
      aggregated,
      anomalous,
    });
  }

  return {
    nodes,
    edges: [...byKey.values()],
    foldedCodeCount,
    expandedCodeIds,
    foundationMemberIds,
  };
}
