import { isDocumentNode } from '@/lib/knowledge-dto';
import { buildKnowledgeAnalytics, type KnowledgeAnalytics } from './map-analytics';
import {
  FOUNDATION_NODE_ID,
  anomalyKey,
  buildRenderGraph,
  codeNeighbourhoodOf,
  owningFeaturesOf,
  searchKnowledgeNodes,
  type RenderGraph,
} from './map-render-graph';
import type {
  GraphLayer,
  KnowledgeGraphDTO,
  KnowledgeNode,
  NodeSummaryDTO,
  SemanticResultDTO,
} from './types';

/**
 * The Knowledge Map's derivation layer (tickets #264/#265, F060).
 *
 * Everything the page renders is a pure function of the DTO plus session-only
 * view state, so it lives here rather than in `KnowledgeMapGraph`'s memo wall:
 * one input shape in, one view model out, testable without React and without
 * mounting a 2,000-line page.
 *
 * Split into three stages so each recomputes only when its own inputs change —
 * picking a node must not rebuild the analytics or the folded render graph.
 */

/** Stage 1 — the graph itself. Depends only on the DTO and the semantic layer. */
export interface KnowledgeBase {
  /** The DTO plus any inferred edges from the semantic layer (client-side only). */
  mergedDto: KnowledgeGraphDTO;
  analytics: KnowledgeAnalytics;
  anomalousKeys: Set<string>;
  godNodeIds: Set<string>;
  nodeById: Map<string, KnowledgeNode>;
  anchorsCountByFeature: Map<string, number>;
  summaryByNodeId: Map<string, NodeSummaryDTO>;
  /** The QA/semantic ceiling is document-scale: Code Nodes never reach the LLM. */
  documentNodeCount: number;
  kindLayer: Map<string, GraphLayer>;
  driftNodeIds: Set<string>;
}

export function buildKnowledgeBase(
  dto: KnowledgeGraphDTO,
  semanticResult: SemanticResultDTO | null,
): KnowledgeBase {
  const mergedDto: KnowledgeGraphDTO =
    semanticResult?.available && semanticResult.inferredEdges.length
      ? { ...dto, edges: [...dto.edges, ...semanticResult.inferredEdges] }
      : dto;

  // Read-time analytics over the deterministic graph (F060) — never persisted.
  const analytics = buildKnowledgeAnalytics({ nodes: dto.nodes, edges: dto.edges });
  const anomalousKeys = new Set(analytics.anomalies.map((mark) => anomalyKey(mark)));
  const godNodeIds = new Set(
    analytics.godNodes.flatMap((board) => board.entries.map((entry) => entry.id)),
  );

  const nodeById = new Map(mergedDto.nodes.map((node) => [node.id, node]));

  const anchorsCountByFeature = new Map<string, number>();
  for (const edge of mergedDto.edges) {
    if (edge.verb !== 'anchors') continue;
    anchorsCountByFeature.set(edge.src, (anchorsCountByFeature.get(edge.src) ?? 0) + 1);
  }

  const summaryByNodeId = new Map<string, NodeSummaryDTO>(
    semanticResult?.nodeSummaries.length
      ? semanticResult.nodeSummaries.map((summary) => [summary.nodeId, summary])
      : [],
  );

  const kindLayer = new Map<string, GraphLayer>();
  for (const node of mergedDto.nodes)
    if (!kindLayer.has(node.kind)) kindLayer.set(node.kind, node.layer);

  return {
    mergedDto,
    analytics,
    anomalousKeys,
    godNodeIds,
    nodeById,
    anchorsCountByFeature,
    summaryByNodeId,
    documentNodeCount: mergedDto.nodes.filter(isDocumentNode).length,
    kindLayer,
    driftNodeIds: new Set(mergedDto.drift.map((finding) => finding.nodeId)),
  };
}

/** Stage 2 — the folded-by-default render graph (tickets #264/#265). */
export interface KnowledgeRender {
  renderGraph: RenderGraph;
  /** Rendered node counts per kind, excluding the synthetic foundation node. */
  kindCounts: Map<string, number>;
}

export function buildKnowledgeRender(
  base: KnowledgeBase,
  {
    expandedFeatures,
    aggregateFoundation,
  }: { expandedFeatures: ReadonlySet<string>; aggregateFoundation: boolean },
): KnowledgeRender {
  const renderGraph = buildRenderGraph(base.mergedDto, {
    expandedFeatures,
    aggregateFoundation,
    foundationMembers: base.analytics.codeAggregation.memberIds,
    anomalousKeys: base.anomalousKeys,
  });

  const kindCounts = new Map<string, number>();
  for (const node of renderGraph.nodes) {
    if (node.kind === 'foundation') continue;
    kindCounts.set(node.kind, (kindCounts.get(node.kind) ?? 0) + 1);
  }

  return { renderGraph, kindCounts };
}

/** Stage 3 — selection, search, and filters over the rendered graph. */
export interface KnowledgeInteraction {
  selected: KnowledgeNode | null;
  selectedFoundation: boolean;
  /** Null when the search box is empty (no filtering is in effect). */
  searchHits: Set<string> | null;
  /** Folded Code Node hits, as a pierce list into their owning feature. */
  foldedSearchHits: Array<{ id: string; owners: string[] }>;
  /** Null when no filter is active; otherwise the visible node ids. */
  visibleIds: Set<string> | null;
  visibleCount: number;
  selectedDegree: { inDegree: number; outDegree: number } | null;
  /** Where a selected feature's anchored code sits, while it is folded. */
  featureCodeSummary: { communities: string[]; hubs: number; size: number } | null;
}

export interface KnowledgeFilters {
  selectedId: string | null;
  search: string;
  kindFilter: ReadonlySet<string>;
  showDriftOnly: boolean;
}

export function buildKnowledgeInteraction(
  base: KnowledgeBase,
  renderGraph: RenderGraph,
  { selectedId, search, kindFilter, showDriftOnly }: KnowledgeFilters,
): KnowledgeInteraction {
  const selected = selectedId ? (base.nodeById.get(selectedId) ?? null) : null;

  // Search pierces the fold (ticket #265): the domain includes folded code
  // nodes by path and exported symbol name.
  const searchHits = search.trim() ? searchKnowledgeNodes(base.mergedDto.nodes, search) : null;

  // Folded code hits surface as a pierce list; selecting one auto-expands
  // the owning feature neighbourhood and selects the node.
  const rendered = new Set(renderGraph.nodes.map((node) => node.id));
  const foldedSearchHits = (searchHits === null ? [] : [...searchHits])
    .filter((id) => id.startsWith('code:') && !rendered.has(id))
    .sort()
    .slice(0, 8)
    .map((id) => ({ id, owners: owningFeaturesOf(base.mergedDto, id) }));

  let visibleIds: Set<string> | null = null;
  if (kindFilter.size > 0 || searchHits !== null || showDriftOnly) {
    visibleIds = new Set<string>();
    for (const node of renderGraph.nodes) {
      const effectiveKind = node.kind === 'foundation' ? 'code' : node.kind;
      if (kindFilter.size > 0 && !kindFilter.has(effectiveKind)) continue;
      if (searchHits !== null && !searchHits.has(node.id)) continue;
      if (showDriftOnly && node.kind !== 'foundation' && !base.driftNodeIds.has(node.id)) continue;
      visibleIds.add(node.id);
    }
  }

  let selectedDegree: KnowledgeInteraction['selectedDegree'] = null;
  if (selected) {
    let inDegree = 0;
    let outDegree = 0;
    for (const edge of base.mergedDto.edges) {
      if (edge.origin !== 'deterministic') continue;
      if (edge.src === selected.id) outDegree += 1;
      if (edge.dst === selected.id) inDegree += 1;
    }
    selectedDegree = { inDegree, outDegree };
  }

  let featureCodeSummary: KnowledgeInteraction['featureCodeSummary'] = null;
  if (selected?.kind === 'feature') {
    const neighbourhood = codeNeighbourhoodOf(base.mergedDto, selected.id);
    if (neighbourhood.size > 0) {
      const communities = [
        ...new Set(
          [...neighbourhood]
            .map((id) => base.analytics.communityOf[id])
            .filter((id): id is string => id !== undefined),
        ),
      ].sort();
      featureCodeSummary = {
        communities,
        hubs: base.analytics.codeAggregation.memberIds.filter((id) => neighbourhood.has(id)).length,
        size: neighbourhood.size,
      };
    }
  }

  return {
    selected,
    selectedFoundation: selectedId === FOUNDATION_NODE_ID,
    searchHits,
    foldedSearchHits,
    visibleIds,
    visibleCount: visibleIds === null ? renderGraph.nodes.length : visibleIds.size,
    selectedDegree,
    featureCodeSummary,
  };
}
