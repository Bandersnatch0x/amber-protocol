import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { GraphLayer, KnowledgeEdgeDTO, KnowledgeGraphDTO } from '@/lib/knowledge-dto';

/**
 * F060 analytics layer (tickets #259/#263): deterministic, read-time
 * computation over the deterministic graph. Nothing here is persisted and
 * nothing enters `amber knowledge graph --json` bytes — badges, panels,
 * highlighting, and the readable report all consume this module in memory.
 *
 * Determinism contract (property-tested): identical input graphs produce
 * deep-equal output across runs and platforms. Louvain runs with
 * `randomWalk: false` plus a pure seeded rng, and a connectivity post-split
 * restores the community-connectedness guarantee Louvain alone lacks.
 */

export interface GodNodeEntry {
  id: string;
  layer: GraphLayer;
  inDegree: number;
  outDegree: number;
  degree: number;
}

export interface LayerGodNodes {
  layer: GraphLayer;
  /** Nearest-rank p99 of total degree within the layer. */
  threshold: number;
  entries: GodNodeEntry[];
}

export interface CommunityInfo {
  id: string;
  size: number;
  members: string[];
}

export type AnomalyReason = 'rare-cross-kind-pair' | 'inter-community-bridge';

export interface AnomalyMark {
  src: string;
  dst: string;
  verb: KnowledgeEdgeDTO['verb'];
  reason: AnomalyReason;
  /** Neutral "worth a look" phrasing — anomaly is never an error verdict. */
  detail: string;
}

export interface KnowledgeAnalytics {
  godNodes: LayerGodNodes[];
  communities: CommunityInfo[];
  communityOf: Record<string, string>;
  anomalies: AnomalyMark[];
  /**
   * Rendering-layer aggregation input (spec §Presentation): code nodes whose
   * in-degree exceeds the p99 of code-node in-degrees. The CLI graph carries
   * zero derived nodes — collapsing these into a "shared foundation"
   * super-node happens in the renderer only.
   */
  codeAggregation: { inDegreeP99: number; memberIds: string[] };
  /** Flip-condition metrics (spec §Analytics) for v2.1 re-evaluation. */
  metrics: {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
    largestCommunityShare: number;
    weightedSingletonShare: number;
  };
}

export const LAYER_ORDER: readonly GraphLayer[] = ['decision', 'knowledge', 'implementation'];

/** Cross-kind pairs at or below this share of all edges are "rare". */
export const RARE_PAIR_MAX_SHARE = 0.005;

type AnalyticsInput = Pick<KnowledgeGraphDTO, 'nodes' | 'edges'>;

/** Nearest-rank percentile over an ascending-sorted numeric array. */
export function nearestRankPercentile(sortedAscending: readonly number[], q: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil(q * sortedAscending.length);
  return sortedAscending[Math.max(0, rank - 1)];
}

/** Pure LCG so no ambient randomness can enter the deterministic layer. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function deterministicEdges(input: AnalyticsInput): KnowledgeEdgeDTO[] {
  return input.edges.filter((edge) => edge.origin === 'deterministic');
}

function computeDegrees(
  input: AnalyticsInput,
  edges: readonly KnowledgeEdgeDTO[],
): Map<string, { inDegree: number; outDegree: number }> {
  const degrees = new Map<string, { inDegree: number; outDegree: number }>();
  for (const node of input.nodes) degrees.set(node.id, { inDegree: 0, outDegree: 0 });
  for (const edge of edges) {
    const src = degrees.get(edge.src);
    const dst = degrees.get(edge.dst);
    if (!src || !dst) continue;
    src.outDegree += 1;
    dst.inDegree += 1;
  }
  return degrees;
}

function computeGodNodes(
  input: AnalyticsInput,
  degrees: Map<string, { inDegree: number; outDegree: number }>,
): LayerGodNodes[] {
  const byLayer = new Map<GraphLayer, GodNodeEntry[]>();
  for (const layer of LAYER_ORDER) byLayer.set(layer, []);
  for (const node of input.nodes) {
    const record = degrees.get(node.id);
    if (!record) continue;
    byLayer.get(node.layer)?.push({
      id: node.id,
      layer: node.layer,
      inDegree: record.inDegree,
      outDegree: record.outDegree,
      degree: record.inDegree + record.outDegree,
    });
  }
  const result: LayerGodNodes[] = [];
  for (const layer of LAYER_ORDER) {
    const entries = byLayer.get(layer) ?? [];
    if (entries.length === 0) continue;
    const threshold = nearestRankPercentile(
      entries.map((entry) => entry.degree).sort((a, b) => a - b),
      0.99,
    );
    const ranked = entries
      .filter((entry) => entry.degree >= threshold && entry.degree > 0)
      .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1));
    result.push({ layer, threshold, entries: ranked });
  }
  return result;
}

interface CommunityComputation {
  communities: CommunityInfo[];
  communityOf: Record<string, string>;
}

function computeCommunities(
  input: AnalyticsInput,
  edges: readonly KnowledgeEdgeDTO[],
): CommunityComputation {
  const nodeIds = input.nodes.map((node) => node.id);
  const undirected = new Graph({ type: 'undirected', multi: false });
  for (const id of nodeIds) undirected.addNode(id);
  for (const edge of edges) {
    if (!undirected.hasNode(edge.src) || !undirected.hasNode(edge.dst)) continue;
    if (edge.src === edge.dst) continue;
    undirected.updateUndirectedEdgeWithKey(
      `${edge.src < edge.dst ? edge.src : edge.dst}\u0000${edge.src < edge.dst ? edge.dst : edge.src}`,
      edge.src,
      edge.dst,
      (attributes) => ({ weight: ((attributes.weight as number) ?? 0) + 1 }),
    );
  }

  // Louvain refuses empty/edgeless graphs; every node is then its own island.
  const rawAssignment: Record<string, number> = {};
  if (undirected.size > 0) {
    const mapping = louvain(undirected, {
      getEdgeWeight: 'weight',
      randomWalk: false,
      rng: seededRng(0x5eed),
    });
    Object.assign(rawAssignment, mapping);
  } else {
    nodeIds.forEach((id, index) => {
      rawAssignment[id] = index;
    });
  }

  // Deterministic connectivity post-split: a Louvain community that is not
  // internally connected becomes one final community per connected component.
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  undirected.forEachUndirectedEdge((_edge, _attributes, source, target) => {
    adjacency.get(source)?.push(target);
    adjacency.get(target)?.push(source);
  });
  for (const neighbours of adjacency.values()) neighbours.sort();

  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const id of nodeIds) {
    if (componentOf.has(id)) continue;
    const component = componentCount;
    componentCount += 1;
    const queue = [id];
    componentOf.set(id, component);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const neighbour of adjacency.get(current) ?? []) {
        if (componentOf.has(neighbour)) continue;
        if (rawAssignment[neighbour] !== rawAssignment[current]) continue;
        componentOf.set(neighbour, component);
        queue.push(neighbour);
      }
    }
  }

  const membersByComponent = new Map<number, string[]>();
  for (const id of nodeIds) {
    const component = componentOf.get(id) as number;
    const members = membersByComponent.get(component) ?? [];
    members.push(id);
    membersByComponent.set(component, members);
  }
  const sorted = [...membersByComponent.values()]
    .map((members) => [...members].sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));

  const communities: CommunityInfo[] = [];
  const communityOf: Record<string, string> = {};
  sorted.forEach((members, index) => {
    const id = `c${index}`;
    communities.push({ id, size: members.length, members });
    for (const member of members) communityOf[member] = id;
  });
  return { communities, communityOf };
}

function computeAnomalies(
  input: AnalyticsInput,
  edges: readonly KnowledgeEdgeDTO[],
  communityOf: Record<string, string>,
): AnomalyMark[] {
  const kindOf = new Map(input.nodes.map((node) => [node.id, node.kind]));
  const marks: AnomalyMark[] = [];

  // Detector 1: rare cross-kind pairs — pair frequency at or below threshold.
  const pairCounts = new Map<string, number>();
  for (const edge of edges) {
    const srcKind = kindOf.get(edge.src);
    const dstKind = kindOf.get(edge.dst);
    if (!srcKind || !dstKind || srcKind === dstKind) continue;
    const key = `${srcKind}\u0000${dstKind}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const rareThreshold = Math.max(1, Math.floor(edges.length * RARE_PAIR_MAX_SHARE));
  for (const edge of edges) {
    const srcKind = kindOf.get(edge.src);
    const dstKind = kindOf.get(edge.dst);
    if (!srcKind || !dstKind || srcKind === dstKind) continue;
    const count = pairCounts.get(`${srcKind}\u0000${dstKind}`) ?? 0;
    if (count > rareThreshold) continue;
    marks.push({
      src: edge.src,
      dst: edge.dst,
      verb: edge.verb,
      reason: 'rare-cross-kind-pair',
      detail: `kind pair ${srcKind} → ${dstKind} appears ${count}× across ${edges.length} edges`,
    });
  }

  // Detector 2: inter-community bridges — the only edge between two
  // communities is worth a look.
  const bridgeCounts = new Map<string, number>();
  const bridgeKey = (edge: KnowledgeEdgeDTO): string | null => {
    const a = communityOf[edge.src];
    const b = communityOf[edge.dst];
    if (a === undefined || b === undefined || a === b) return null;
    return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  };
  for (const edge of edges) {
    const key = bridgeKey(edge);
    if (key !== null) bridgeCounts.set(key, (bridgeCounts.get(key) ?? 0) + 1);
  }
  for (const edge of edges) {
    const key = bridgeKey(edge);
    if (key === null || bridgeCounts.get(key) !== 1) continue;
    const [a, b] = key.split('\u0000');
    marks.push({
      src: edge.src,
      dst: edge.dst,
      verb: edge.verb,
      reason: 'inter-community-bridge',
      detail: `only edge between community ${a} and ${b}`,
    });
  }

  marks.sort((a, b) => {
    if (a.src !== b.src) return a.src < b.src ? -1 : 1;
    if (a.verb !== b.verb) return a.verb < b.verb ? -1 : 1;
    if (a.dst !== b.dst) return a.dst < b.dst ? -1 : 1;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });
  return marks;
}

function computeCodeAggregation(
  input: AnalyticsInput,
  degrees: Map<string, { inDegree: number; outDegree: number }>,
): KnowledgeAnalytics['codeAggregation'] {
  const codeInDegrees: Array<{ id: string; inDegree: number }> = [];
  for (const node of input.nodes) {
    if (node.kind !== 'code') continue;
    codeInDegrees.push({ id: node.id, inDegree: degrees.get(node.id)?.inDegree ?? 0 });
  }
  if (codeInDegrees.length === 0) return { inDegreeP99: 0, memberIds: [] };
  const inDegreeP99 = nearestRankPercentile(
    codeInDegrees.map((entry) => entry.inDegree).sort((a, b) => a - b),
    0.99,
  );
  const memberIds = codeInDegrees
    .filter((entry) => entry.inDegree > inDegreeP99)
    .map((entry) => entry.id)
    .sort();
  return { inDegreeP99, memberIds };
}

export function buildKnowledgeAnalytics(input: AnalyticsInput): KnowledgeAnalytics {
  const edges = deterministicEdges(input);
  const degrees = computeDegrees(input, edges);
  const godNodes = computeGodNodes(input, degrees);
  const { communities, communityOf } = computeCommunities(input, edges);
  const anomalies = computeAnomalies(input, edges, communityOf);
  const codeAggregation = computeCodeAggregation(input, degrees);

  const nodeCount = input.nodes.length;
  const degreeTotal = [...degrees.values()].reduce(
    (sum, record) => sum + record.inDegree + record.outDegree,
    0,
  );
  const singletonDegree = communities
    .filter((community) => community.size === 1)
    .reduce((sum, community) => {
      const record = degrees.get(community.members[0]);
      return sum + (record ? record.inDegree + record.outDegree : 0);
    }, 0);
  const largestCommunityShare = nodeCount === 0 ? 0 : (communities[0]?.size ?? 0) / nodeCount;
  const weightedSingletonShare = degreeTotal === 0 ? 0 : singletonDegree / degreeTotal;

  return {
    godNodes,
    communities,
    communityOf,
    anomalies,
    codeAggregation,
    metrics: {
      nodeCount,
      edgeCount: edges.length,
      communityCount: communities.length,
      largestCommunityShare,
      weightedSingletonShare,
    },
  };
}
