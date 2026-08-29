import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_NODE_ID,
  anomalyKey,
  buildRenderGraph,
  codeNeighbourhoodOf,
  owningFeaturesOf,
  searchKnowledgeNodes,
} from './map-render-graph';
import type { KnowledgeEdgeDTO, KnowledgeNode } from '@/lib/knowledge-dto';

function doc(
  id: string,
  kind: KnowledgeNode['kind'],
  layer: KnowledgeNode['layer'],
): KnowledgeNode {
  return {
    id,
    kind,
    layer,
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

const feature = (id: string): KnowledgeNode => ({
  id: `feature:${id}`,
  kind: 'feature',
  layer: 'implementation',
  title: id,
  sourcePath: 'feature_list.json',
});

// F1 anchors a.ts and b.ts; a.ts imports util.ts; hub.ts is imported by all.
const nodes: KnowledgeNode[] = [
  doc('adr:0001', 'adr', 'decision'),
  feature('F1'),
  feature('F2'),
  code('src/a.ts', ['alpha']),
  code('src/b.ts', ['beta']),
  code('src/util.ts', ['helper']),
  code('src/hub.ts', ['hub']),
  code('src/other.ts', ['omega']),
];
const edges: KnowledgeEdgeDTO[] = [
  edge('adr:0001', 'feature:F1', 'describes'),
  edge('feature:F1', 'code:src/a.ts', 'anchors'),
  edge('feature:F1', 'code:src/b.ts', 'anchors'),
  edge('feature:F2', 'code:src/other.ts', 'anchors'),
  edge('code:src/a.ts', 'code:src/util.ts', 'imports'),
  edge('code:src/a.ts', 'code:src/hub.ts', 'imports'),
  edge('code:src/b.ts', 'code:src/hub.ts', 'imports'),
  edge('code:src/other.ts', 'code:src/hub.ts', 'imports'),
  edge('code:src/util.ts', 'code:src/hub.ts', 'imports'),
];
const dto = { nodes, edges };

const folded = () =>
  buildRenderGraph(dto, {
    expandedFeatures: new Set<string>(),
    aggregateFoundation: true,
    foundationMembers: ['code:src/hub.ts'],
  });

describe('buildRenderGraph — folded default', () => {
  it('renders document scale only: no code nodes, no anchors/imports edges, all code counted as folded', () => {
    const graph = folded();
    expect(graph.nodes.map((n) => n.id)).toEqual(['adr:0001', 'feature:F1', 'feature:F2']);
    expect(graph.foldedCodeCount).toBe(5);
    expect(graph.edges.map((e) => `${e.src}-[${e.verb}]->${e.dst}`)).toEqual([
      'adr:0001-[describes]->feature:F1',
    ]);
    expect(graph.foundationMemberIds).toEqual([]);
  });
});

describe('buildRenderGraph — per-feature expansion', () => {
  it('reveals the anchored files plus their one-hop imports, nothing else', () => {
    const graph = buildRenderGraph(dto, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: false,
      foundationMembers: ['code:src/hub.ts'],
    });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('code:src/a.ts');
    expect(ids).toContain('code:src/b.ts');
    expect(ids).toContain('code:src/util.ts');
    expect(ids).toContain('code:src/hub.ts');
    expect(ids).not.toContain('code:src/other.ts');
    expect(graph.foldedCodeCount).toBe(1);
    const rendered = graph.edges.map((e) => `${e.src}-[${e.verb}]->${e.dst}`);
    expect(rendered).toContain('feature:F1-[anchors]->code:src/a.ts');
    expect(rendered).toContain('code:src/a.ts-[imports]->code:src/util.ts');
    // other.ts stays folded, so its imports edge cannot render
    expect(rendered).not.toContain('code:src/other.ts-[imports]->code:src/hub.ts');
  });

  it('unions multiple expanded features and collapses back to the folded view', () => {
    const both = buildRenderGraph(dto, {
      expandedFeatures: new Set(['feature:F1', 'feature:F2']),
      aggregateFoundation: false,
      foundationMembers: [],
    });
    expect(both.nodes.map((n) => n.id)).toContain('code:src/other.ts');
    expect(both.foldedCodeCount).toBe(0);
    const collapsed = buildRenderGraph(dto, {
      expandedFeatures: new Set<string>(),
      aggregateFoundation: false,
      foundationMembers: [],
    });
    expect(collapsed.nodes.every((n) => n.kind !== 'code')).toBe(true);
  });

  it('a feature without anchored code has an empty neighbourhood', () => {
    expect(codeNeighbourhoodOf(dto, 'adr:0001').size).toBe(0);
    const graph = buildRenderGraph(dto, {
      expandedFeatures: new Set(['adr:0001']),
      aggregateFoundation: true,
      foundationMembers: [],
    });
    expect(graph.foldedCodeCount).toBe(5);
  });
});

describe('buildRenderGraph — shared-foundation aggregation (rendering layer only)', () => {
  it('absorbs p99 members into one super-node and retargets their edges without duplicates', () => {
    const graph = buildRenderGraph(dto, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: true,
      foundationMembers: ['code:src/hub.ts'],
    });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).not.toContain('code:src/hub.ts');
    expect(ids).toContain(FOUNDATION_NODE_ID);
    const foundation = graph.nodes.find((n) => n.id === FOUNDATION_NODE_ID);
    expect(foundation?.kind).toBe('foundation');
    expect(foundation?.memberIds).toEqual(['code:src/hub.ts']);
    const retargeted = graph.edges.filter((e) => e.dst === FOUNDATION_NODE_ID);
    // a.ts, b.ts and util.ts all import hub.ts — three distinct sources
    expect(retargeted.map((e) => e.src).sort()).toEqual([
      'code:src/a.ts',
      'code:src/b.ts',
      'code:src/util.ts',
    ]);
    expect(retargeted.every((e) => e.aggregated)).toBe(true);
  });

  it('renders members plainly when the user toggle is off', () => {
    const graph = buildRenderGraph(dto, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: false,
      foundationMembers: ['code:src/hub.ts'],
    });
    expect(graph.nodes.map((n) => n.id)).toContain('code:src/hub.ts');
    expect(graph.nodes.map((n) => n.id)).not.toContain(FOUNDATION_NODE_ID);
  });

  it('propagates anomaly marks through aggregation', () => {
    const marked = edge('code:src/a.ts', 'code:src/hub.ts', 'imports');
    const graph = buildRenderGraph(dto, {
      expandedFeatures: new Set(['feature:F1']),
      aggregateFoundation: true,
      foundationMembers: ['code:src/hub.ts'],
      anomalousKeys: new Set([anomalyKey(marked)]),
    });
    const hit = graph.edges.find((e) => e.src === 'code:src/a.ts' && e.dst === FOUNDATION_NODE_ID);
    expect(hit?.anomalous).toBe(true);
    const clean = graph.edges.find(
      (e) => e.src === 'code:src/b.ts' && e.dst === FOUNDATION_NODE_ID,
    );
    expect(clean?.anomalous).toBe(false);
  });
});

describe('owningFeaturesOf', () => {
  it('finds owners through anchors and one-hop imports, sorted', () => {
    expect(owningFeaturesOf(dto, 'code:src/a.ts')).toEqual(['feature:F1']);
    expect(owningFeaturesOf(dto, 'code:src/hub.ts')).toEqual(['feature:F1', 'feature:F2']);
    expect(owningFeaturesOf(dto, 'code:src/nowhere.ts')).toEqual([]);
  });
});

describe('searchKnowledgeNodes — pierces the fold', () => {
  it('matches code by path and exported symbol name, documents by body and status', () => {
    expect(searchKnowledgeNodes(nodes, 'util')).toContain('code:src/util.ts');
    expect(searchKnowledgeNodes(nodes, 'helper')).toContain('code:src/util.ts');
    expect(searchKnowledgeNodes(nodes, 'adr:0001 body')).toContain('adr:0001');
    expect(searchKnowledgeNodes(nodes, 'accepted')).toContain('adr:0001');
    expect(searchKnowledgeNodes(nodes, 'accepted')).not.toContain('code:src/a.ts');
    expect(searchKnowledgeNodes(nodes, '')).toEqual(new Set());
  });
});
