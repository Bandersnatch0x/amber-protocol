import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { skipToken } from '@tanstack/react-query';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  useReactFlow,
} from '@xyflow/react';
import * as d3 from 'd3-force';
import '@xyflow/react/dist/style.css';
import type {
  GraphLayer,
  KnowledgeAskResultDTO,
  KnowledgeEdgeDTO,
  KnowledgeGraphDTO,
  KnowledgeNode,
  RecentChangeItem,
  SemanticResultDTO,
  NodeSummaryDTO,
  LLMStatusDTO,
} from './types';
import { MAX_CONTEXT_NODES } from '@/lib/knowledge-dto';
import { buildKnowledgeAnalytics, type KnowledgeAnalytics } from './map-analytics';
import {
  FOUNDATION_NODE_ID,
  anomalyKey,
  buildRenderGraph,
  codeNeighbourhoodOf,
  owningFeaturesOf,
  searchKnowledgeNodes,
  type RenderGraph,
  type RenderNode,
} from './map-render-graph';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { MarkdownMessage } from '@/components/code/MarkdownMessage';

const LAYER_COLORS: Record<string, { dot: string; badge: string; stroke: string }> = {
  decision: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    stroke: '#f59e0b',
  },
  knowledge: {
    dot: 'bg-cobalt',
    badge: 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200',
    stroke: '#2563EB',
  },
  implementation: {
    dot: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    stroke: '#64748b',
  },
};

// Real ADR statuses carry trailing notes ("Accepted (2026-08-26)"), so the
// leading word decides, not the whole string.
const HEALTHY_STATUS_PREFIXES = ['accepted', 'passing', 'committed'];

function statusDotClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  return HEALTHY_STATUS_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? 'bg-emerald-500'
    : 'bg-slate-400';
}

const KIND_LABEL_KEYS: Record<string, I18nKey> = {
  adr: 'knowledge.kind.adr',
  artifact: 'knowledge.kind.artifact',
  wiki: 'knowledge.kind.wiki',
  memory: 'knowledge.kind.memory',
  architecture: 'knowledge.kind.architecture',
  feature: 'knowledge.kind.feature',
  code: 'knowledge.kind.code',
  foundation: 'knowledge.kind.foundation',
};

type LayoutMode = 'cluster' | 'layered';

interface KnowledgeNodeData extends Record<string, unknown> {
  node: RenderNode;
  drift: boolean;
  highlight: boolean;
  dimmed: boolean;
  selected: boolean;
  neighbor: boolean;
  godNode: boolean;
  communityId: string | null;
  /** Feature affordance: live anchored-code count (0 hides the chip). */
  anchorsCount: number;
  expanded: boolean;
  onToggleExpand: ((featureId: string) => void) | null;
}

const LAYER_ORDER = ['decision', 'knowledge', 'implementation'] as const;
const LAYERED_COLUMNS = 14;
const LAYERED_COLUMN_WIDTH = 200;
const LAYERED_ROW_HEIGHT = 120;

interface LayoutInput {
  nodes: ReadonlyArray<{ id: string; layer: GraphLayer }>;
  edges: ReadonlyArray<{ src: string; dst: string }>;
}

type SimNode = { id: string; layer: GraphLayer } & d3.SimulationNodeDatum;
type SimLink = { source: string; target: string };

export function computeLayout(
  dto: LayoutInput,
  mode: LayoutMode,
): Map<string, { x: number; y: number }> {
  const nodes: SimNode[] = dto.nodes.map((n) => ({ id: n.id, layer: n.layer }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = dto.edges
    .map((e) => ({ source: e.src, target: e.dst }))
    .filter((l) => index.has(l.source) && index.has(l.target));

  if (mode === 'layered') {
    const positions = new Map<string, { x: number; y: number }>();
    const layers: Record<string, SimNode[]> = {
      decision: [],
      knowledge: [],
      implementation: [],
    };
    for (const n of nodes) layers[n.layer].push(n);
    let bandTop = 0;
    for (const layer of LAYER_ORDER) {
      const items = layers[layer];
      items.forEach((n, i) => {
        const col = i % LAYERED_COLUMNS;
        const row = Math.floor(i / LAYERED_COLUMNS);
        positions.set(n.id, {
          x: (col - (LAYERED_COLUMNS - 1) / 2) * LAYERED_COLUMN_WIDTH,
          y: bandTop + row * LAYERED_ROW_HEIGHT,
        });
      });
      const rows = Math.ceil(items.length / LAYERED_COLUMNS);
      bandTop += (rows + 1) * LAYERED_ROW_HEIGHT;
    }
    return positions;
  }

  const centroids: Record<string, { x: number; y: number }> = {
    decision: { x: -560, y: -280 },
    knowledge: { x: 400, y: -220 },
    implementation: { x: 0, y: 460 },
  };
  const clusterForce: d3.Force<SimNode, undefined> = (alpha) => {
    for (const n of nodes) {
      const c = centroids[n.layer];
      n.x = (n.x ?? 0) + (c.x - (n.x ?? 0)) * 0.05 * alpha;
      n.y = (n.y ?? 0) + (c.y - (n.y ?? 0)) * 0.05 * alpha;
    }
  };

  const simulation = d3
    .forceSimulation<SimNode>(nodes)
    .force(
      'link',
      d3
        .forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(170)
        .strength(0.4),
    )
    .force('charge', d3.forceManyBody<SimNode>().strength(-420))
    .force('collide', d3.forceCollide<SimNode>(108))
    .force('center', d3.forceCenter<SimNode>(0, 0))
    .force('cluster', clusterForce)
    .stop();

  for (let i = 0; i < 320; i += 1) simulation.tick();
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return positions;
}

function neighborIdsOf(
  edges: ReadonlyArray<{ src: string; dst: string }>,
  id: string,
): Set<string> {
  const ids = new Set<string>([id]);
  for (const e of edges) {
    if (e.src === id) ids.add(e.dst);
    if (e.dst === id) ids.add(e.src);
  }
  return ids;
}

const KIND_LOCAL_TARGET: Record<string, RecentChangeItem['linkTo']> = {
  feature: 'gates',
  adr: 'governance',
  artifact: 'governance',
  wiki: 'governance',
};

function LocalJumpLink({
  linkTo,
  linkId,
  label,
  children,
}: {
  linkTo: RecentChangeItem['linkTo'];
  linkId?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const cls =
    'inline-flex items-center gap-1 rounded border border-amber-300/70 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors';
  if (linkTo === 'sessions' && linkId) {
    return (
      <Link
        to="/sessions/$id"
        params={{ id: linkId }}
        className={cls}
        title={label}
        data-link-to={linkTo}
        data-link-id={linkId}
      >
        {children}
      </Link>
    );
  }
  if (linkTo === 'transcripts' && linkId) {
    return (
      <Link
        to="/transcripts/$id"
        params={{ id: linkId }}
        className={cls}
        title={label}
        data-link-to={linkTo}
        data-link-id={linkId}
      >
        {children}
      </Link>
    );
  }
  if (linkTo === 'routes' && linkId) {
    return (
      <Link
        to="/routes/$id"
        params={{ id: linkId }}
        className={cls}
        title={label}
        data-link-to={linkTo}
        data-link-id={linkId}
      >
        {children}
      </Link>
    );
  }
  if (linkTo === 'gates') {
    return (
      <Link to="/gates" className={cls} title={label} data-link-to={linkTo} data-link-id={linkId}>
        {children}
      </Link>
    );
  }
  if (linkTo === 'governance') {
    return (
      <Link
        to="/governance"
        search={linkId ? { featureId: linkId } : {}}
        className={cls}
        title={label}
        data-link-to={linkTo}
        data-link-id={linkId}
      >
        {children}
      </Link>
    );
  }
  return null;
}

const MINI_CX = 160;
const MINI_CY = 84;
const MINI_RX = 116;
const MINI_RY = 70;
const MINI_MAX_NEIGHBORS = 8;
const MINI_CENTER_W = 116;
const MINI_CENTER_H = 24;
const MINI_SATELLITE_W = 80;
const MINI_SATELLITE_H = 20;

interface MiniRelation {
  verb: string;
  dir: 'out' | 'in';
  inferred: boolean;
}

interface MiniNeighbor {
  other: KnowledgeNode;
  relations: MiniRelation[];
  x: number;
  y: number;
}

export const MINI_GEOMETRY = {
  cx: MINI_CX,
  cy: MINI_CY,
  rx: MINI_RX,
  ry: MINI_RY,
  maxNeighbors: MINI_MAX_NEIGHBORS,
  centerW: MINI_CENTER_W,
  centerH: MINI_CENTER_H,
  satelliteW: MINI_SATELLITE_W,
  satelliteH: MINI_SATELLITE_H,
  viewBoxW: 320,
  viewBoxH: 168,
} as const;

export function clipSegmentToRect(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  halfW: number,
  halfH: number,
): { x: number; y: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return { x: toX, y: toY };
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY, 1);
  return { x: toX - dx * scale, y: toY - dy * scale };
}

export function buildMiniNeighbors(
  edges: KnowledgeEdgeDTO[],
  centerId: string,
  nodeById: Map<string, KnowledgeNode>,
): { shown: MiniNeighbor[]; hidden: number; cx: number; cy: number } {
  const byNeighbor = new Map<string, MiniNeighbor>();
  for (const e of edges) {
    const isOut = e.src === centerId && nodeById.has(e.dst);
    const isIn = e.dst === centerId && nodeById.has(e.src);
    if (!isOut && !isIn) continue;
    const other = nodeById.get(isOut ? e.dst : e.src)!;
    const relation = {
      verb: e.verb,
      dir: isOut ? ('out' as const) : ('in' as const),
      inferred: e.origin === 'inferred',
    };
    const existing = byNeighbor.get(other.id);
    if (existing) {
      const duplicate = existing.relations.some(
        (r) => r.verb === relation.verb && r.dir === relation.dir,
      );
      if (!duplicate) existing.relations.push(relation);
      continue;
    }
    byNeighbor.set(other.id, { other, relations: [relation], x: 0, y: 0 });
  }
  const all = [...byNeighbor.values()];
  const shown = all.slice(0, MINI_MAX_NEIGHBORS);
  const hidden = all.length - shown.length;
  shown.forEach((it, i) => {
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
    it.x = MINI_CX + MINI_RX * Math.cos(angle);
    it.y = MINI_CY + MINI_RY * Math.sin(angle);
  });
  return { shown, hidden, cx: MINI_CX, cy: MINI_CY };
}

function MiniContextGraph({
  dto,
  centerId,
  nodeById,
  onSelect,
}: {
  dto: KnowledgeGraphDTO;
  centerId: string;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const center = nodeById.get(centerId);
  const items = useMemo(
    () => buildMiniNeighbors(dto.edges, centerId, nodeById),
    [dto.edges, centerId, nodeById],
  );

  if (!center) return null;
  if (items.shown.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
        {t('knowledge.contextGraph')}
      </div>
      <svg
        viewBox={`0 0 ${MINI_GEOMETRY.viewBoxW} ${MINI_GEOMETRY.viewBoxH}`}
        className="w-full h-auto rounded-md border border-slate-200 dark:border-obsidian-border bg-slate-50 dark:bg-obsidian-surface"
        role="img"
        aria-label={t('knowledge.contextGraph')}
      >
        <defs>
          <marker
            id="mini-arrow"
            viewBox="0 0 8 8"
            refX={7}
            refY={4}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-slate-400" />
          </marker>
        </defs>
        {items.shown.flatMap((it) =>
          it.relations.map((rel, relIndex) => {
            const outgoing = rel.dir === 'out';
            const sx = outgoing ? items.cx : it.x;
            const sy = outgoing ? items.cy : it.y;
            const ex = outgoing ? it.x : items.cx;
            const ey = outgoing ? it.y : items.cy;
            const targetHalfW = (outgoing ? MINI_SATELLITE_W : MINI_CENTER_W) / 2;
            const targetHalfH = (outgoing ? MINI_SATELLITE_H : MINI_CENTER_H) / 2;
            const sourceHalfW = (outgoing ? MINI_CENTER_W : MINI_SATELLITE_W) / 2;
            const sourceHalfH = (outgoing ? MINI_CENTER_H : MINI_SATELLITE_H) / 2;
            const spread = (relIndex - (it.relations.length - 1) / 2) * 7;
            const baseX = it.x - items.cx;
            const baseY = it.y - items.cy;
            const len = Math.hypot(baseX, baseY) || 1;
            const offX = (-baseY / len) * spread;
            const offY = (baseX / len) * spread;
            const head = clipSegmentToRect(
              sx + offX,
              sy + offY,
              ex + offX,
              ey + offY,
              targetHalfW,
              targetHalfH,
            );
            const tail = clipSegmentToRect(
              ex + offX,
              ey + offY,
              sx + offX,
              sy + offY,
              sourceHalfW,
              sourceHalfH,
            );
            const midX = (tail.x + head.x) / 2;
            const midY = (tail.y + head.y) / 2;
            const labelY = midY - 3 + (relIndex - (it.relations.length - 1) / 2) * 11;
            return (
              <g key={`${rel.dir}:${it.other.id}:${rel.verb}`}>
                <line
                  x1={tail.x}
                  y1={tail.y}
                  x2={head.x}
                  y2={head.y}
                  className={rel.inferred ? 'stroke-slate-400' : 'stroke-slate-500'}
                  strokeWidth={1.2}
                  strokeDasharray={rel.inferred ? '4 3' : undefined}
                  markerEnd="url(#mini-arrow)"
                />
                <text
                  x={midX}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={8}
                  className="fill-amber-700 dark:fill-amber-300"
                >
                  {rel.verb}
                </text>
              </g>
            );
          }),
        )}
        <g>
          <rect
            x={items.cx - MINI_CENTER_W / 2}
            y={items.cy - MINI_CENTER_H / 2}
            width={MINI_CENTER_W}
            height={MINI_CENTER_H}
            rx={6}
            className="fill-amber-100 dark:fill-amber-950/60"
            stroke="#f59e0b"
            strokeWidth={1.4}
          />
          <text
            x={items.cx}
            y={items.cy + 3}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={600}
            className="fill-amber-900 dark:fill-amber-200"
          >
            {center.title.length > 24 ? `${center.title.slice(0, 23)}…` : center.title}
          </text>
        </g>
        {items.shown.map((it) => {
          const c = LAYER_COLORS[it.other.layer];
          const label =
            it.other.title.length > 17 ? `${it.other.title.slice(0, 16)}…` : it.other.title;
          const relationSummary = it.relations
            .map((r) => (r.dir === 'out' ? `→ ${r.verb}` : `← ${r.verb}`))
            .join(', ');
          return (
            <g
              key={`node:${it.other.id}`}
              onClick={() => onSelect(it.other.id)}
              className="cursor-pointer"
            >
              <title>{`${it.other.title} (${relationSummary})`}</title>
              <rect
                x={it.x - MINI_SATELLITE_W / 2}
                y={it.y - MINI_SATELLITE_H / 2}
                width={MINI_SATELLITE_W}
                height={MINI_SATELLITE_H}
                rx={5}
                className="fill-white dark:fill-obsidian-elevated"
                stroke={c.stroke}
                strokeWidth={1.2}
              />
              <text
                x={it.x}
                y={it.y + 3}
                textAnchor="middle"
                fontSize={8.5}
                className="fill-slate-700 dark:fill-slate-200"
              >
                {label}
              </text>
            </g>
          );
        })}
        {items.hidden > 0 && (
          <text x={4} y={12} textAnchor="start" fontSize={8.5} className="fill-slate-400">
            +{items.hidden}
          </text>
        )}
      </svg>
    </div>
  );
}

function FlowCanvas({
  graph,
  layout,
  selectedId,
  hoverId,
  onSelect,
  onHover,
  visibleIds,
  searchHits,
  showInferred,
  driftNodeIds,
  godNodeIds,
  communityOf,
  anchorsCountByFeature,
  expandedFeatures,
  onToggleExpand,
}: {
  graph: RenderGraph;
  layout: Map<string, { x: number; y: number }>;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  visibleIds: Set<string> | null;
  searchHits: Set<string> | null;
  showInferred: boolean;
  driftNodeIds: Set<string>;
  godNodeIds: Set<string>;
  communityOf: Record<string, string>;
  anchorsCountByFeature: Map<string, number>;
  expandedFeatures: ReadonlySet<string>;
  onToggleExpand: (featureId: string) => void;
}) {
  const { fitView } = useReactFlow();
  const activeId = hoverId ?? selectedId;
  const activeNeighbors = useMemo(
    () => (activeId ? neighborIdsOf(graph.edges, activeId) : null),
    [graph.edges, activeId],
  );

  // Session-scoped drag (ticket #265): native xyflow drag, positions live in
  // React state only; a layout change or refresh returns to the
  // deterministic layout. Nothing is persisted.
  const [dragOverrides, setDragOverrides] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const [dragLayout, setDragLayout] = useState(layout);
  if (dragLayout !== layout) {
    setDragLayout(layout);
    setDragOverrides(new Map());
  }
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDragOverrides((previous) => {
      let next: Map<string, { x: number; y: number }> | null = null;
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        if (!next) next = new Map(previous);
        next.set(change.id, change.position);
      }
      return next ?? previous;
    });
  }, []);

  const flowNodes: Node<KnowledgeNodeData>[] = useMemo(
    () =>
      graph.nodes
        .filter((n) => visibleIds === null || visibleIds.has(n.id))
        .map((n) => {
          const pos = dragOverrides.get(n.id) ?? layout.get(n.id) ?? { x: 0, y: 0 };
          const isHit = searchHits === null || searchHits.has(n.id);
          const isActiveNeighbor = activeNeighbors?.has(n.id) ?? false;
          const outsideActive = activeNeighbors !== null && !isActiveNeighbor;
          return {
            id: n.id,
            position: pos,
            data: {
              node: n,
              drift: driftNodeIds.has(n.id),
              highlight: searchHits !== null && isHit,
              dimmed: (searchHits !== null && !isHit) || outsideActive,
              selected: n.id === selectedId,
              neighbor: activeNeighbors !== null && isActiveNeighbor && n.id !== activeId,
              godNode: godNodeIds.has(n.id),
              communityId: communityOf[n.id] ?? null,
              anchorsCount: n.kind === 'feature' ? (anchorsCountByFeature.get(n.id) ?? 0) : 0,
              expanded: expandedFeatures.has(n.id),
              onToggleExpand: n.kind === 'feature' ? onToggleExpand : null,
            },
            type: 'knowledge',
          } satisfies Node<KnowledgeNodeData>;
        }),
    [
      graph.nodes,
      layout,
      dragOverrides,
      driftNodeIds,
      visibleIds,
      searchHits,
      selectedId,
      activeNeighbors,
      activeId,
      godNodeIds,
      communityOf,
      anchorsCountByFeature,
      expandedFeatures,
      onToggleExpand,
    ],
  );

  const visibleKey = useMemo(() => graph.nodes.map((n) => n.id).join('|'), [graph.nodes]);
  useEffect(() => {
    const t = window.setTimeout(() => void fitView({ padding: 0.15, duration: 400 }), 60);
    return () => window.clearTimeout(t);
  }, [fitView, visibleIds, visibleKey]);

  const flowEdges: Edge[] = useMemo(() => {
    const nodeIds = new Set(flowNodes.map((n) => n.id));
    return graph.edges
      .filter((e) => showInferred || e.origin !== 'inferred')
      .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.dst))
      .map((e) => {
        const connected = activeId !== null && (e.src === activeId || e.dst === activeId);
        const stroke = connected
          ? '#f59e0b'
          : e.anomalous
            ? '#8b5cf6'
            : e.origin === 'inferred'
              ? '#94a3b8'
              : '#7c8da4';
        return {
          id: e.id,
          source: e.src,
          target: e.dst,
          className: e.origin === 'inferred' ? 'knowledge-edge-inferred' : undefined,
          animated: connected,
          style: {
            stroke,
            strokeWidth: connected ? 2.4 : e.anomalous ? 2 : 1.6,
            strokeDasharray: e.origin === 'inferred' ? '6 4' : e.aggregated ? '3 3' : undefined,
            opacity: connected ? 1 : 0.7,
          },
          label: connected ? e.verb : undefined,
          labelStyle: { fill: '#b45309', fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#fde68a' },
          labelBgPadding: [3, 1] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 14,
            height: 14,
          },
        };
      });
  }, [graph.edges, flowNodes, showInferred, activeId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => onSelect(node.id),
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeMouseEnter={(_e, node) => onHover(node.id)}
      onNodeMouseLeave={() => onHover(null)}
      onPaneClick={() => onSelect(null)}
      minZoom={0.05}
      maxZoom={2}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
}

const nodeTypes = { knowledge: KnowledgeFlowNode };

function EdgeRow({
  edge,
  otherId,
  nodeById,
  onSelect,
  incoming = false,
}: {
  edge: KnowledgeEdgeDTO;
  otherId: string;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
  incoming?: boolean;
}) {
  const { t } = useI18n();
  const other = nodeById.get(otherId);
  const verb = (
    <span className="font-mono text-[9px] uppercase text-amber-600 dark:text-amber-300 shrink-0">
      {incoming ? '←' : '→'} {edge.verb}
    </span>
  );
  return (
    <li>
      <button
        onClick={() => onSelect(otherId)}
        className="w-full text-left rounded-md border border-slate-200 dark:border-obsidian-border px-2 py-1.5 hover:border-amber-300 dark:hover:border-amber-700/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {verb}
          <span className="text-slate-700 dark:text-slate-200 truncate">
            {other?.title ?? otherId}
          </span>
        </div>
        {edge.origin === 'inferred' && (
          <span
            className="ml-0.5 text-[9px] text-slate-400 italic"
            title={t('knowledge.inferredTooltip', {
              model: `${edge.provenance?.provider}/${edge.provenance?.model}`,
              hash: edge.provenance?.promptHash ?? '',
              time: edge.provenance?.timestamp ?? '',
            })}
          >
            {t('knowledge.inferredLabel')} ({edge.provenance?.provider}/{edge.provenance?.model})
          </span>
        )}
      </button>
    </li>
  );
}

function KnowledgeFlowNode({ data }: { data: KnowledgeNodeData }) {
  const {
    node,
    drift,
    highlight,
    dimmed,
    selected,
    neighbor,
    godNode,
    communityId,
    anchorsCount,
    expanded,
    onToggleExpand,
  } = data;
  const { t } = useI18n();
  const c = LAYER_COLORS[node.layer];
  const active = selected || neighbor;
  const isFoundation = node.kind === 'foundation';
  const status = node.dto?.status;
  return (
    <div
      data-testid={`knowledge-node-${node.id}`}
      className={`group rounded-lg border px-2.5 py-2 min-w-[128px] max-w-[190px] shadow-sm transition-all duration-150
        ${isFoundation ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-800' : 'bg-white dark:bg-obsidian-elevated'}
        ${selected ? 'border-amber-400 dark:border-amber-600 shadow-glow-amber' : isFoundation ? '' : 'border-slate-200 dark:border-obsidian-border'}
        ${neighbor ? 'border-amber-300/70 dark:border-amber-700/60' : ''}
        ${drift ? 'ring-2 ring-red-500' : highlight ? 'ring-2 ring-amber-500/60' : ''}
        ${dimmed ? 'opacity-30' : 'hover:-translate-y-0.5 hover:shadow-md'}
        ${active && !dimmed ? 'shadow-md' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-400 dark:!bg-slate-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-400 dark:!bg-slate-500"
      />
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span
          className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${
            isFoundation
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
              : c.badge
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isFoundation ? 'bg-violet-500' : c.dot}`} />
          {t(KIND_LABEL_KEYS[node.kind])}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          {godNode && (
            <span
              data-testid="god-node-badge"
              title={t('knowledge.godNode.tooltip')}
              className="text-[8px] font-mono uppercase px-1 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200"
            >
              ▲ {t('knowledge.godNode.badge')}
            </span>
          )}
          {drift ? (
            <span className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-300 dark:ring-red-900 shrink-0" />
          ) : status ? (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(status)}`} />
          ) : null}
        </span>
      </div>
      <div className="text-[11px] leading-snug text-slate-800 dark:text-slate-200 line-clamp-2 font-medium">
        {node.title}
      </div>
      {isFoundation ? (
        <div className="text-[9px] font-mono text-violet-600 dark:text-violet-300 mt-1">
          {t('knowledge.foundation.members', { count: node.memberIds?.length ?? 0 })}
        </div>
      ) : (
        <div className="text-[9px] font-mono text-slate-400 mt-1 truncate">{node.id}</div>
      )}
      <div className="flex items-center gap-1 mt-1">
        {communityId && (
          <span className="text-[8px] font-mono px-1 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {communityId}
          </span>
        )}
        {anchorsCount > 0 && onToggleExpand && (
          <button
            type="button"
            data-testid={`expand-toggle-${node.id}`}
            title={t('knowledge.fold.anchorsChip', { count: anchorsCount })}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.id);
            }}
            className={`text-[8px] font-mono px-1 py-0.5 rounded border transition-colors ${
              expanded
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-emerald-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            ⚓ {anchorsCount} {expanded ? '▾' : '▸'}
          </button>
        )}
      </div>
    </div>
  );
}

function KnowledgeAskForm({
  question,
  onQuestionChange,
  onSubmit,
  focusNode,
  isFetching,
  nodeCount,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  focusNode: KnowledgeNode | null;
  isFetching: boolean;
  nodeCount: number;
}) {
  const { t } = useI18n();
  const overCap = !focusNode && nodeCount > MAX_CONTEXT_NODES;
  return (
    <form className="mt-3 space-y-3" onSubmit={onSubmit}>
      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-200">
        {t('knowledge.ask.questionLabel')}
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={t('knowledge.ask.placeholder')}
          maxLength={2_000}
          rows={4}
          className="mt-1 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-obsidian-border dark:bg-obsidian-surface dark:text-slate-200"
        />
      </label>
      <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-[10px] text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
        {t('knowledge.ask.disclosure')}
      </div>
      <div
        className={
          overCap
            ? 'text-[10px] text-amber-700 dark:text-amber-300'
            : 'text-[10px] text-slate-500 dark:text-slate-400'
        }
      >
        {overCap
          ? t('knowledge.ask.overCap', { nodes: nodeCount, cap: MAX_CONTEXT_NODES })
          : focusNode
            ? t('knowledge.ask.focus', { id: focusNode.id })
            : t('knowledge.ask.noFocus')}
      </div>
      <button
        type="submit"
        disabled={isFetching || question.trim().length === 0}
        className="btn-secondary w-full text-xs disabled:opacity-50"
      >
        {isFetching ? t('knowledge.ask.loading') : t('knowledge.ask.submit')}
      </button>
    </form>
  );
}

function KnowledgeAskStatus({
  result,
  errorCode,
}: {
  result: KnowledgeAskResultDTO | undefined;
  errorCode: string | null;
}) {
  const { t } = useI18n();
  const errorMessage = errorCode?.includes('context-overflow')
    ? t('knowledge.ask.overflow')
    : errorCode?.includes('uncitable-answer')
      ? t('knowledge.ask.uncitable')
      : errorCode?.includes('invalid-focus-node')
        ? t('knowledge.ask.invalidFocus')
        : errorCode
          ? t('knowledge.ask.error')
          : null;
  if (result?.status === 'unavailable') {
    return (
      <div role="status" className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {result.reason === 'invalid-config'
          ? t('knowledge.ask.invalidConfig')
          : t('knowledge.ask.unavailable')}
      </div>
    );
  }
  return errorMessage ? (
    <div role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">
      {errorMessage}
    </div>
  ) : null;
}

function KnowledgeCitation({
  citation,
  supersederIds,
  nodeById,
  onSelect,
}: {
  citation: string;
  supersederIds: string[];
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(citation)}
        data-testid={`knowledge-citation-${citation}`}
        className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        title={nodeById.get(citation)?.title}
      >
        {citation}
      </button>
      {supersederIds.length > 0 && (
        <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {t('knowledge.ask.superseded')}
        </span>
      )}
      {supersederIds.map((supersederId) => (
        <button
          key={supersederId}
          type="button"
          onClick={() => onSelect(supersederId)}
          className="text-[9px] text-blue-700 underline hover:text-blue-800 dark:text-blue-300"
        >
          {t('knowledge.ask.supersededBy', { id: supersederId })}
        </button>
      ))}
    </span>
  );
}

function KnowledgeAskAnswer({
  result,
  nodeById,
  onSelect,
}: {
  result: Extract<KnowledgeAskResultDTO, { status: 'ok' }>;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 space-y-3" data-testid="knowledge-ask-answer">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {t('knowledge.ask.result')}
      </div>
      <div className="rounded-md bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600 dark:bg-obsidian-surface dark:text-slate-300">
        <div data-testid="knowledge-ask-submitted-question">
          {t('knowledge.ask.submittedQuestion', { question: result.request.question })}
        </div>
        <div data-testid="knowledge-ask-submitted-focus">
          {result.request.focusNodeId
            ? t('knowledge.ask.submittedFocus', { id: result.request.focusNodeId })
            : t('knowledge.ask.submittedNoFocus')}
        </div>
      </div>
      {result.answer.segments.map((segment, index) => (
        <div
          key={`${index}:${segment.text}`}
          className="rounded-md border border-slate-200 p-2.5 dark:border-obsidian-border"
        >
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
            {segment.text}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('knowledge.ask.citations')}>
            {segment.citations.map((citation) => (
              <KnowledgeCitation
                key={citation}
                citation={citation}
                supersederIds={result.supersededBy[citation] ?? []}
                nodeById={nodeById}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
      {result.omittedCount > 0 && (
        <div role="status" className="text-[10px] text-amber-700 dark:text-amber-300">
          {t('knowledge.ask.omitted', { count: result.omittedCount })}
        </div>
      )}
    </div>
  );
}

function KnowledgeAskPanel({
  question,
  onQuestionChange,
  onSubmit,
  focusNode,
  result,
  isFetching,
  errorCode,
  nodeById,
  onSelect,
  nodeCount,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  focusNode: KnowledgeNode | null;
  result: KnowledgeAskResultDTO | undefined;
  isFetching: boolean;
  errorCode: string | null;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
  nodeCount: number;
}) {
  const { t } = useI18n();
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="knowledge-ask-panel">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('knowledge.ask.title')}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.ask.description')}
      </p>
      <KnowledgeAskForm
        question={question}
        onQuestionChange={onQuestionChange}
        onSubmit={onSubmit}
        focusNode={focusNode}
        isFetching={isFetching}
        nodeCount={nodeCount}
      />
      <KnowledgeAskStatus result={result} errorCode={errorCode} />
      {result?.status === 'ok' && (
        <KnowledgeAskAnswer result={result} nodeById={nodeById} onSelect={onSelect} />
      )}
    </div>
  );
}

function KnowledgeAnalyticsPanel({
  analytics,
  nodeById,
  onSelect,
}: {
  analytics: KnowledgeAnalytics;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const percent = (value: number) => Math.round(value * 1000) / 10;
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="knowledge-analytics-report">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('knowledge.analytics.title')}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.analytics.description')}
      </p>
      <p className="mt-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
        {t('knowledge.analytics.metrics', {
          nodes: analytics.metrics.nodeCount,
          edges: analytics.metrics.edgeCount,
          communities: analytics.metrics.communityCount,
          largest: percent(analytics.metrics.largestCommunityShare),
          singleton: percent(analytics.metrics.weightedSingletonShare),
        })}
      </p>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.godNodes')}
        </div>
        {analytics.godNodes.map((board) => (
          <div key={board.layer} className="mb-2">
            <div className="text-[10px] font-mono text-slate-400">
              {board.layer} · p99 = {board.threshold}
            </div>
            <ul className="mt-1 space-y-1">
              {board.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    className="w-full text-left rounded border border-slate-200 dark:border-obsidian-border px-2 py-1 hover:border-fuchsia-300 dark:hover:border-fuchsia-800 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                      {entry.id}
                    </span>
                    <span className="ml-1.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                      {t('knowledge.analytics.godNodeRow', {
                        degree: entry.degree,
                        inDegree: entry.inDegree,
                        outDegree: entry.outDegree,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.communities')}
        </div>
        <ul className="space-y-1">
          {analytics.communities.slice(0, 8).map((community) => (
            <li
              key={community.id}
              className="text-[10px] font-mono text-slate-600 dark:text-slate-300"
            >
              {t('knowledge.analytics.communityRow', {
                id: community.id,
                size: community.size,
                sample: nodeById.get(community.members[0])?.title ?? community.members[0],
              })}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.anomalies')}
        </div>
        <p className="text-[10px] text-slate-400 mb-1.5">{t('knowledge.analytics.neutral')}</p>
        {analytics.anomalies.length === 0 ? (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('knowledge.analytics.anomaliesEmpty')}
          </div>
        ) : (
          <ul className="space-y-1">
            {analytics.anomalies.map((mark) => (
              <li key={`${mark.src}:${mark.verb}:${mark.dst}:${mark.reason}`}>
                <button
                  type="button"
                  onClick={() => onSelect(mark.src)}
                  className="w-full text-left rounded border border-violet-200 dark:border-violet-900/60 px-2 py-1 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
                >
                  <div className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                    {mark.src} -[{mark.verb}]→ {mark.dst}
                  </div>
                  <div className="text-[9px] text-violet-700 dark:text-violet-300">
                    {t(`knowledge.analytics.reason.${mark.reason}` as I18nKey)} · {mark.detail}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FoundationDetailPanel({
  memberIds,
  nodeById,
  inDegreeP99,
  onSelect,
}: {
  memberIds: string[];
  nodeById: Map<string, KnowledgeNode>;
  inDegreeP99: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="foundation-detail-panel">
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
        {t('knowledge.kind.foundation')}
      </span>
      <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white leading-snug">
        {t('knowledge.foundation.members', { count: memberIds.length })}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.foundation.description')} (p99 = {inDegreeP99})
      </p>
      <ul className="mt-3 space-y-1">
        {memberIds.map((memberId) => (
          <li key={memberId}>
            <button
              type="button"
              data-testid={`foundation-member-${memberId}`}
              onClick={() => onSelect(memberId)}
              className="w-full text-left rounded-md border border-slate-200 dark:border-obsidian-border px-2 py-1.5 hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
            >
              <span className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                {nodeById.get(memberId)?.sourcePath ?? memberId}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeMapPage() {
  const [semanticRequested, setSemanticRequested] = useState(false);
  const {
    data: dto,
    isLoading,
    error,
    refetch,
  } = trpc.knowledge.graph.useQuery(undefined, {
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });
  const recentQuery = trpc.knowledge.recentChanges.useQuery(undefined, {
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  const semanticStatusQuery = trpc.knowledge.semanticStatus.useQuery(undefined, {
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });
  const semanticQuery = trpc.knowledge.semantic.useQuery(undefined, {
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
    enabled: semanticRequested && semanticStatusQuery.data?.available === true,
  });
  const { t } = useI18n();

  const requestSemanticAnalysis = () => {
    if (semanticRequested) {
      void semanticQuery.refetch();
      return;
    }
    setSemanticRequested(true);
  };

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="page-container flex items-center justify-center min-h-[60vh]"
      >
        <div className="text-sm text-slate-500 dark:text-slate-400 animate-pulse">
          {t('knowledge.loading')}
        </div>
      </div>
    );
  }

  if (error || !dto) {
    return (
      <div role="alert" className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="card p-6 max-w-md text-center space-y-3">
          <div className="text-sm font-medium text-red-700 dark:text-red-300">
            {t('knowledge.errorTitle')}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">
            {error?.message ?? t('knowledge.errorUnknown')}
          </div>
          <div className="flex justify-center gap-3 pt-1">
            <button type="button" onClick={() => void refetch()} className="btn-secondary text-sm">
              {t('common.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <KnowledgeMapGraph
      dto={dto}
      recentChanges={recentQuery.data ?? []}
      recentError={recentQuery.error?.message ?? null}
      recentIsFetching={recentQuery.isFetching}
      recentIsLoading={recentQuery.isLoading}
      onRefreshRecent={() => void recentQuery.refetch()}
      semanticStatus={semanticStatusQuery.data ?? null}
      semanticStatusError={semanticStatusQuery.error ? true : false}
      semanticResult={semanticQuery.data ?? null}
      semanticTransportError={semanticQuery.error ? true : false}
      semanticRequested={semanticRequested}
      semanticLoading={semanticQuery.isFetching}
      onRequestSemantic={requestSemanticAnalysis}
    />
  );
}

function KnowledgeMapGraph({
  dto,
  recentChanges,
  recentError,
  recentIsFetching,
  recentIsLoading,
  onRefreshRecent,
  semanticStatus,
  semanticStatusError,
  semanticResult,
  semanticTransportError,
  semanticRequested,
  semanticLoading,
  onRequestSemantic,
}: {
  dto: KnowledgeGraphDTO;
  recentChanges: RecentChangeItem[];
  recentError: string | null;
  recentIsFetching: boolean;
  recentIsLoading: boolean;
  onRefreshRecent: () => void;
  semanticStatus: LLMStatusDTO | null;
  semanticStatusError: boolean;
  semanticResult: SemanticResultDTO | null;
  semanticTransportError: boolean;
  semanticRequested: boolean;
  semanticLoading: boolean;
  onRequestSemantic: () => void;
}) {
  const { t } = useI18n();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('cluster');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [showInferred, setShowInferred] = useState(true);
  const [showDriftOnly, setShowDriftOnly] = useState(false);
  // Expansion state machine (ticket #265): multiple features may be expanded
  // at once; re-invoking an expanded entry collapses that neighbourhood;
  // session-only — never the URL, never storage.
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const [aggregateFoundation, setAggregateFoundation] = useState(true);
  const [railView, setRailView] = useState<'detail' | 'ask' | 'analytics'>('detail');
  const [question, setQuestion] = useState('');
  const [askInput, setAskInput] = useState<{
    question: string;
    focusNodeId?: string;
    allowExternal: true;
  } | null>(null);
  const askQuery = trpc.knowledge.ask.useQuery(askInput ?? skipToken, {
    retry: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
  });

  const toggleExpand = useCallback((featureId: string) => {
    setExpandedFeatures((previous) => {
      const next = new Set(previous);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  }, []);
  const collapseAll = useCallback(() => setExpandedFeatures(new Set()), []);

  // Merge inferred edges from the semantic layer (client-side only; never feeds back into DTO)
  const mergedDto = useMemo((): KnowledgeGraphDTO => {
    if (!semanticResult?.available || !semanticResult.inferredEdges.length) return dto;
    return { ...dto, edges: [...dto.edges, ...semanticResult.inferredEdges] };
  }, [dto, semanticResult]);

  // Read-time analytics over the deterministic graph (F060) — never persisted.
  const analytics: KnowledgeAnalytics = useMemo(
    () => buildKnowledgeAnalytics({ nodes: dto.nodes, edges: dto.edges }),
    [dto],
  );
  const anomalousKeys = useMemo(
    () => new Set(analytics.anomalies.map((mark) => anomalyKey(mark))),
    [analytics],
  );
  const godNodeIds = useMemo(
    () => new Set(analytics.godNodes.flatMap((board) => board.entries.map((entry) => entry.id))),
    [analytics],
  );

  // Folded-by-default render graph (ticket #264): document scale plus the
  // expanded code neighbourhoods; shared-foundation aggregation lives here in
  // the renderer only.
  const renderGraph = useMemo(
    () =>
      buildRenderGraph(mergedDto, {
        expandedFeatures,
        aggregateFoundation,
        foundationMembers: analytics.codeAggregation.memberIds,
        anomalousKeys,
      }),
    [mergedDto, expandedFeatures, aggregateFoundation, analytics, anomalousKeys],
  );

  const layout = useMemo(() => computeLayout(renderGraph, layoutMode), [renderGraph, layoutMode]);

  const nodeById = useMemo(() => new Map(mergedDto.nodes.map((n) => [n.id, n])), [mergedDto.nodes]);

  const anchorsCountByFeature = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of mergedDto.edges) {
      if (edge.verb !== 'anchors') continue;
      counts.set(edge.src, (counts.get(edge.src) ?? 0) + 1);
    }
    return counts;
  }, [mergedDto.edges]);

  const summaryByNodeId = useMemo((): Map<string, NodeSummaryDTO> => {
    if (!semanticResult?.nodeSummaries.length) return new Map();
    return new Map(semanticResult.nodeSummaries.map((s) => [s.nodeId, s]));
  }, [semanticResult]);

  const selected = useMemo(
    () => (selectedId ? (nodeById.get(selectedId) ?? null) : null),
    [nodeById, selectedId],
  );
  const selectedFoundation = selectedId === FOUNDATION_NODE_ID;

  // The QA/semantic ceiling is document-scale: Code Nodes never enter the
  // LLM layer, so the pre-emptive hint counts documents only.
  const documentNodeCount = useMemo(
    () => mergedDto.nodes.filter((n) => n.kind !== 'code').length,
    [mergedDto.nodes],
  );

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || askQuery.isFetching) return;
    const nextInput = {
      question: trimmed,
      ...(selectedId && !selectedFoundation ? { focusNodeId: selectedId } : {}),
      allowExternal: true as const,
    };
    if (
      askInput?.question === nextInput.question &&
      askInput.focusNodeId === nextInput.focusNodeId
    ) {
      void askQuery.refetch();
      return;
    }
    setAskInput(nextInput);
  };

  // Search pierces the fold (ticket #265): the domain includes folded code
  // nodes by path and exported symbol name.
  const searchHits = useMemo(() => {
    const q = search.trim();
    if (!q) return null;
    return searchKnowledgeNodes(mergedDto.nodes, q);
  }, [mergedDto.nodes, search]);

  // Folded code hits surface as a pierce list; selecting one auto-expands
  // the owning feature neighbourhood and selects the node.
  const foldedSearchHits = useMemo(() => {
    if (searchHits === null) return [];
    const rendered = new Set(renderGraph.nodes.map((n) => n.id));
    return [...searchHits]
      .filter((id) => id.startsWith('code:') && !rendered.has(id))
      .sort()
      .slice(0, 8)
      .map((id) => ({ id, owners: owningFeaturesOf(mergedDto, id) }));
  }, [searchHits, renderGraph.nodes, mergedDto]);

  const pierceTo = useCallback(
    (codeId: string, owners: string[]) => {
      if (owners.length > 0) {
        setExpandedFeatures((previous) => {
          const next = new Set(previous);
          next.add(owners[0]);
          return next;
        });
      }
      setSelectedId(codeId);
    },
    [setSelectedId],
  );

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of renderGraph.nodes) {
      if (n.kind === 'foundation') continue;
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    return counts;
  }, [renderGraph.nodes]);

  const driftNodeIds = useMemo(
    () => new Set(mergedDto.drift.map((d) => d.nodeId)),
    [mergedDto.drift],
  );

  const visibleIds = useMemo(() => {
    if (kindFilter.size === 0 && searchHits === null && !showDriftOnly) return null;
    const ids = new Set<string>();
    for (const n of renderGraph.nodes) {
      const effectiveKind = n.kind === 'foundation' ? 'code' : n.kind;
      if (kindFilter.size > 0 && !kindFilter.has(effectiveKind)) continue;
      if (searchHits !== null && !searchHits.has(n.id)) continue;
      if (showDriftOnly && n.kind !== 'foundation' && !driftNodeIds.has(n.id)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [renderGraph.nodes, kindFilter, searchHits, showDriftOnly, driftNodeIds]);

  const visibleCount = visibleIds === null ? renderGraph.nodes.length : visibleIds.size;

  const kindLayer = useMemo(() => {
    const map = new Map<string, GraphLayer>();
    for (const n of mergedDto.nodes) if (!map.has(n.kind)) map.set(n.kind, n.layer);
    return map;
  }, [mergedDto.nodes]);

  const relatedOf = useCallback(
    (id: string) => ({
      outgoing: mergedDto.edges.filter((e) => e.src === id),
      incoming: mergedDto.edges.filter((e) => e.dst === id),
    }),
    [mergedDto.edges],
  );

  // Feature detail annotation: where its anchored code sits (communities and
  // high fan-in members) — analytics stay visible while folded.
  const featureCodeSummary = useMemo(() => {
    if (!selected || selected.kind !== 'feature') return null;
    const neighbourhood = codeNeighbourhoodOf(mergedDto, selected.id);
    if (neighbourhood.size === 0) return null;
    const communities = [
      ...new Set(
        [...neighbourhood]
          .map((id) => analytics.communityOf[id])
          .filter((id): id is string => id !== undefined),
      ),
    ].sort();
    const hubs = analytics.codeAggregation.memberIds.filter((id) => neighbourhood.has(id)).length;
    return { communities, hubs, size: neighbourhood.size };
  }, [selected, mergedDto, analytics]);

  const selectedDegree = useMemo(() => {
    if (!selected) return null;
    let inDegree = 0;
    let outDegree = 0;
    for (const edge of mergedDto.edges) {
      if (edge.origin !== 'deterministic') continue;
      if (edge.src === selected.id) outDegree += 1;
      if (edge.dst === selected.id) inDegree += 1;
    }
    return { inDegree, outDegree };
  }, [selected, mergedDto.edges]);

  const semanticBanner = useMemo(() => {
    if (semanticStatusError) {
      return { kind: 'error' as const, message: t('knowledge.semantic.statusError') };
    }
    if (semanticStatus === null) return null;
    if (!semanticStatus.available) {
      return {
        kind:
          semanticStatus.reason === 'invalid-config'
            ? ('error' as const)
            : ('unavailable' as const),
        message:
          semanticStatus.reason === 'invalid-config'
            ? t('knowledge.semantic.invalidConfig')
            : t('knowledge.semantic.unavailable'),
      };
    }
    if (semanticTransportError || semanticResult?.error) {
      return { kind: 'error' as const, message: t('knowledge.semantic.error') };
    }
    if (semanticLoading) {
      return { kind: 'loading' as const, message: t('knowledge.semantic.loading') };
    }
    return null;
  }, [
    semanticStatus,
    semanticStatusError,
    semanticResult,
    semanticTransportError,
    semanticLoading,
    t,
  ]);

  return (
    <div className="page-container">
      {semanticBanner && (
        <div
          data-testid="semantic-status-banner"
          role={semanticBanner.kind === 'error' ? 'alert' : 'status'}
          aria-live={semanticBanner.kind === 'error' ? 'assertive' : 'polite'}
          className={`mb-3 rounded-md px-3 py-2 text-[11px] border ${
            semanticBanner.kind === 'error'
              ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200'
              : 'border-slate-200 dark:border-obsidian-border bg-slate-50 dark:bg-obsidian-surface text-slate-500 dark:text-slate-400'
          }`}
        >
          {semanticBanner.message}
        </div>
      )}
      {semanticStatus?.available && (
        <section
          data-testid="semantic-disclosure"
          aria-label={t('knowledge.semantic.run')}
          className="mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-obsidian-border dark:bg-obsidian-surface sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {t('knowledge.semantic.disclosure', { provider: semanticStatus.provider ?? 'LLM' })}
          </p>
          <button
            type="button"
            onClick={onRequestSemantic}
            disabled={semanticLoading}
            className="btn-secondary shrink-0 text-xs disabled:opacity-50"
          >
            {semanticRequested ? t('knowledge.semantic.runAgain') : t('knowledge.semantic.run')}
          </button>
        </section>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-headline font-semibold text-slate-900 dark:text-white">
            {t('knowledge.title')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('knowledge.subtitle', {
              visible: visibleCount,
              total: mergedDto.nodes.length,
              edges: dto.edges.length,
              drift: mergedDto.drift.length,
            })}
            {renderGraph.foldedCodeCount > 0 && (
              <span className="ml-1" data-testid="folded-count">
                {t('knowledge.fold.foldedSuffix', { folded: renderGraph.foldedCodeCount })}
              </span>
            )}
            {mergedDto.edges.length > dto.edges.length && (
              <span className="ml-1 italic">
                {t('knowledge.subtitle.inferredSuffix', {
                  inferred: mergedDto.edges.length - dto.edges.length,
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={collapseAll}
            disabled={expandedFeatures.size === 0}
            className="btn-secondary px-2 py-1 text-[11px] disabled:opacity-40"
          >
            {t('knowledge.fold.collapseAll')}
          </button>
          <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={aggregateFoundation}
              onChange={(e) => setAggregateFoundation(e.target.checked)}
              className="accent-violet-500"
            />
            {t('knowledge.fold.aggregate')}
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showInferred}
              onChange={(e) => setShowInferred(e.target.checked)}
              className="accent-amber-500"
            />
            {t('knowledge.showInferred')}
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showDriftOnly}
              onChange={(e) => setShowDriftOnly(e.target.checked)}
              className="accent-red-500"
            />
            {t('knowledge.driftOnly')}
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
              placeholder={t('knowledge.searchPlaceholder')}
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
                  {t(`knowledge.layout.${m}` as I18nKey)}
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
                  className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors inline-flex items-center gap-1 ${
                    active
                      ? 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
                      : 'border-transparent text-slate-400 dark:text-slate-600 line-through'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      LAYER_COLORS[kindLayer.get(kind) ?? 'implementation'].dot
                    }`}
                  />
                  {t(KIND_LABEL_KEYS[kind])} {count}
                </button>
              );
            })}
          </div>

          {foldedSearchHits.length > 0 && (
            <div
              data-testid="pierce-search-hits"
              className="mb-3 rounded-md border border-slate-200 dark:border-obsidian-border bg-slate-50 dark:bg-obsidian-surface px-2.5 py-2"
            >
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                {t('knowledge.fold.searchHits', { count: foldedSearchHits.length })}
              </div>
              <ul className="space-y-1">
                {foldedSearchHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      data-testid={`pierce-hit-${hit.id}`}
                      onClick={() => pierceTo(hit.id, hit.owners)}
                      className="w-full text-left rounded border border-slate-200 dark:border-obsidian-border px-2 py-1 text-[10px] font-mono text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors"
                    >
                      {hit.id.slice('code:'.length)}
                      <span className="ml-1.5 text-slate-400 not-italic">
                        {hit.owners.length > 0
                          ? t('knowledge.fold.searchHitAction', { feature: hit.owners[0] })
                          : t('knowledge.fold.searchHitUnowned')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card bg-dot-matrix relative" style={{ height: '70vh', minHeight: 480 }}>
            <ReactFlowProvider>
              <FlowCanvas
                graph={renderGraph}
                layout={layout}
                selectedId={selectedId}
                hoverId={hoverId}
                onSelect={setSelectedId}
                onHover={setHoverId}
                visibleIds={visibleIds}
                searchHits={searchHits}
                showInferred={showInferred}
                driftNodeIds={driftNodeIds}
                godNodeIds={godNodeIds}
                communityOf={analytics.communityOf}
                anchorsCountByFeature={anchorsCountByFeature}
                expandedFeatures={expandedFeatures}
                onToggleExpand={toggleExpand}
              />
            </ReactFlowProvider>
            <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-obsidian-surface/90 backdrop-blur rounded-md border border-slate-200 dark:border-obsidian-border px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400 space-y-1 pointer-events-none">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />{' '}
                {t('knowledge.legend.decision')}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cobalt" />{' '}
                {t('knowledge.legend.knowledge')}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-500" />{' '}
                {t('knowledge.legend.implementation')}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                <span className="w-4 border-t-2 border-slate-500 inline-block" />{' '}
                {t('knowledge.legend.deterministic')}
                <span className="w-4 border-t-2 border-dashed border-slate-400 inline-block" />{' '}
                {t('knowledge.legend.inferred')}
              </div>
            </div>
          </div>
        </div>

        <aside className="w-full lg:w-96 shrink-0 space-y-4">
          <div
            className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-obsidian-border dark:bg-obsidian-elevated"
            role="group"
            aria-label={t('knowledge.rail.label')}
          >
            {(['detail', 'ask', 'analytics'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={railView === view}
                onClick={() => setRailView(view)}
                className={`flex-1 rounded px-3 py-1.5 text-xs transition-colors ${
                  railView === view
                    ? 'bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-obsidian-surface'
                }`}
              >
                {t(`knowledge.rail.${view}` as I18nKey)}
              </button>
            ))}
          </div>
          {railView === 'ask' ? (
            <KnowledgeAskPanel
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={submitQuestion}
              focusNode={selectedFoundation ? null : selected}
              result={askQuery.data}
              isFetching={askQuery.isFetching}
              errorCode={askQuery.error?.message ?? null}
              nodeById={nodeById}
              onSelect={setSelectedId}
              nodeCount={documentNodeCount}
            />
          ) : railView === 'analytics' ? (
            <KnowledgeAnalyticsPanel
              analytics={analytics}
              nodeById={nodeById}
              onSelect={setSelectedId}
            />
          ) : selectedFoundation ? (
            <FoundationDetailPanel
              memberIds={renderGraph.foundationMemberIds}
              nodeById={nodeById}
              inDegreeP99={analytics.codeAggregation.inDegreeP99}
              onSelect={setSelectedId}
            />
          ) : selected ? (
            <div className="card p-4 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${LAYER_COLORS[selected.layer].badge}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${LAYER_COLORS[selected.layer].dot}`}
                  />
                  {t(KIND_LABEL_KEYS[selected.kind])}
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

              {selected.kind === 'feature' && (anchorsCountByFeature.get(selected.id) ?? 0) > 0 && (
                <div className="mt-2 space-y-1.5">
                  <button
                    type="button"
                    data-testid="detail-expand-implementation"
                    onClick={() => toggleExpand(selected.id)}
                    className="btn-secondary w-full text-xs"
                  >
                    {expandedFeatures.has(selected.id)
                      ? t('knowledge.fold.collapse')
                      : t('knowledge.fold.expand')}
                  </button>
                  {featureCodeSummary && (
                    <p
                      className="text-[10px] text-slate-500 dark:text-slate-400"
                      data-testid="feature-code-summary"
                    >
                      {t('knowledge.feature.codeSummary', {
                        communities: featureCodeSummary.communities.join(', ') || '—',
                        hubs: featureCodeSummary.hubs,
                      })}
                    </p>
                  )}
                </div>
              )}

              {(selected.kind === 'code' || analytics.communityOf[selected.id]) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                  {analytics.communityOf[selected.id] && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t('knowledge.community')} {analytics.communityOf[selected.id]}
                    </span>
                  )}
                  {selectedDegree && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t('knowledge.degree')} {selectedDegree.inDegree + selectedDegree.outDegree} (
                      {selectedDegree.inDegree} in / {selectedDegree.outDegree} out)
                    </span>
                  )}
                  {godNodeIds.has(selected.id) && (
                    <span
                      title={t('knowledge.godNode.tooltip')}
                      className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200 uppercase"
                    >
                      ▲ {t('knowledge.godNode.badge')}
                    </span>
                  )}
                </div>
              )}

              {selected.kind === 'code' && (selected.symbols?.length ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
                    {t('knowledge.symbols')} ({selected.symbols!.length})
                  </div>
                  <ul className="max-h-40 overflow-y-auto space-y-0.5" data-testid="code-symbols">
                    {selected.symbols!.slice(0, 60).map((symbol) => (
                      <li
                        key={symbol.name}
                        className="font-mono text-[10px] text-slate-600 dark:text-slate-300"
                      >
                        {symbol.name}
                        <span className="text-slate-400"> :{symbol.startLine}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.body && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
                    {t('knowledge.context')}
                  </div>
                  <div className="text-xs">
                    <MarkdownMessage text={selected.body} codeCollapseAfterLines={8} />
                  </div>
                </div>
              )}

              {summaryByNodeId.has(selected.id) && (
                <div
                  className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700"
                  data-testid="inferred-summary"
                >
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1.5">
                    {t('knowledge.summary')}
                    <span className="px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono normal-case italic">
                      {t('knowledge.semantic.badge')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {summaryByNodeId.get(selected.id)!.summary}
                  </p>
                  <p className="text-[9px] text-slate-400 mt-1 italic">
                    {t('knowledge.summary.provenance', {
                      provider: summaryByNodeId.get(selected.id)!.provenance.provider,
                      model: summaryByNodeId.get(selected.id)!.provenance.model,
                      timestamp: summaryByNodeId
                        .get(selected.id)!
                        .provenance.timestamp.slice(0, 10),
                    })}
                  </p>
                </div>
              )}

              <MiniContextGraph
                dto={mergedDto}
                centerId={selected.id}
                nodeById={nodeById}
                onSelect={setSelectedId}
              />

              <dl className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1.5 text-[11px]">
                <div className="flex gap-2">
                  <dt className="text-slate-400 w-16 shrink-0">{t('knowledge.source')}</dt>
                  <dd className="font-mono text-slate-600 dark:text-slate-300 break-all flex-1">
                    {selected.sourcePath}
                  </dd>
                  <dd className="shrink-0">
                    {KIND_LOCAL_TARGET[selected.kind] && (
                      <LocalJumpLink
                        linkTo={KIND_LOCAL_TARGET[selected.kind]}
                        linkId={selected.kind === 'feature' ? selected.id.split(':')[1] : undefined}
                        label={selected.sourcePath}
                      >
                        <span aria-hidden>→</span>
                        {t(`knowledge.link.${KIND_LOCAL_TARGET[selected.kind]}` as I18nKey)}
                      </LocalJumpLink>
                    )}
                  </dd>
                </div>
                {selected.updated && (
                  <div className="flex gap-2">
                    <dt className="text-slate-400 w-16 shrink-0">{t('knowledge.updated')}</dt>
                    <dd className="font-mono text-slate-600 dark:text-slate-300">
                      {selected.updated}
                    </dd>
                  </div>
                )}
                {selected.revisions != null && (
                  <div className="flex gap-2">
                    <dt className="text-slate-400 w-16 shrink-0">{t('knowledge.revisions')}</dt>
                    <dd className="font-mono text-slate-600 dark:text-slate-300">
                      {selected.revisions} {t('knowledge.committed')}
                    </dd>
                  </div>
                )}
              </dl>

              {selected.paths && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                    {t('knowledge.anchors')}
                  </div>
                  <ul className="space-y-1">
                    {selected.paths.map((p) => {
                      const dead = mergedDto.drift.some(
                        (d) => d.nodeId === selected.id && d.path === p,
                      );
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
                          {dead && (
                            <span className="ml-1.5 text-[9px] uppercase not-italic">
                              {t('knowledge.deadAnchor')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {(() => {
                const { outgoing, incoming } = relatedOf(selected.id);
                if (!outgoing.length && !incoming.length) return null;
                return (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
                      {t('knowledge.edges')}
                    </div>
                    <ul className="space-y-1 text-[11px]">
                      {outgoing.map((e, i) => (
                        <EdgeRow
                          key={`o${i}`}
                          edge={e}
                          otherId={e.dst}
                          nodeById={nodeById}
                          onSelect={setSelectedId}
                        />
                      ))}
                      {incoming.map((e, i) => (
                        <EdgeRow
                          key={`i${i}`}
                          edge={e}
                          otherId={e.src}
                          nodeById={nodeById}
                          onSelect={setSelectedId}
                          incoming
                        />
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="card p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('knowledge.selectPrompt')}
              </div>
            </div>
          )}

          <div className="card p-4" data-testid="recent-drift-panel">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('knowledge.recentDrift')}
              </h3>
              <button
                type="button"
                onClick={onRefreshRecent}
                disabled={recentIsFetching}
                className="btn-secondary px-2 py-1 text-[10px] disabled:opacity-50"
              >
                {recentIsFetching ? t('knowledge.recentRefreshing') : t('knowledge.recentRefresh')}
              </button>
            </div>
            {recentIsLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="text-[11px] text-slate-500 dark:text-slate-400"
              >
                {t('knowledge.recentLoading')}
              </div>
            ) : recentError ? (
              <div role="alert" className="space-y-2">
                <div className="text-[11px] text-red-700 dark:text-red-300 break-all">
                  {recentError}
                </div>
                <button
                  type="button"
                  onClick={onRefreshRecent}
                  className="btn-secondary text-[11px]"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : recentChanges.length === 0 ? (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('knowledge.recentEmpty')}
              </div>
            ) : (
              <ul className="space-y-2">
                {recentChanges.map((r) => (
                  <li
                    key={r.id}
                    data-testid="recent-change"
                    data-source={r.source}
                    className={`text-[11px] rounded-md border px-2 py-1.5 ${
                      r.source === 'drift'
                        ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                        : 'border-slate-200 text-slate-600 dark:border-obsidian-border dark:text-slate-300'
                    }`}
                  >
                    <div className="flex gap-2 items-baseline">
                      <span className="font-mono text-slate-400 shrink-0">
                        {r.time ? r.time.slice(0, 10) : ''}
                      </span>
                      <span className="truncate" title={r.title}>
                        {r.title}
                      </span>
                    </div>
                    {r.linkTo && (
                      <div className="mt-1">
                        <LocalJumpLink linkTo={r.linkTo} linkId={r.linkId} label={r.linkLabel}>
                          <span aria-hidden>→</span>
                          {t(`knowledge.link.${r.linkTo}` as I18nKey)}
                          {r.linkLabel ? (
                            <span className="font-mono opacity-70">· {r.linkLabel}</span>
                          ) : null}
                        </LocalJumpLink>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
