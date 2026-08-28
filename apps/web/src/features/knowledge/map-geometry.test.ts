import { describe, expect, it } from 'vitest';
import {
  MINI_GEOMETRY,
  buildMiniNeighbors,
  clipSegmentToRect,
  computeLayout,
} from './KnowledgeMapPage';
import type { KnowledgeEdgeDTO, KnowledgeGraphDTO, KnowledgeNode } from '@/lib/knowledge-dto';

function node(id: string, layer: KnowledgeNode['layer']): KnowledgeNode {
  return {
    id,
    kind: layer === 'decision' ? 'adr' : layer === 'knowledge' ? 'wiki' : 'feature',
    layer,
    title: id,
    sourcePath: `docs/${id}.md`,
  };
}

function edge(src: string, dst: string, verb: KnowledgeEdgeDTO['verb']): KnowledgeEdgeDTO {
  return { src, dst, verb, origin: 'deterministic', evidence: [{ path: 'docs/x.md', line: 1 }] };
}

function graph(nodes: KnowledgeNode[], edges: KnowledgeEdgeDTO[] = []): KnowledgeGraphDTO {
  return { schemaVersion: '1', nodes, edges, drift: [], recentChanges: [] };
}

describe('computeLayout — layered mode', () => {
  it('never places two nodes at the same point, even when a layer overflows its band', () => {
    // 120 per layer is past the 4-row band the hardcoded offsets used to allow:
    // the 57th node of a layer used to land exactly on the next layer's first row.
    const nodes = [
      ...Array.from({ length: 120 }, (_, i) => node(`adr:${i}`, 'decision')),
      ...Array.from({ length: 120 }, (_, i) => node(`wiki:${i}`, 'knowledge')),
      ...Array.from({ length: 120 }, (_, i) => node(`feature:${i}`, 'implementation')),
    ];

    const positions = computeLayout(graph(nodes), 'layered');

    expect(positions.size).toBe(360);
    const seen = new Set<string>();
    for (const { x, y } of positions.values()) seen.add(`${x}|${y}`);
    expect(seen.size).toBe(360);
  });

  it('keeps the three layer bands vertically disjoint at any size', () => {
    const nodes = [
      ...Array.from({ length: 57 }, (_, i) => node(`adr:${i}`, 'decision')),
      ...Array.from({ length: 200 }, (_, i) => node(`wiki:${i}`, 'knowledge')),
      ...Array.from({ length: 15 }, (_, i) => node(`feature:${i}`, 'implementation')),
    ];

    const positions = computeLayout(graph(nodes), 'layered');
    const bandY = (prefix: string) =>
      [...positions.entries()]
        .filter(([id]) => id.startsWith(prefix))
        .map(([, p]) => p.y)
        .sort((a, b) => a - b);

    const decision = bandY('adr:');
    const knowledge = bandY('wiki:');
    const implementation = bandY('feature:');

    expect(decision[decision.length - 1]).toBeLessThan(knowledge[0]);
    expect(knowledge[knowledge.length - 1]).toBeLessThan(implementation[0]);
  });

  it('returns finite coordinates for an empty graph and a single node', () => {
    expect(computeLayout(graph([]), 'layered').size).toBe(0);
    const single = computeLayout(graph([node('adr:1', 'decision')]), 'layered');
    const point = single.get('adr:1')!;
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('computeLayout — cluster mode', () => {
  it('produces finite coordinates for every node', () => {
    const nodes = Array.from({ length: 40 }, (_, i) =>
      node(`feature:${i}`, i % 2 === 0 ? 'decision' : 'implementation'),
    );
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id, 'references'));

    const positions = computeLayout(graph(nodes, edges), 'cluster');

    expect(positions.size).toBe(40);
    for (const { x, y } of positions.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe('clipSegmentToRect', () => {
  it('lands the endpoint on the target box boundary, never inside it', () => {
    const halfW = 40;
    const halfH = 10;
    const target = { x: 160, y: 14 };

    for (const angle of [0, 0.4, 1.1, 2.0, 3.0, 4.2, 5.5]) {
      const from = { x: target.x + Math.cos(angle) * 200, y: target.y + Math.sin(angle) * 200 };
      const point = clipSegmentToRect(from.x, from.y, target.x, target.y, halfW, halfH);
      const insideX = Math.abs(point.x - target.x) < halfW - 0.001;
      const insideY = Math.abs(point.y - target.y) < halfH - 0.001;
      expect(insideX && insideY).toBe(false);
    }
  });

  it('is a no-op when the endpoints coincide', () => {
    expect(clipSegmentToRect(5, 5, 5, 5, 10, 10)).toEqual({ x: 5, y: 5 });
  });
});

describe('buildMiniNeighbors', () => {
  const center = node('architecture:web-viewer', 'knowledge');
  const other = node('adr:0007', 'decision');
  const nodeById = new Map([center, other].map((n) => [n.id, n]));

  it('merges a bidirectional pair into one neighbour carrying both relations', () => {
    const edges = [
      edge(other.id, center.id, 'supersedes'),
      edge(center.id, other.id, 'references'),
    ];

    const { shown, hidden } = buildMiniNeighbors(edges, center.id, nodeById);

    expect(shown).toHaveLength(1);
    expect(hidden).toBe(0);
    expect(shown[0].relations.map((r) => `${r.dir}:${r.verb}`).sort()).toEqual([
      'in:supersedes',
      'out:references',
    ]);
  });

  it('drops a repeated identical relation but keeps distinct verbs', () => {
    const edges = [
      edge(center.id, other.id, 'references'),
      edge(center.id, other.id, 'references'),
      edge(center.id, other.id, 'builds-on'),
    ];

    const { shown } = buildMiniNeighbors(edges, center.id, nodeById);

    expect(shown[0].relations).toHaveLength(2);
  });

  it('ignores edges whose other end is not in the graph', () => {
    const edges = [edge(center.id, 'feature:missing', 'describes')];
    expect(buildMiniNeighbors(edges, center.id, nodeById).shown).toHaveLength(0);
  });

  it('counts hidden neighbours, not hidden edges, past the visible cut', () => {
    const many = Array.from({ length: 12 }, (_, i) => node(`feature:F${i}`, 'implementation'));
    const map = new Map([center, ...many].map((n) => [n.id, n]));
    const edges = many.flatMap((n) => [
      edge(center.id, n.id, 'describes'),
      edge(n.id, center.id, 'references'),
    ]);

    const { shown, hidden } = buildMiniNeighbors(edges, center.id, map);

    expect(shown).toHaveLength(MINI_GEOMETRY.maxNeighbors);
    expect(hidden).toBe(12 - MINI_GEOMETRY.maxNeighbors);
  });

  it('keeps every satellite box inside the viewBox and clear of its neighbours', () => {
    for (let count = 1; count <= MINI_GEOMETRY.maxNeighbors; count += 1) {
      const others = Array.from({ length: count }, (_, i) => node(`adr:${i}`, 'decision'));
      const map = new Map([center, ...others].map((n) => [n.id, n]));
      const edges = others.map((n) => edge(center.id, n.id, 'references'));

      const { shown } = buildMiniNeighbors(edges, center.id, map);
      const boxes = shown.map((it) => ({
        x0: it.x - MINI_GEOMETRY.satelliteW / 2,
        x1: it.x + MINI_GEOMETRY.satelliteW / 2,
        y0: it.y - MINI_GEOMETRY.satelliteH / 2,
        y1: it.y + MINI_GEOMETRY.satelliteH / 2,
      }));

      for (const box of boxes) {
        expect(box.x0).toBeGreaterThanOrEqual(0);
        expect(box.y0).toBeGreaterThanOrEqual(0);
        expect(box.x1).toBeLessThanOrEqual(MINI_GEOMETRY.viewBoxW);
        expect(box.y1).toBeLessThanOrEqual(MINI_GEOMETRY.viewBoxH);
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const overlapX = Math.min(boxes[i].x1, boxes[j].x1) - Math.max(boxes[i].x0, boxes[j].x0);
          const overlapY = Math.min(boxes[i].y1, boxes[j].y1) - Math.max(boxes[i].y0, boxes[j].y0);
          expect(overlapX > 0 && overlapY > 0).toBe(false);
        }
      }
    }
  });
});
