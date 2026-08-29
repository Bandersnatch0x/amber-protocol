import { describe, expect, it } from 'vitest';
import {
  RARE_PAIR_MAX_SHARE,
  buildKnowledgeAnalytics,
  nearestRankPercentile,
} from './map-analytics';
import type { KnowledgeEdgeDTO, KnowledgeNode } from '@/lib/knowledge-dto';
import { knowledgeGraphFixture } from './fixture';

function node(
  id: string,
  layer: KnowledgeNode['layer'],
  kind?: KnowledgeNode['kind'],
): KnowledgeNode {
  return {
    id,
    kind: kind ?? (layer === 'decision' ? 'adr' : layer === 'knowledge' ? 'wiki' : 'feature'),
    layer,
    title: id,
    sourcePath: `src/${id.replace(/[^a-z0-9]+/gi, '-')}.ts`,
  };
}

function codeNode(path: string): KnowledgeNode {
  return {
    id: `code:${path}`,
    kind: 'code',
    layer: 'implementation',
    title: path.split('/').pop() ?? path,
    sourcePath: path,
  };
}

function edge(
  src: string,
  dst: string,
  verb: KnowledgeEdgeDTO['verb'] = 'references',
): KnowledgeEdgeDTO {
  return { src, dst, verb, origin: 'deterministic' };
}

/** Pure LCG so the generated property-test graph is identical on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generatedGraph(seed: number, nodeCount: number, edgeCount: number) {
  const random = lcg(seed);
  const layers: KnowledgeNode['layer'][] = ['decision', 'knowledge', 'implementation'];
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    index % 4 === 3 ? codeNode(`lib/mod-${index}.ts`) : node(`n:${index}`, layers[index % 3]),
  );
  const verbs: KnowledgeEdgeDTO['verb'][] = ['references', 'describes', 'imports', 'anchors'];
  const edges: KnowledgeEdgeDTO[] = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const src = nodes[Math.floor(random() * nodeCount)].id;
    const dst = nodes[Math.floor(random() * nodeCount)].id;
    if (src === dst) continue;
    edges.push(edge(src, dst, verbs[Math.floor(random() * verbs.length)]));
  }
  return { nodes, edges };
}

describe('nearestRankPercentile', () => {
  it('follows the nearest-rank definition at the boundary', () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(nearestRankPercentile(sorted, 0.99)).toBe(99);
    expect(nearestRankPercentile([7], 0.99)).toBe(7);
    expect(nearestRankPercentile([], 0.99)).toBe(0);
  });
});

describe('buildKnowledgeAnalytics — determinism (property)', () => {
  it('is deep-equal across repeated runs on a generated graph', () => {
    const input = generatedGraph(0xf060, 120, 400);
    const first = buildKnowledgeAnalytics(input);
    const second = buildKnowledgeAnalytics(structuredClone(input));
    const third = buildKnowledgeAnalytics(input);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('is deep-equal across repeated runs on the demo fixture', () => {
    const first = buildKnowledgeAnalytics(knowledgeGraphFixture);
    const second = buildKnowledgeAnalytics(structuredClone(knowledgeGraphFixture));
    expect(second).toEqual(first);
  });

  it('ignores inferred edges everywhere', () => {
    const base = generatedGraph(0xbeef, 30, 60);
    const withInferred = {
      nodes: base.nodes,
      edges: [
        ...base.edges,
        { ...edge(base.nodes[0].id, base.nodes[1].id, 'references'), origin: 'inferred' as const },
      ],
    };
    expect(buildKnowledgeAnalytics(withInferred)).toEqual(buildKnowledgeAnalytics(base));
  });
});

describe('buildKnowledgeAnalytics — god nodes at the p99 boundary', () => {
  it('badges exactly the nodes at or above the layer p99 threshold', () => {
    // 100 knowledge nodes; hub-i receives i references from decision feeders,
    // so knowledge-layer degrees are exactly 1..100.
    const hubs = Array.from({ length: 100 }, (_, index) => node(`wiki:h${index + 1}`, 'knowledge'));
    const feeders: KnowledgeNode[] = [];
    const edges: KnowledgeEdgeDTO[] = [];
    let feeder = 0;
    for (let index = 0; index < hubs.length; index += 1) {
      for (let count = 0; count <= index; count += 1) {
        const id = `adr:f${feeder}`;
        feeder += 1;
        feeders.push(node(id, 'decision'));
        edges.push(edge(id, hubs[index].id));
      }
    }
    const analytics = buildKnowledgeAnalytics({ nodes: [...hubs, ...feeders], edges });
    const knowledgeBoard = analytics.godNodes.find((board) => board.layer === 'knowledge');
    expect(knowledgeBoard?.threshold).toBe(99);
    expect(knowledgeBoard?.entries.map((entry) => entry.id)).toEqual(['wiki:h100', 'wiki:h99']);
    expect(knowledgeBoard?.entries[0]).toMatchObject({ inDegree: 100, outDegree: 0, degree: 100 });
  });

  it('ranks per layer, never globally, and skips degree-zero layers', () => {
    const doc = node('adr:hub', 'decision');
    const docFeeders = Array.from({ length: 3 }, (_, index) => node(`wiki:d${index}`, 'knowledge'));
    const code = Array.from({ length: 5 }, (_, index) => codeNode(`lib/c${index}.ts`));
    const isolated = node('feature:alone', 'implementation');
    const edges = [
      ...docFeeders.map((feeder) => edge(feeder.id, doc.id)),
      // one code hub with in-degree 4 — far above any document degree
      ...code.slice(1).map((member) => edge(member.id, code[0].id, 'imports')),
    ];
    const analytics = buildKnowledgeAnalytics({
      nodes: [doc, ...docFeeders, ...code, isolated],
      edges,
    });
    const decision = analytics.godNodes.find((board) => board.layer === 'decision');
    expect(decision?.entries.map((entry) => entry.id)).toEqual(['adr:hub']);
    const implementation = analytics.godNodes.find((board) => board.layer === 'implementation');
    expect(implementation?.entries.map((entry) => entry.id)).toEqual([code[0].id]);
    expect(implementation?.entries[0].degree).toBe(4);
  });
});

describe('buildKnowledgeAnalytics — communities', () => {
  it('every community is internally connected (post-split guarantee)', () => {
    const input = generatedGraph(0xc0ffee, 90, 150);
    const analytics = buildKnowledgeAnalytics(input);
    const adjacency = new Map<string, Set<string>>();
    for (const item of input.nodes) adjacency.set(item.id, new Set());
    for (const item of input.edges) {
      adjacency.get(item.src)?.add(item.dst);
      adjacency.get(item.dst)?.add(item.src);
    }
    for (const community of analytics.communities) {
      const members = new Set(community.members);
      const [start] = community.members;
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const next of adjacency.get(current) ?? []) {
          if (!members.has(next) || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size).toBe(community.size);
    }
  });

  it('labels communities stably: c0 is the largest, isolated nodes are singletons', () => {
    const clusterA = ['adr:a1', 'adr:a2', 'adr:a3', 'adr:a4'].map((id) => node(id, 'decision'));
    const clusterB = ['wiki:b1', 'wiki:b2'].map((id) => node(id, 'knowledge'));
    const lonely = node('feature:lonely', 'implementation');
    const edges = [
      edge('adr:a1', 'adr:a2', 'builds-on'),
      edge('adr:a1', 'adr:a3', 'builds-on'),
      edge('adr:a1', 'adr:a4', 'builds-on'),
      edge('adr:a2', 'adr:a3', 'builds-on'),
      edge('adr:a2', 'adr:a4', 'builds-on'),
      edge('adr:a3', 'adr:a4', 'builds-on'),
      edge('wiki:b1', 'wiki:b2'),
    ];
    const analytics = buildKnowledgeAnalytics({
      nodes: [...clusterA, ...clusterB, lonely],
      edges,
    });
    expect(analytics.communities[0].size).toBe(4);
    expect(analytics.communities[0].id).toBe('c0');
    expect(analytics.communityOf['feature:lonely']).toBeDefined();
    const lonelyCommunity = analytics.communities.find(
      (community) => community.id === analytics.communityOf['feature:lonely'],
    );
    expect(lonelyCommunity?.size).toBe(1);
    expect(analytics.metrics.communityCount).toBe(analytics.communities.length);
  });
});

describe('buildKnowledgeAnalytics — anomaly detectors', () => {
  it('marks a cross-kind pair at the frequency threshold and clears one above it', () => {
    // 400 deterministic edges -> rare threshold = floor(400 * share) = 2.
    const filler = Array.from({ length: 200 }, (_, index) => [
      node(`adr:s${index}`, 'decision'),
      node(`wiki:t${index}`, 'knowledge'),
    ]).flat();
    const fillerEdges = Array.from({ length: 198 }, (_, index) =>
      edge(`adr:s${index}`, `wiki:t${index}`),
    );
    const memoryNodes = [
      node('memory:m1', 'knowledge', 'memory'),
      node('memory:m2', 'knowledge', 'memory'),
      node('memory:m3', 'knowledge', 'memory'),
      node('memory:m4', 'knowledge', 'memory'),
      node('memory:m5', 'knowledge', 'memory'),
    ];
    const rarePair = [edge('memory:m1', 'adr:s0'), edge('memory:m2', 'adr:s1')];
    const clearedPair = [
      edge('wiki:t0', 'memory:m3'),
      edge('wiki:t1', 'memory:m4'),
      edge('wiki:t2', 'memory:m5'),
    ];
    // pad to exactly 400 edges with same-kind (never marked) edges
    const sameKind = Array.from({ length: 400 - 198 - 5 }, (_, index) =>
      edge(`adr:s${index}`, `adr:s${index + 1}`, 'builds-on'),
    );
    const edges = [...fillerEdges, ...rarePair, ...clearedPair, ...sameKind];
    expect(edges).toHaveLength(400);
    const threshold = Math.floor(400 * RARE_PAIR_MAX_SHARE);
    expect(threshold).toBe(2);

    const analytics = buildKnowledgeAnalytics({ nodes: [...filler, ...memoryNodes], edges });
    const rare = analytics.anomalies.filter((mark) => mark.reason === 'rare-cross-kind-pair');
    const rareKeys = rare.map((mark) => `${mark.src}->${mark.dst}`);
    expect(rareKeys).toContain('memory:m1->adr:s0');
    expect(rareKeys).toContain('memory:m2->adr:s1');
    expect(rareKeys).not.toContain('wiki:t0->memory:m3');
    // adr->wiki appears 198x: never rare
    expect(rareKeys).not.toContain('adr:s0->wiki:t0');
    for (const mark of rare) expect(mark.detail).toMatch(/appears \d+× across 400 edges/);
  });

  it('marks the only edge between two communities as a bridge and clears doubled links', () => {
    const cliqueEdges = (ids: string[], verb: KnowledgeEdgeDTO['verb']) =>
      ids.flatMap((a, index) => ids.slice(index + 1).map((b) => edge(a, b, verb)));
    const west = ['code:w/a.ts', 'code:w/b.ts', 'code:w/c.ts', 'code:w/d.ts'];
    const east = ['code:e/a.ts', 'code:e/b.ts', 'code:e/c.ts', 'code:e/d.ts'];
    const nodes = [...west, ...east].map((id) => codeNode(id.slice('code:'.length)));
    const single = buildKnowledgeAnalytics({
      nodes,
      edges: [
        ...cliqueEdges(west, 'imports'),
        ...cliqueEdges(east, 'imports'),
        edge(west[0], east[0], 'imports'),
      ],
    });
    expect(single.communityOf[west[0]]).not.toBe(single.communityOf[east[0]]);
    const bridges = single.anomalies.filter((mark) => mark.reason === 'inter-community-bridge');
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({ src: west[0], dst: east[0] });

    const doubled = buildKnowledgeAnalytics({
      nodes,
      edges: [
        ...cliqueEdges(west, 'imports'),
        ...cliqueEdges(east, 'imports'),
        edge(west[0], east[0], 'imports'),
        edge(west[1], east[1], 'imports'),
      ],
    });
    if (doubled.communityOf[west[0]] !== doubled.communityOf[east[0]]) {
      expect(
        doubled.anomalies.filter((mark) => mark.reason === 'inter-community-bridge'),
      ).toHaveLength(0);
    }
  });
});

describe('buildKnowledgeAnalytics — code aggregation input', () => {
  it('collects code nodes strictly above the code in-degree p99 and never documents', () => {
    const code = Array.from({ length: 100 }, (_, index) => codeNode(`lib/m${index}.ts`));
    const doc = node('adr:popular', 'decision');
    const edges: KnowledgeEdgeDTO[] = [];
    // in-degree i for code node i (0..99): nearest-rank p99 over 0..99 = 98.
    for (let target = 0; target < code.length; target += 1) {
      for (let source = 0; source < target; source += 1) {
        edges.push(edge(code[source].id, code[target].id, 'imports'));
      }
    }
    // a very popular document must never enter code aggregation
    for (let source = 0; source < 50; source += 1) {
      edges.push(edge(code[source].id, doc.id, 'references'));
    }
    const analytics = buildKnowledgeAnalytics({ nodes: [...code, doc], edges });
    expect(analytics.codeAggregation.inDegreeP99).toBe(98);
    expect(analytics.codeAggregation.memberIds).toEqual(['code:lib/m99.ts']);
  });

  it('is empty when the graph has no code nodes', () => {
    const analytics = buildKnowledgeAnalytics({
      nodes: [node('adr:1', 'decision')],
      edges: [],
    });
    expect(analytics.codeAggregation).toEqual({ inDegreeP99: 0, memberIds: [] });
  });
});

describe('buildKnowledgeAnalytics — flip-condition metrics and edge cases', () => {
  it('exposes bounded flip-condition metrics', () => {
    const analytics = buildKnowledgeAnalytics(generatedGraph(0xfeed, 80, 200));
    expect(analytics.metrics.largestCommunityShare).toBeGreaterThan(0);
    expect(analytics.metrics.largestCommunityShare).toBeLessThanOrEqual(1);
    expect(analytics.metrics.weightedSingletonShare).toBeGreaterThanOrEqual(0);
    expect(analytics.metrics.weightedSingletonShare).toBeLessThanOrEqual(1);
  });

  it('handles the empty and edgeless graphs', () => {
    expect(buildKnowledgeAnalytics({ nodes: [], edges: [] })).toMatchObject({
      godNodes: [],
      communities: [],
      anomalies: [],
      metrics: { nodeCount: 0, edgeCount: 0, communityCount: 0 },
    });
    const edgeless = buildKnowledgeAnalytics({
      nodes: [node('adr:1', 'decision'), node('wiki:1', 'knowledge')],
      edges: [],
    });
    expect(edgeless.communities).toHaveLength(2);
    expect(edgeless.communities.every((community) => community.size === 1)).toBe(true);
    expect(edgeless.godNodes.every((board) => board.entries.length === 0)).toBe(true);
  });
});
