# F060: Knowledge Map v2 — Code Graph & Interaction Upgrade

**Status:** Proposed
**Depends on:** F059, ADR-0025, the F059 fix batch (#267)
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)
**Wayfinder map:** [#260](https://github.com/Bandersnatch0x/amber-protocol/issues/260) — every
decision below carries its ticket lineage; this Spec is the content authority that supersedes
those tickets for implementation.

## Problem Statement

The v1 knowledge map (F059) deliberately excluded code: "Code files are not nodes" and the
`anchors` property never became an edge. That kept the graph honest at 105 nodes, but it also
means the map cannot answer the question the anchors already gesture at — *which code realizes
this feature, and what does that code depend on?* Drift findings (F001/F007) prove the anchor
data is live; the graph just refuses to walk it. Meanwhile 60% of v1 nodes were isolated, the
map's analytics surface is empty, and the only interaction beyond pan/zoom is a search box.

ADR-0025 re-chartered the boundary: once code files become nodes, the premise behind both F059
prohibitions is gone. Measured on the real repository (#264 probe), the merged graph is 474
nodes / 1221 edges — 4.5× / 13× v1 — with import edges alone at 83% of the total. v2 therefore
has to solve presentation and analytics together, or the map drowns in its own new data.

## Solution

Extend the deterministic knowledge graph with a code layer and the analytics it enables, behind
a presentation that keeps the document graph readable by default:

1. **Deterministic code graph** — file-level Code Nodes (kind `code`, implementation layer)
   extracted through the TypeScript compiler API, `imports` edges between them, and `anchors`
   edges from features to the files they declare. Same contract as v1: schema-validated, stable
   order, byte-identical recompute.
2. **Deterministic analytics** — per-layer degree rankings (god nodes), community detection, and
   two anomalous-connection detectors, computed at read time over the graph and consumed by
   badges, a side panel, on-graph highlighting, and a readable audit report.
3. **Folded-by-default presentation** — the default view stays at document scale; each feature
   exposes its code neighbourhood on demand; infrastructure hubs aggregate in the rendering
   layer. Analytics stay visible in the folded view.
4. **Interaction upgrade** — session-scoped drag, per-feature expansion with a global collapse,
   and search that pierces the fold (paths and exported symbols) with auto-expansion on hit.

Delivery lands after the F059 fix batch (#267); the census single-source migration
(`issues/0007`) is independent and may land before or after.

## User Stories

1. As a developer, I want a feature's anchored files as real edges, so that rename drift and
   implementation shape are visible where the feature lives.
2. As an incoming agent, I want file-level import edges, so that I can judge blast radius from
   the map instead of grepping.
3. As a reader, I want the default view to stay at document scale, so that 1000+ import edges
   never bury the 96 document edges I came for.
4. As a reader, I want god-node badges and community summaries on the folded view, so that the
   analytics pay rent without me expanding anything.
5. As an auditor, I want anomaly marks to be neutral "worth a look" signals from deterministic
   detectors, so that no hidden weights decide what I see.
6. As an operator, I want the analytics as a readable report section, so that reviews can cite
   hub and community findings offline.
7. As a developer, I want search to find folded code by path or exported symbol and expand to
   it, so that the fold never hides what I asked for.
8. As an auditor, I want `amber knowledge graph --json` to stay byte-stable with the code layer
   included, so that recompute discipline survives the 4.5× growth.

## Implementation Decisions

### Data model (ticket #261; ADR-0025)

- One graph, one schema: the code layer extends `knowledge-graph.schema.json` as
  **schemaVersion 2**; no parallel sub-graph, no second pipeline. Separation of concerns stays a
  UI/query matter (kind filters, folding).
- Nodes are **file-level**: kind `code`, implementation layer, id `code:<POSIX path>`. The
  exported-symbol table rides as a node property, never as child nodes. Test files stay out of
  the graph.
- New verbs, exactly two: `imports` (file-level code dependency, aggregated per file pair) and
  `anchors` (`feature -[anchors]-> code`, only when the anchored file is a Code Node). Document
  verbs keep their v1 semantics; code dependencies never overload `references`.
- A dead anchor never becomes a dangling edge — it keeps surfacing as a drift finding. The F059
  property-only rule stands for any anchor whose target is not a node (globs, directories,
  non-code paths).
- Vocabulary follows CONTEXT.md: **Code Node**, **Anchors Edge**.

### Extraction (ticket #262)

- The TypeScript compiler API is the extractor — an existing dependency, zero new supply chain,
  type-aware resolution through re-exports and aliases. web-tree-sitter (wasm) is the reserved
  path for the day non-JS/TS corpus actually exists; the native binding route is rejected
  (first native dependency for one feature, grammar peer lag).
- Determinism discipline: output sorted by `(path, startLine, startCol, symbolName)`, paths
  normalized to POSIX, the exact `typescript` version recorded in provenance. Incremental
  indexing is file-level content-hash skipping (the normHash pattern), not editor-style
  incremental parsing.

### Analytics (tickets #259, #263)

- Stack: `graphology` + `graphology-communities-louvain` with the deterministic configuration
  (`randomWalk: false` or seeded rng), plus a ~30-line deterministic connectivity post-split
  that restores the community-connectedness guarantee Louvain alone lacks. Degree/centrality
  from graphology core. Pure JS; no second runtime. Re-evaluate the stack past 2,000 nodes, a
  densified graph, or a mature 1.0+ Leiden implementation.
- **God nodes** rank per layer at the **p99** degree threshold, in- and out-degree both
  recorded; a badge lights when a node is ≥p99 within its layer. Global rankings and absolute
  thresholds are rejected — measured, the global board is all infrastructure (max 92 vs top
  document ~15).
- **Anomalous connections** come from two deterministic detectors: rare cross-kind pairs
  (pair-frequency below threshold) and inter-community bridge edges. No whitelists. Marks are
  neutral — anomaly ≠ error.
- Analytics are **read-time computation**: never part of `knowledge graph --json` bytes, never
  in the schema. The audit report is generated on demand and not persisted into graph data.
- Symbol-level promotion has a measurable flip condition: if file-granularity analysis with edge
  weights cannot produce an actionable partition — **largest community < 30% of nodes and
  weighted singletons < 20%** — symbol-level extraction becomes the first v2.1 item. Measured at
  decision time: 32.5% / 14.8%.

### Presentation (ticket #264)

- **Folded by default**: the default view is document scale plus anchors affordances on
  features. Expansion is per-feature code neighbourhood — never a whole-graph floodgate.
  Anchors edges and expansion entry points are visible in the folded view.
- Analytics remain visible while folded: god-node badges and community summaries annotate the
  feature/document nodes ("anchored code sits in community C3, two high fan-in modules").
- **Rendering-layer aggregation**: within an expanded view, code nodes with in-degree > p99
  collapse into a "shared foundation" super-node. The rule and threshold live in this Spec, the
  toggle is user-facing, and the CLI graph carries **zero derived nodes** — aggregation exists
  only in the renderer.
- Layered mode stays. Folded, the bands return to document scale; expanded, the row-accumulated
  band formula from the F059 fix batch keeps bands disjoint at any size.
- Rendering stack stays `@xyflow/react` + `d3-force` (see
  `docs/research/graph-rendering-library-choice.md`); the DTO stays renderer-agnostic. A canvas
  renderer is evaluated only on measured performance past ~500 visible nodes.

### Interaction (ticket #265)

- **Drag is session-scoped**: native xyflow drag, positions live in React state only; a refresh
  returns to the deterministic layout. The localStorage variant (keyed by graph content hash) is
  recorded fog, not v2.
- **Expansion state machine**: two entries, one action — a detail-panel "expand implementation"
  button and the node's expansion affordance; multiple features may be expanded at once; a
  toolbar "collapse all"; expansion state is session-only and never enters the URL; re-invoking
  an expanded entry collapses that neighbourhood.
- **Search pierces the fold**: the search domain includes folded code nodes (path and exported
  symbol names; not full source text). Selecting a hit auto-expands the owning feature
  neighbourhood and selects the node.
- **Super-node interaction**: clicking a shared-foundation node opens a member list with
  per-member jumps in the detail panel. No un-aggregation — that would pour the p99 star shape
  back into the view.

## Testing Decisions

- The CLI seam keeps its v1 guarantees at schemaVersion 2: schema validity, byte-stable
  recompute, full population invariants against the real tree, and the standing drift findings —
  now including code nodes and both new verbs.
- Extraction gets synthetic-corpus tests owning their own census: symbol-table extraction,
  import resolution through re-exports, POSIX normalization, and deterministic ordering under
  shuffled file discovery.
- Analytics are property-tested for determinism (identical output across runs and platforms —
  the Louvain seed and the post-split are part of the contract) and boundary-tested at the p99
  threshold and the flip-condition metrics.
- Geometry stays under test: the folded/expanded layouts extend the exported-pure-function
  pattern (`computeLayout`, `buildMiniNeighbors`) introduced by the fix batch.
- UI behaviour (fold default, expansion round-trip, pierce-search, aggregation toggle, badges)
  is verified in a real browser against the live CLI data source, with the subtitle-count
  helpers already localized in the e2e suite.

## Out of Scope

- Symbol-level nodes and `calls` edges (fog; flip condition above).
- Vision-model or PDF extraction — no corpus exists to accept it.
- Ungoverned persistence of inferred content; LLM authoring of deterministic edges (inherited
  from F059 verbatim).
- Multi-language grammars (.py/.go/.java) — the corpus is JS/TS; web-tree-sitter is the
  reserved path when that changes.
- Drag persistence (localStorage variant) — fog.
- The governance object graph (sessions, routes, gates) as map content.

## Further Notes

Lineage: wayfinder map [#260](https://github.com/Bandersnatch0x/amber-protocol/issues/260);
decisions #259 (analytics stack), #261 (data model), #262 (extraction), #263 (analytics
surfacing), #264 (merged-graph presentation), #265 (interaction) — resolutions on the tickets,
local research archives under `docs/research/` (internalized per repo visibility policy).

The corpus census gate is orthogonal: adjudicated to migrate to the committed manifest as its
single source of truth (`issues/0007-census-single-source.md`). This Spec assumes whichever
census mechanism is current; adding ADRs alongside v2 work follows the corpus workflow of the
day.

`feature_list.json` registration (deferred to landing because the file is under active edit by
a parallel effort):

```json
{
  "id": "F060",
  "title": "Knowledge Map v2 — code graph & interaction upgrade",
  "status": "planned",
  "spec": "docs/specs/F060-knowledge-map-v2-code-graph.md",
  "paths": [
    "scripts/lib/core/knowledge-graph.js",
    "schemas/knowledge-graph.schema.json",
    "apps/web/src/features/knowledge/",
    "apps/web/server/lib/knowledge-graph-reader.ts"
  ]
}
```
