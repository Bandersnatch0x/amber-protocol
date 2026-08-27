import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
  useReactFlow,
} from '@xyflow/react';
import * as d3 from 'd3-force';
import '@xyflow/react/dist/style.css';
import { knowledgeGraphFixture, type KnowledgeGraphDTO, type KnowledgeNode } from './fixture';

const LAYER_COLORS: Record<string, { fill: string; ring: string; badge: string }> = {
  decision: {
    fill: 'bg-white dark:bg-obsidian-surface border-slate-300 dark:border-slate-600',
    ring: '#f59e0b',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  },
  knowledge: {
    fill: 'bg-white dark:bg-obsidian-surface border-slate-300 dark:border-slate-600',
    ring: '#2563eb',
    badge: 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200',
  },
  implementation: {
    fill: 'bg-white dark:bg-obsidian-surface border-slate-300 dark:border-slate-600',
    ring: '#64748b',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

const KIND_LABEL: Record<string, string> = {
  adr: 'ADR',
  artifact: 'Artifact',
  knowledge: 'Wiki',
  memory: 'Memory',
  architecture: 'Architecture',
  feature: 'Feature',
};

type LayoutMode = 'cluster' | 'layered';

interface KnowledgeNodeData extends Record<string, unknown> {
  dto: KnowledgeNode;
  drift: boolean;
  highlight: boolean;
  dimmed: boolean;
  selected: boolean;
}

function computeLayout(
  dto: KnowledgeGraphDTO,
  mode: LayoutMode,
): Map<string, { x: number; y: number }> {
  const nodes = dto.nodes.map((n) => ({ ...n }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const links = dto.edges
    .map((e) => ({ source: e.src, target: e.dst }))
    .filter((l) => index.has(l.source) && index.has(l.target));

  if (mode === 'layered') {
    const positions = new Map<string, { x: number; y: number }>();
    const layers: Record<string, KnowledgeNode[]> = {
      decision: [],
      knowledge: [],
      implementation: [],
    };
    for (const n of nodes) layers[n.layer].push(n);
    const layerY: Record<string, number> = { decision: -360, knowledge: 0, implementation: 360 };
    for (const [layer, items] of Object.entries(layers)) {
      items.forEach((n, i) => {
        const col = i % 12;
        const row = Math.floor(i / 12);
        positions.set(n.id, { x: (col - 5.5) * 190, y: layerY[layer] + row * 110 });
      });
    }
    return positions;
  }

  const simulation = d3
    .forceSimulation(nodes as never[])
    .force(
      'link',
      d3
        .forceLink(links)
        .id((d: never) => (d as KnowledgeNode).id)
        .distance(130)
        .strength(0.35),
    )
    .force('charge', d3.forceManyBody().strength(-320))
    .force('center', d3.forceCenter(0, 0))
    .force(
      'cluster',
      (() => {
        const centroids: Record<string, { x: number; y: number }> = {
          decision: { x: -520, y: -240 },
          knowledge: { x: 320, y: -200 },
          implementation: { x: 0, y: 420 },
        };
        const f = (alpha: number) => {
          for (const n of nodes) {
            const c = centroids[n.layer];
            n.x = (n.x ?? 0) + (c.x - (n.x ?? 0)) * 0.045 * alpha;
            n.y = (n.y ?? 0) + (c.y - (n.y ?? 0)) * 0.045 * alpha;
          }
        };
        return f as unknown as d3.Force<KnowledgeNode, undefined>;
      })(),
    )
    .stop();

  for (let i = 0; i < 300; i += 1) simulation.tick();
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return positions;
}

function FlowCanvas({
  dto,
  layout,
  selectedId,
  onSelect,
  visibleIds,
  searchHits,
  showInferred,
}: {
  dto: KnowledgeGraphDTO;
  layout: Map<string, { x: number; y: number }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleIds: Set<string> | null;
  searchHits: Set<string> | null;
  showInferred: boolean;
}) {
  const driftNodeIds = useMemo(() => new Set(dto.drift.map((d) => d.nodeId)), [dto.drift]);
  const { fitView } = useReactFlow();

  const flowNodes: Node<KnowledgeNodeData>[] = useMemo(
    () =>
      dto.nodes
        .filter((n) => visibleIds === null || visibleIds.has(n.id))
        .map((n) => {
          const pos = layout.get(n.id) ?? { x: 0, y: 0 };
          const isHit = searchHits === null || searchHits.has(n.id);
          return {
            id: n.id,
            position: pos,
            data: {
              dto: n,
              drift: driftNodeIds.has(n.id),
              highlight: searchHits !== null && isHit,
              dimmed: searchHits !== null && !isHit,
              selected: n.id === selectedId,
            },
            type: 'knowledge',
          } satisfies Node<KnowledgeNodeData>;
        }),
    [dto.nodes, layout, driftNodeIds, visibleIds, searchHits, selectedId],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void fitView({ padding: 0.15, duration: 400 }), 60);
    return () => window.clearTimeout(t);
  }, [fitView, visibleIds]);

  const flowEdges: Edge[] = useMemo(() => {
    const nodeIds = new Set(flowNodes.map((n) => n.id));
    return dto.edges
      .filter((e) => showInferred || e.origin !== 'inferred')
      .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.dst))
      .map((e, i) => {
        const connected = selectedId !== null && (e.src === selectedId || e.dst === selectedId);
        return {
          id: `e${i}`,
          source: e.src,
          target: e.dst,
          animated: connected,
          style: {
            stroke: connected ? '#f59e0b' : e.origin === 'inferred' ? '#94a3b8' : '#64748b',
            strokeWidth: connected ? 2 : 1.5,
            strokeDasharray: e.origin === 'inferred' ? '6 4' : undefined,
            opacity: connected ? 1 : 0.75,
          },
          label: e.verb,
          labelStyle: { fill: '#64748b', fontSize: 10 },
          labelBgStyle: { fill: '#f8fafc' },
        };
      });
  }, [dto.edges, flowNodes, showInferred, selectedId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => onSelect(node.id),
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelect(null)}
      minZoom={0.05}
      maxZoom={2}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
}

const nodeTypes = { knowledge: KnowledgeFlowNode };

function KnowledgeFlowNode({ data }: { data: KnowledgeNodeData }) {
  const { dto, drift, highlight, dimmed, selected } = data;
  const c = LAYER_COLORS[dto.layer];
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 min-w-[120px] max-w-[180px] shadow-sm transition-all ${c.fill} ${
        drift
          ? 'ring-2 ring-red-500'
          : selected
            ? 'ring-2 ring-amber-500'
            : highlight
              ? 'ring-2 ring-amber-500/60'
              : ''
      } ${selected ? 'shadow-glow-amber' : ''} ${dimmed ? 'opacity-35' : ''}`}
      style={{ borderLeft: `3px solid ${c.ring}` }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[9px] font-mono uppercase tracking-wide px-1 py-0.5 rounded ${c.badge}`}
        >
          {KIND_LABEL[dto.kind]}
        </span>
        {drift && (
          <span
            className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-300 dark:ring-red-900"
            title="Drift: dead anchor"
          />
        )}
      </div>
      <div className="text-[11px] leading-snug text-slate-800 dark:text-slate-200 mt-1 line-clamp-2 font-medium">
        {dto.title}
      </div>
      <div className="text-[9px] font-mono text-slate-400 mt-0.5">{dto.id}</div>
    </div>
  );
}

export function KnowledgeMapPage() {
  const dto = knowledgeGraphFixture;
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('cluster');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [showInferred, setShowInferred] = useState(true);
  const [showDriftOnly, setShowDriftOnly] = useState(false);

  const layout = useMemo(() => computeLayout(dto, layoutMode), [dto, layoutMode]);

  const selected = useMemo(
    () => (selectedId ? (dto.nodes.find((n) => n.id === selectedId) ?? null) : null),
    [dto.nodes, selectedId],
  );

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      dto.nodes
        .filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.id.toLowerCase().includes(q) ||
            (n.status ?? '').toLowerCase().includes(q),
        )
        .map((n) => n.id),
    );
  }, [dto.nodes, search]);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of dto.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return counts;
  }, [dto.nodes]);

  const driftNodeIds = useMemo(() => new Set(dto.drift.map((d) => d.nodeId)), [dto.drift]);

  const visibleIds = useMemo(() => {
    if (kindFilter.size === 0 && searchHits === null && !showDriftOnly) return null;
    const ids = new Set<string>();
    for (const n of dto.nodes) {
      if (kindFilter.size > 0 && !kindFilter.has(n.kind)) continue;
      if (searchHits !== null && !searchHits.has(n.id)) continue;
      if (showDriftOnly && !driftNodeIds.has(n.id)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [dto.nodes, kindFilter, searchHits, showDriftOnly, driftNodeIds]);

  const visibleCount = visibleIds === null ? dto.nodes.length : visibleIds.size;

  const edgesOf = useCallback(
    (id: string) => ({
      outgoing: dto.edges.filter((e) => e.src === id),
      incoming: dto.edges.filter((e) => e.dst === id),
    }),
    [dto.edges],
  );

  const recentChanges = useMemo(
    () => [
      {
        id: 'r1',
        source: 'git-commit',
        title: 'feat(governance): add Principal registry and Decision artifacts (F050)',
        time: '2026-08-27',
      },
      {
        id: 'r2',
        source: 'adr-date',
        title: 'ADR-0024 Principal registry accepted',
        time: '2026-08-27',
      },
      {
        id: 'r3',
        source: 'feature-list-change',
        title: 'F058 eval suite → passing',
        time: '2026-08-27',
      },
      {
        id: 'r4',
        source: 'git-commit',
        title: 'docs(program): add F049-F057 specs and ADR-0021..0024',
        time: '2026-08-27',
      },
    ],
    [],
  );

  return (
    <div className="page-container">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-headline font-semibold text-slate-900 dark:text-white">
            Knowledge &amp; Decision Map
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {visibleCount}/{dto.nodes.length} nodes · {dto.edges.length} edges · {dto.drift.length}{' '}
            drift findings · deterministic parse of committed artifacts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showInferred}
              onChange={(e) => setShowInferred(e.target.checked)}
              className="accent-amber-500"
            />
            inferred edges
          </label>
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showDriftOnly}
              onChange={(e) => setShowDriftOnly(e.target.checked)}
              className="accent-red-500"
            />
            drift only
          </label>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search nodes by title, id, status..."
              className="flex-1 min-w-[200px] px-3 py-1.5 rounded-md border border-slate-200 dark:border-obsidian-border bg-white dark:bg-obsidian-surface text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
            />
            <div className="flex rounded-md border border-slate-200 dark:border-obsidian-border overflow-hidden">
              {(['cluster', 'layered'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLayoutMode(m)}
                  className={`px-2.5 py-1.5 text-xs transition-colors ${
                    layoutMode === m
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300 font-medium'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-obsidian-surface'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {[...kindCounts.entries()].map(([kind, count]) => {
              const active = kindFilter.size === 0 || kindFilter.has(kind);
              return (
                <button
                  key={kind}
                  onClick={() =>
                    setKindFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    })
                  }
                  className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                    active
                      ? 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
                      : 'border-transparent text-slate-400 dark:text-slate-600 line-through'
                  }`}
                >
                  {KIND_LABEL[kind]} {count}
                </button>
              );
            })}
          </div>

          <div className="card bg-dot-matrix relative" style={{ height: '70vh', minHeight: 480 }}>
            <ReactFlowProvider>
              <FlowCanvas
                dto={dto}
                layout={layout}
                selectedId={selectedId}
                onSelect={setSelectedId}
                visibleIds={visibleIds}
                searchHits={searchHits}
                showInferred={showInferred}
              />
            </ReactFlowProvider>
            <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-obsidian-surface/90 backdrop-blur rounded-md border border-slate-200 dark:border-obsidian-border px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400 space-y-1 pointer-events-none">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm border-l-[3px] border-amber-500" /> decision
                layer (ADR / artifact)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm border-l-[3px] border-blue-600" /> knowledge
                layer (wiki / memory / architecture)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm border-l-[3px] border-slate-500" />{' '}
                implementation layer (features)
              </div>
              <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-700">
                <span className="w-4 border-t-2 border-slate-500 inline-block" /> deterministic ·
                <span className="w-4 border-t-2 border-dashed border-slate-400 inline-block" />{' '}
                inferred
              </div>
            </div>
          </div>
        </div>

        <aside className="w-full lg:w-80 shrink-0 space-y-4">
          {selected ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${LAYER_COLORS[selected.layer].badge}`}
                >
                  {KIND_LABEL[selected.kind]}
                </span>
                {selected.status && (
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {selected.status}
                  </span>
                )}
              </div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                {selected.title}
              </h2>
              <div className="text-[11px] font-mono text-slate-400 mt-1">{selected.id}</div>
              <dl className="mt-3 space-y-1.5 text-[11px]">
                <div className="flex gap-2">
                  <dt className="text-slate-400 w-16 shrink-0">source</dt>
                  <dd className="font-mono text-slate-600 dark:text-slate-300 break-all">
                    {selected.sourcePath}
                  </dd>
                </div>
                {selected.updated && (
                  <div className="flex gap-2">
                    <dt className="text-slate-400 w-16 shrink-0">updated</dt>
                    <dd className="font-mono text-slate-600 dark:text-slate-300">
                      {selected.updated}
                    </dd>
                  </div>
                )}
                {selected.revisions != null && (
                  <div className="flex gap-2">
                    <dt className="text-slate-400 w-16 shrink-0">revisions</dt>
                    <dd className="font-mono text-slate-600 dark:text-slate-300">
                      {selected.revisions} committed
                    </dd>
                  </div>
                )}
              </dl>
              {selected.paths && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                    anchors
                  </div>
                  <ul className="space-y-1">
                    {selected.paths.map((p) => {
                      const dead = dto.drift.some((d) => d.nodeId === selected.id && d.path === p);
                      return (
                        <li
                          key={p}
                          className={`font-mono text-[10px] px-1.5 py-1 rounded border ${
                            dead
                              ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {p}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {(() => {
                const { outgoing, incoming } = edgesOf(selected.id);
                if (!outgoing.length && !incoming.length) return null;
                return (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                      edges
                    </div>
                    <ul className="space-y-1 text-[11px]">
                      {outgoing.map((e, i) => (
                        <li key={`o${i}`} className="text-slate-600 dark:text-slate-300">
                          <span className="font-mono text-amber-600 dark:text-amber-300">
                            {e.verb}
                          </span>{' '}
                          → <span className="font-mono">{e.dst}</span>
                          {e.origin === 'inferred' && (
                            <span
                              className="ml-1 text-[9px] text-slate-400 italic"
                              title={`inferred · ${e.provenance?.model} · prompt ${e.provenance?.promptHash} · ${e.provenance?.timestamp}`}
                            >
                              inferred ({e.provenance?.model})
                            </span>
                          )}
                        </li>
                      ))}
                      {incoming.map((e, i) => (
                        <li key={`i${i}`} className="text-slate-600 dark:text-slate-300">
                          <span className="font-mono">{e.src}</span> →{' '}
                          <span className="font-mono text-amber-600 dark:text-amber-300">
                            {e.verb}
                          </span>
                          {e.origin === 'inferred' && (
                            <span
                              className="ml-1 text-[9px] text-slate-400 italic"
                              title={`inferred · ${e.provenance?.model} · prompt ${e.provenance?.promptHash} · ${e.provenance?.timestamp}`}
                            >
                              inferred ({e.provenance?.model})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="card p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Select a node to inspect its committed source, anchors, and edges.
              </div>
            </div>
          )}

          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              Recent
            </h3>
            <ul className="space-y-1.5">
              {recentChanges.map((r) => (
                <li
                  key={r.id}
                  className="text-[11px] text-slate-600 dark:text-slate-300 flex gap-2"
                >
                  <span className="font-mono text-slate-400 shrink-0">{r.time}</span>
                  <span className="truncate" title={r.title}>
                    {r.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              Drift
            </h3>
            {dto.drift.length === 0 ? (
              <div className="text-[11px] text-slate-500">No drift findings.</div>
            ) : (
              <ul className="space-y-2">
                {dto.drift.map((d) => {
                  const node = dto.nodes.find((n) => n.id === d.nodeId);
                  return (
                    <li key={`${d.nodeId}:${d.path}`} className="text-[11px]">
                      <button
                        onClick={() => setSelectedId(d.nodeId)}
                        className="text-left w-full rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 hover:border-red-300 dark:hover:border-red-700 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          <span className="font-mono text-red-700 dark:text-red-300">
                            {d.nodeId}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-red-600 dark:text-red-400 mt-0.5 break-all">
                          {d.path}
                        </div>
                        <div className="text-slate-600 dark:text-slate-400 mt-0.5">{d.detail}</div>
                        {node && (
                          <div className="text-slate-400 mt-0.5 text-[10px]">{node.title}</div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
