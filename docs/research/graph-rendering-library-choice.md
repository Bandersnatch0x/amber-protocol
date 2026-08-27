# Graph Rendering Library Choice — Knowledge & Decision Map

Date: 2026-08-27
Ticket: issues/0002-research-graph-rendering-lib.md (wayfinder:research)
Status: resolved — recommendation locked

## Executive Summary

**Recommendation: `@xyflow/react` (React Flow v12) + `d3-force` for layout.**

Our use case is a small (50–500 node), read-only knowledge graph where the
differentiating requirements are custom per-type node styling (color-coded
kinds, drift badges), Chinese/English i18n labels, click-to-detail-panel,
and search highlighting — all of which are *React rendering* problems, not
graph-performance problems. React Flow renders every node as a real React
component, so the existing stack (React 19, Tailwind, i18n.tsx, tRPC) applies
directly to nodes on the canvas. It is MIT, actively released (v12.11.5,
2026-08-25 — two days before this writing), supports React 19 (`peerDeps
react: >=17`; official React 19 support announcement), and measures ~51KB
gzip for its ESM bundle (measured from the published tarball). Pairing it
with d3-force (~5.5KB gzip) for a one-shot force layout yields ~57KB gzip
of new runtime — the smallest "full solution" among candidates that don't
require us to build pan/zoom/hit-testing ourselves.

## Comparison Table

| Candidate | License | Latest (2026) | Maintenance | React 19 | Size (gzip) | Fit for this use case |
|---|---|---|---|---|---|---|
| **@xyflow/react 12.11.5** | MIT | 2026-08-25 | Full-time xyflow team, weekly-ish releases | ✅ `>=17`, official | ~51KB (measured) + d3-force 5.5KB | **Best** — React-rendered nodes, controlled viewport, minimap, free styling/i18n |
| sigma.js 3.0.3 + @react-sigma/core 5.0.6 | MIT | 2026, active | Good, graphology ecosystem | ✅ `^18 \|\| ^19` | sigma ~45KB + graphology ~30KB + react-sigma | Runner-up — WebGL power we don't need at ≤500 nodes; canvas labels/styling are harder |
| cytoscape.js 3.34.2 | MIT | 2026-06 | Mature, stable, slower cadence | ➖ framework-agnostic; React wrappers stale | ~134KB (bundlephobia) | Algorithm-rich but imperative canvas styling; heaviest of the realistic options |
| @antv/g6 5.1.1 | MIT | 2026, active | Good (Ant Group) | ✅ official React guide | huge — 11.7MB unpacked tarball; likely 200KB+ gzip | A full graph *framework*; overkill and conflicts with minimal-deps philosophy |
| vis-network 10.1.2 | Apache-2.0 OR MIT | community revival | Mixed/slow | ➖ wrapper-based | ~116KB (bundlephobia) | Physics-driven editable diagrams; dated API; canvas main-thread limits |
| d3-force 3.0.0 | ISC | stable | Fine (d3 org) | n/a | 5.5KB | Layout only — pan/zoom, hit-testing, labels, tooltips all DIY (weeks of work) |

## Per-Candidate Detail

### 1. @xyflow/react (React Flow v12) — recommended

- License MIT; v12.11.5 published 2026-08-25 (npm registry, verified via
  `npm view`). Peer deps `react: >=17`, `react-dom: >=17` — React 19 clean.
- Maintained full-time by the xyflow team; the UI components package was
  updated for React 19 + Tailwind 4 in Oct 2025 (official announcement).
- Bundle: ESM `index.mjs` measures 51KB gzip (measured from the npm
  tarball directly; bundlephobia was rate-limited).
- Why it fits: nodes are React components — drift badges, per-kind colors,
  i18n labels, hover cards all reuse our existing component/i18n patterns;
  built-in viewport controls, minimap, node click handlers, CSS-class-based
  search highlighting. Weakness: it is a *node-based UI* library, not a graph
  analyzer — layout must be supplied (d3-force one-shot, or precomputed
  server-side) and there are no built-in graph algorithms. For a read-only
  map we need neither.
- Sources: [xyflow/xyflow repo](https://github.com/xyflow/xyflow),
  [reactflow.dev](https://reactflow.dev/),
  [React Flow 12 release notes](https://xyflow.com/blog/react-flow-12-release),
  [React 19 UI components update](https://reactflow.dev/whats-new/2025-10-28).

### 2. sigma.js + @react-sigma + graphology — runner-up

- All MIT; @react-sigma/core 5.0.6 peer-depends on `react ^18 || ^19`
  (npm registry, verified) and `sigma ^3.0.2`; actively maintained 2026.
- WebGL renderer built for large graphs (10k+ nodes); graphology gives a
  strongly-typed graph model. Core is light (~1MB unpacked incl. sourcemaps).
- Trade-off for us: labels/node visuals are drawn on canvas or via reducers,
  not React components — drift badges and bilingual labels get materially
  harder; and at 50–500 nodes the WebGL advantage never materializes.
- Sources: [sigmajs.org](https://www.sigmajs.org/),
  [jacomyal/sigma.js](https://github.com/jacomyal/sigma.js/),
  [Sigma + React walkthrough](https://lyonwj.com/blog/sigma-react-graph-visualization).

### 3. cytoscape.js

- MIT, 3.34.2, ~134KB gzip (bundlephobia). Mature with rich built-in
  layouts/algorithms; Canvas rendering can block the main thread; the React
  wrappers (react-cytoscapejs) are not current. Styling goes through its
  imperative style system — a poor fit for React-driven node chrome.
- Sources: [PkgPulse 2026 comparison](https://www.pkgpulse.com/guides/cytoscape-vs-vis-network-vs-sigma-graph-visualization-2026),
  npm registry.

### 4. AntV G6 v5

- MIT, 5.1.1, actively developed by Ant Group with an official React
  integration guide. But it is a full framework: the npm tarball unpacks to
  11.7MB and the runtime is far heavier than anything else here. At odds
  with the repo's minimal-dependency philosophy for a read-only view.
- Sources: [G6 React integration](https://g6.antv.antgroup.com/en/manual/getting-started/integration/react),
  npm registry, tarball measurement.

### 5. vis-network

- Apache-2.0 OR MIT, 10.1.2, ~116KB gzip. Fast to a physics-driven editable
  canvas but community-maintained with a dated API; same canvas main-thread
  limits. Built for editable networks, not read-only curated maps.
- Sources: [PkgPulse 2026 comparison](https://www.pkgpulse.com/guides/cytoscape-vs-vis-network-vs-sigma-graph-visualization-2026).

### 6. d3-force + custom SVG/Canvas

- ISC, 5.5KB gzip — the only cost is layout. But pan/zoom, hit-testing,
  labels, tooltips, accessibility, and viewport state all become our code.
  The right *component* of the stack, wrong *whole* solution.

## Runner-up and Switching Conditions

Runner-up: **sigma.js stack**. Switch to it if (a) the node count grows
beyond ~2,000 (e.g. after context pages or per-session nodes join the
graph), (b) we need sub-60fps interaction on low-end hardware, or (c) we
start wanting graph *analysis* (centrality, communities) via graphology.
The data model from ticket 0003 should stay renderer-agnostic (plain
nodes/edges DTO behind tRPC) so this switch stays a rendering-layer change.

## Integration Notes for This Repo (apps/web)

- Install: `@xyflow/react` + `d3-force` only. No other new deps; total
  ~57KB gzip. Import `@xyflow/react/dist/style.css` once.
- Layout: compute force layout once per dataset (server-side at the tRPC
  reader or client-side memoized), emit static x/y into React Flow nodes.
  No live physics; the map is read-only evidence.
- Data flow: one tRPC query returning `{ nodes, edges }` (per ticket 0003's
  DTO); React Flow's controlled model fits the existing React Query setup.
- Custom node component: one React component per node kind (or one
  parameterized component) — reuses Tailwind tokens for kind colors and
  `i18n.tsx` for labels; drift badge is a child element, trivially.
- Search highlight: toggle a CSS class on matched node components
  (dim non-matches) — no library support needed.
- i18n: node labels render through the existing LanguageToggle-aware i18n
  layer; React Flow itself has no text baked in beyond ARIA labels it
  exposes for customization.
