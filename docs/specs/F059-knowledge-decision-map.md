# F059: Knowledge & Decision Map

**Status:** Proposed  
**Depends on:** F049, F058  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#246](https://github.com/Bandersnatch0x/amber-protocol/issues/246)

## Problem Statement

The repository's knowledge — 24 ADRs, 10 wiki knowledge pages, 9 architecture pages, and the
features in `feature_list.json` — is only reachable file-by-file. Trace relationships (supersedes,
builds-on, references, describes) live in prose; drift between declared anchors and the actual tree
is invisible; and an incoming agent or developer has no single surface answering what knowledge
exists, how decisions and features connect, and what changed recently or went stale. The web viewer
is read-only (ADR-0007) and has no LLM seam, and the Governance Graph projection (ADR-0021) covers
committed artifacts, not the knowledge corpus.

## Solution

Add a read-only `/knowledge` surface to `apps/web`, fed end-to-end by a shared deterministic parser
exposed as `amber knowledge graph --json`:

1. **Deterministic graph layer** — a three-layer ontology (decision: ADR / artifact; knowledge:
   wiki / memory / architecture; implementation: features) with four verb edges (supersedes,
   builds-on, references, describes; declarer → declared), drift surfaced as dead-anchor findings
   attached to nodes, and a Recent & Drift panel.
2. **Read-time LLM semantic layer** — server-side inferred edges and node summaries rendered
   alongside the deterministic layer with provenance labels (model, timestamp) and distinct visual
   treatment. Never persisted, never projection input.
3. **Cited QA** — a right-rail Ask view over the deterministic snapshot. Every claim carries
   citations resolving to node ids; uncited claims cannot reach the client.
4. **Projection unification** — the 43 knowledge artifacts become context pages (ADR-0009) so the
   knowledge-base projection is non-empty and the deterministic layer's data source becomes
   projection output.

Delivery is one-shot: all four capabilities land together, with `feature_list.json` entry, this
Spec, and the implementation.

## User Stories

1. As a developer, I want a read-only map of ADRs, knowledge pages, and features, so that I can
   see what the repository knows without opening files one by one.
2. As an incoming agent, I want trace edges with explicit verbs, so that I can follow authority
   from a decision to the feature that realizes it.
3. As a developer, I want drift findings attached to the nodes whose anchors died, so that stale
   documents are visible where they live rather than buried in a report.
4. As a developer, I want recent changes with jump links to the local session, gate, transcript,
   route, or governance surface, so that I can inspect the source of a change in one click.
5. As a reader, I want a mini context graph and edge rows per node, so that I can understand a
   node's neighborhood without reading raw JSON.
6. As a reader, I want semantic edges and summaries labeled with their model and time, so that
   inference is never mistaken for file evidence.
7. As an operator, I want the map to render fully when no LLM key is configured, so that the
   deterministic layer has zero LLM dependency.
8. As a reader, I want to ask questions of the map and get answers whose every claim cites a node
   id, so that I can click back to committed evidence.
9. As a reader, I want superseded-but-valid citations badged and linked to their superseder, so
   that history stays citable while currency is obvious.
10. As a security owner, I want the knowledge router to expose zero mutations, so that the
    ADR-0007 mutation whitelist stays empty.
11. As an auditor, I want `amber knowledge graph --json` to be schema-validated and byte-stable on
    recompute, so that the graph is a deterministic function of the committed tree.
12. As an eval owner, I want the QA contract surface scanned for vendor tokens on every
    `amber eval run`, so that model-independence is a re-verified property, not a claim.
13. As a knowledge owner, I want the 43 artifacts distilled through the ADR-0009 context pipeline
    under a human-reviewed manifest, so that projection unification does not depend on ad-hoc
    parsing.
14. As an operator, I want semantic-layer results cached in memory keyed by content and prompt
    hashes, so that repeat views are fast without any persistence.

## Implementation Decisions

### Deterministic layer

- The parser ships in the Amber read-only CLI as `amber knowledge graph --json` and is shared by
  the web server; the two surfaces never diverge. The web server loads it through a tRPC read
  query, never by spawning the CLI per request.
- Ontology: three layers — decision (`adr:*`, `artifact:*`), knowledge (`wiki:*`, `memory:*`,
  `architecture:*`), implementation (`feature:*`). Code files are not nodes. Artifacts enter at
  identity granularity; a context page merges into its source artifact's node as a property.
- Edges: exactly four verbs — `supersedes`, `builds-on`, `references`, `describes` — directed
  declarer → declared. `anchors` is a node property, never a ghost edge.
- Drift: a dead-anchor finding (declared path absent from the tree) attaches to the node that
  declared it, carrying the actual path when a rename/collapse is detected. F001 (`scaffolding.js`
  → `scaffold.js`) and F007 (`loops/` → `loops.js`) are the existing real findings.
- Output is validated against `schemas/knowledge-graph.schema.json` and emitted in stable order:
  recomputation over an unchanged tree is byte-identical.
- Every edge and node carries `provenance: 'deterministic' | 'inferred'`. File-evidence edges are
  always deterministic-parsed; LLM output never enters this stream.
- The final data source is projection output (ADR-0021 / ADR-0009 pages). The first implementation
  may read the tree directly and switch to projections as an internal detail — the switch is not a
  phase, and no shipped surface changes shape.

### Recent & Drift panel

- `knowledge.recentChanges` is a read-only tRPC query mapping five sources: git log (read-only,
  argv-whitelisted), feature-list change parsing, ADR `Date:` lines, the graph's `drift[]`, and
  maintenance inspect findings reused as-is.
- Drift findings pin to the top; changes sort reverse-chronologically; the panel caps at 50 rows
  and pulls on demand (no SSE subscription).
- Each entry may carry a local jump target — session, gate, transcript, route, or governance —
  rendered as an in-app link with **real ids from the live data source**. Placeholder ids are a
  prototype-only affordance and are not shippable.

### Read-time LLM semantic layer

- Provider access goes through one primitive (`KnowledgeLLM.complete`) behind neutral env
  configuration (`LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`; server-only). Three
  prompt facades sit on the primitive: semantic edges, node summaries, cited QA.
- No key configured → the provider reports `available: false`; the deterministic layer renders
  with zero LLM dependency. Provider failure is all-or-nothing per facade call: no half-rendered
  inferred edges.
- Prompts are versioned constants with sha256 hashes; the hash is the cache key component.
- Inferred edges and summaries render with provenance labels (model, timestamp) and visually
  distinct treatment (dashed styling, inferred badges). They are never written to any store,
  projection, or hash chain.
- Cache: in-process memory only, keyed `(source content hash, promptHash, model)`, no TTL,
  in-flight request sharing, LRU cap 200, cleared on restart. Cited QA is never cached.
- Context pages for projection unification are distilled through the ADR-0009 pipeline under a
  human-reviewed 43-row manifest, with batch request loop, deterministic ingest judging, and
  sampled human review. `knowledge admit` is not required: projections depend on pages only.

### Cited QA

- `knowledge.ask({ question, focusNodeId? })` registers as a tRPC **query** — the knowledge router
  exposes zero mutations. The ask path reads only through the read-only knowledge-graph reader
  shared with the map query, and the response object is the sole output (no store, no projection,
  no filesystem writes).
- Context assembly is a pure function of `(snapshot, focusNodeId, promptVersion)` over the
  deterministic snapshot only — inferred edges and summaries never enter QA context
  (no inference-on-inference). With `focusNodeId`, assembly uses the 2-hop neighborhood in stable
  order; `contextDigest` (sha256) records exactly what was fed. Overflow is a typed error, never
  silent truncation.
- Citation semantics: a citation is valid iff the node id exists in the current snapshot. Segments
  whose citations are all absent or invalid are dropped server-side before the response;
  `omittedCount` reports the drops and the UI surfaces "N uncited claims omitted". An answer with
  zero surviving segments is a typed `uncitable-answer` error. Superseded nodes are citable — the
  UI badges the citation and links to the superseder; the prompt guides (not enforces) preferring
  current nodes for current-state questions.
- The model-independent surface is enforced by eval: `amber eval run` scans the QA contract-surface
  files (prompt template, DTO schema, citation validator, ask handler) for vendor/network tokens,
  reusing the F058 vocabulary and non-vacuous-pass rule. The provider adapter is excluded by
  design — vendor confinement there is the #243 abstraction boundary.
- Single stateless exchange per ask: no multi-turn conversation, no streaming.

### UI

- `/knowledge` follows `.stitch/DESIGN.md` (Obsidian & Amber Pulse v10): master-detail with a
  right rail, amber/cobalt dual accents, dual theme, no new visual grammar.
- Rendering: `@xyflow/react` v12 + `d3-force` (see
  `docs/research/graph-rendering-library-choice.md`); the DTO stays renderer-agnostic.
- Node detail shows source path, context, anchors (with dead-anchor marking), and edge rows;
  a mini context graph renders the 1-hop neighborhood with verb labels and a `+N` indicator
  beyond the visible cut.
- The Ask view is a right-rail view switching with the Detail view; citation chips select and
  highlight nodes on the live map. All strings are i18n'd (en/zh).

## Testing Decisions

- The highest CLI seam is `amber knowledge graph --json`: tests assert schema validity, stable
  byte-order on recompute, the full node/edge population against the real repository tree, and
  the F001/F007 drift findings.
- The web seams are the tRPC knowledge queries: schema, zero-mutation surface, recent-changes
  mapping and cap, jump-link targets resolving to real ids, and provider availability semantics
  (with and without a key).
- Citation enforcement is tested at the validator: segments with no/invalid citations are dropped,
  `omittedCount` is exact, all-dropped answers error, and superseded ids pass.
- The eval scan target is tested with a fixture that vendors a model client in a contract-surface
  file and must produce a finding; a zero-file scan is itself a finding.
- UI behavior (rendering, filters, jump links, Ask view, i18n, dual theme) is verified in a real
  browser against the live CLI data source — the prototype's Playwright checks are the baseline to
  reproduce against real data.

## Out of Scope

- LLM products written to any persistent store (context pages, projections, hash chain) — the
  semantic layer is always read-time computation.
- LLM authoring of deterministic edges: file-evidence edges always come from deterministic parsing.
- Code-level architecture auto-analysis (tree-sitter / source dependency graphs).
- The governance object graph (sessions, routes, gates) as map content.
- Any new web mutation whitelist entry.
- Multi-turn QA conversation, answer streaming, or answer persistence.

## Further Notes

The interaction baseline is the reviewed prototype on the `worktree-knowledge-map` branch
(commits `82505a7..bc70805`): force-cluster layout, node detail with mini context graph and `+N`
indicator, local jump links, edge rows, en/zh i18n. Its fixture is a DTO-shape reference only —
the shipped surface reads real repository data end-to-end.

The frozen wayfinder decisions (#238, #239, #241, #242, #243, #244, #245, #240) are recorded on
the GitHub mirrors; this Spec is the content authority that supersedes them for implementation.
The earlier "LLM never authors map content" decision was revoked by product choice with guardrails
intact: deterministic and inferred artifacts stay forcibly distinct in DTO and UI, and governance
audit can always tell which edges are file evidence.

## Post-delivery amendments

Recorded from the #267 review so these constraints are documented rather than folklore; each
already holds in the shipped implementation.

- **Ask requires explicit consent.** `knowledge.ask` takes `allowExternal: z.literal(true)`, so a
  request that omits the acknowledgement is rejected before any provider call. This is stricter
  than the disclosure described above, and deliberately so.
- **The semantic cache key is a superset.** Beyond `(source content hash, promptHash, model)` the
  cache also binds provider and endpoint, so swapping providers can never serve another provider's
  inference. Narrowing the key would weaken that isolation.
- **Node provenance stops at the CLI output.** Every node in the deterministic stream carries
  `provenance: 'deterministic'` in the schema-validated graph; the web DTO omits the field because
  the read-time layer never produces inferred *nodes* — only inferred edges and summaries, which do
  carry it. An absent field on `KnowledgeNode` is by design, not an omission.
- **Artifact trace verbs are folded on purpose.** The Governance Graph (ADR-0021) keeps
  `refines` / `realizes` / `supersedes` per resolved Trace; this map folds `refines` and `realizes`
  into `builds-on`, and `decides` into `references`, to stay inside its four-verb vocabulary. The
  finer distinction stays recoverable from the Governance Graph, never from this map.
