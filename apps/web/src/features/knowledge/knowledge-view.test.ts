import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBase,
  buildKnowledgeInteraction,
  buildKnowledgeRender,
} from './knowledge-view';
import { FOUNDATION_NODE_ID } from './map-render-graph';
import type {
  KnowledgeEdgeDTO,
  KnowledgeGraphDTO,
  KnowledgeNode,
  SemanticResultDTO,
} from '@/lib/knowledge-dto';

function doc(id: string, kind: KnowledgeNode['kind']): KnowledgeNode {
  return {
    id,
    kind,
    layer: kind === 'adr' ? 'decision' : 'implementation',
    title: id,
    sourcePath: `${id}.md`,
    body: `${id} body`,
    status: 'Accepted',
  };
}

function code(path: string, symbols: string[] = []): KnowledgeNode {
  return {
    id: `code:${path}`,
    kind: 'code',
    layer: 'implementation',
    title: path.split('/').pop() ?? path,
    sourcePath: path,
    symbols: symbols.map((name, index) => ({ name, startLine: index + 1, startCol: 1 })),
  };
}

function edge(
  src: string,
  dst: string,
  verb: KnowledgeEdgeDTO['verb'],
  origin: KnowledgeEdgeDTO['origin'] = 'deterministic',
): KnowledgeEdgeDTO {
  return { src, dst, verb, origin };
}

// F1 anchors a.ts and b.ts; a.ts imports util.ts and hub.ts; b.ts imports hub.ts.
// F2 anchors other.ts.
const dto: KnowledgeGraphDTO = {
  schemaVersion: '2',
  toolchain: { typescript: '7.0.0' },
  nodes: [
    doc('adr:0001', 'adr'),
    doc('feature:F1', 'feature'),
    doc('feature:F2', 'feature'),
    code('src/a.ts', ['alpha']),
    code('src/b.ts', ['beta']),
    code('src/util.ts', ['helper']),
    code('src/hub.ts', ['hub']),
    code('src/other.ts', ['omega']),
  ],
  edges: [
    edge('adr:0001', 'feature:F1', 'describes'),
    edge('feature:F1', 'code:src/a.ts', 'anchors'),
    edge('feature:F1', 'code:src/b.ts', 'anchors'),
    edge('feature:F2', 'code:src/other.ts', 'anchors'),
    edge('code:src/a.ts', 'code:src/util.ts', 'imports'),
    edge('code:src/a.ts', 'code:src/hub.ts', 'imports'),
    edge('code:src/b.ts', 'code:src/hub.ts', 'imports'),
  ],
  drift: [{ nodeId: 'code:src/other.ts', kind: 'dead-anchor', path: 'x', detail: 'gone' }],
  recentChanges: [],
};

const noFilters = {
  selectedId: null,
  search: '',
  kindFilter: new Set<string>(),
  showDriftOnly: false,
};

describe('buildKnowledgeBase', () => {
  it('derives the index maps, anchor counts, drift ids, and the document count', () => {
    const base = buildKnowledgeBase(dto, null);
    expect(base.mergedDto).toBe(dto); // no semantic layer → the DTO is reused as-is
    expect(base.anchorsCountByFeature.get('feature:F1')).toBe(2);
    expect(base.anchorsCountByFeature.get('feature:F2')).toBe(1);
    expect(base.driftNodeIds).toEqual(new Set(['code:src/other.ts']));
    expect(base.documentNodeCount).toBe(3); // adr + two features; code nodes never count
    expect(base.nodeById.get('code:src/a.ts')?.title).toBe('a.ts');
    expect(base.kindLayer.get('code')).toBe('implementation');
  });

  it('merges inferred edges only when the semantic layer is available', () => {
    const inferred = edge('code:src/a.ts', 'adr:0001', 'references', 'inferred');
    const semantic = {
      available: true,
      inferredEdges: [inferred],
      nodeSummaries: [
        {
          nodeId: 'adr:0001',
          summary: 's',
          origin: 'inferred',
          provenance: { provider: 'p', model: 'm', timestamp: 't', promptHash: 'h' },
        },
      ],
    } satisfies SemanticResultDTO;

    const merged = buildKnowledgeBase(dto, semantic);
    expect(merged.mergedDto.edges).toHaveLength(dto.edges.length + 1);
    expect(merged.mergedDto.edges).toContainEqual(inferred);
    expect(merged.summaryByNodeId.get('adr:0001')?.summary).toBe('s');
    // Analytics stay over the deterministic graph, never the inferred edges.
    expect(merged.analytics).toEqual(buildKnowledgeBase(dto, null).analytics);

    const unavailable = buildKnowledgeBase(dto, { ...semantic, available: false });
    expect(unavailable.mergedDto.edges).toHaveLength(dto.edges.length);
    expect(unavailable.summaryByNodeId.size).toBe(1);
  });
});

describe('buildKnowledgeRender', () => {
  it('reveals an expanded feature neighbourhood and folds everything else', () => {
    const base = buildKnowledgeBase(dto, null);
    const folded = buildKnowledgeRender(base, {
      expandedFeatures: new Set(),
      aggregateFoundation: false,
    });
    expect(folded.renderGraph.nodes.some((node) => node.kind === 'code')).toBe(false);
    expect(folded.renderGraph.foldedCodeCount).toBe(5);

    const expanded = buildKnowledgeRender(base, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: false,
    });
    const ids = expanded.renderGraph.nodes.map((node) => node.id);
    // Anchored files plus one import hop from them.
    expect(ids).toContain('code:src/a.ts');
    expect(ids).toContain('code:src/b.ts');
    expect(ids).toContain('code:src/util.ts');
    expect(ids).toContain('code:src/hub.ts');
    expect(ids).not.toContain('code:src/other.ts');
    expect(expanded.renderGraph.foldedCodeCount).toBe(1);
    expect(expanded.kindCounts.get('code')).toBe(4);
    expect(expanded.kindCounts.has('foundation')).toBe(false);
  });

  it('aggregates foundation members into one synthetic node when asked', () => {
    const base = buildKnowledgeBase(dto, null);
    const render = buildKnowledgeRender(base, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: true,
    });
    // Whether anything is actually aggregated depends on the analytics p99
    // threshold; the contract is that a foundation node exists exactly when it
    // has members, and that its members leave the rendered node list.
    const foundation = render.renderGraph.nodes.find((node) => node.id === FOUNDATION_NODE_ID);
    if (foundation) {
      for (const memberId of foundation.memberIds ?? []) {
        expect(render.renderGraph.nodes.some((node) => node.id === memberId)).toBe(false);
        expect(
          render.renderGraph.edges.some(
            (e) => e.src === FOUNDATION_NODE_ID || e.dst === FOUNDATION_NODE_ID,
          ),
        ).toBe(true);
      }
    } else {
      expect(render.renderGraph.foundationMemberIds).toEqual([]);
    }
  });
});

describe('buildKnowledgeInteraction', () => {
  const base = buildKnowledgeBase(dto, null);
  const render = buildKnowledgeRender(base, {
    expandedFeatures: new Set(['feature:F1']),
    aggregateFoundation: false,
  });

  it('reports a selection with its deterministic degree and code summary', () => {
    const view = buildKnowledgeInteraction(base, render.renderGraph, {
      ...noFilters,
      selectedId: 'feature:F1',
    });
    expect(view.selected?.id).toBe('feature:F1');
    expect(view.selectedFoundation).toBe(false);
    // describes is incoming, two anchors plus one import hop count as outgoing.
    expect(view.selectedDegree).toEqual({ inDegree: 1, outDegree: 2 });
    expect(view.featureCodeSummary).toEqual({ communities: expect.any(Array), hubs: 0, size: 4 });
  });

  it('treats the synthetic foundation node as a selection, not a DTO node', () => {
    const view = buildKnowledgeInteraction(base, render.renderGraph, {
      ...noFilters,
      selectedId: FOUNDATION_NODE_ID,
    });
    expect(view.selected).toBeNull();
    expect(view.selectedFoundation).toBe(true);
    expect(view.selectedDegree).toBeNull();
  });

  it('returns null filters when nothing is filtering', () => {
    const view = buildKnowledgeInteraction(base, render.renderGraph, noFilters);
    expect(view.searchHits).toBeNull();
    expect(view.visibleIds).toBeNull();
    expect(view.visibleCount).toBe(render.renderGraph.nodes.length);
    expect(view.foldedSearchHits).toEqual([]);
  });

  it('pierces the fold for a search hit on a folded code node', () => {
    const view = buildKnowledgeInteraction(base, render.renderGraph, {
      ...noFilters,
      search: 'omega',
    });
    expect(view.searchHits).toEqual(new Set(['code:src/other.ts']));
    expect(view.foldedSearchHits).toEqual([{ id: 'code:src/other.ts', owners: ['feature:F2'] }]);
    // The hit is folded out of this render graph, so the visible set stays
    // empty: the pierce list is the path to it, not a silent un-fold.
    expect(view.visibleIds).toEqual(new Set());
  });

  it('applies the kind filter and the drift-only filter over rendered nodes', () => {
    const byKind = buildKnowledgeInteraction(base, render.renderGraph, {
      ...noFilters,
      kindFilter: new Set(['feature']),
    });
    expect([...(byKind.visibleIds ?? [])].sort()).toEqual(['feature:F1', 'feature:F2']);
    expect(byKind.visibleCount).toBe(2);

    const driftOnly = buildKnowledgeInteraction(base, render.renderGraph, {
      ...noFilters,
      showDriftOnly: true,
    });
    // other.ts is folded out of this render graph, so nothing survives.
    expect(driftOnly.visibleIds?.size).toBe(0);
  });
});
