# ADR-0025: Code Nodes Enter the Knowledge Graph; Anchors Become First-Class Edges

**Status:** Accepted (2026-08-28)
**Date:** 2026-08-28
**Builds on:** [ADR-0021](0021-canonical-artifact-governance-graph-integration.md) (projection discipline),
F059 spec (`docs/specs/F059-knowledge-decision-map.md`) whose two frozen rules this decision supersedes in part.
**Decided in:** Knowledge Map v2 wayfinder, ticket #261 (map #260).

---

## Context

F059 froze two rules for the v1 knowledge graph: "Code files are not nodes" and "`anchors` is a
node property, never a ghost edge." Both rested on the same premise — the graph had no code-level
vertices, so an anchor edge would have pointed at nothing. Knowledge Map v2 re-scopes code-level
analysis in (the F059 out-of-scope entry for syntax-tree parsing is re-chartered by the v2 spec),
which removes that premise. Meanwhile the graph must keep its deterministic contract: schema
validation, stable order, byte-identical recompute (F059), and the projection discipline of
ADR-0021.

Scale facts at decision time: 105 nodes / 92 edges in the v1 graph; ~384 product source files
(scripts/ 248, apps/web 136); exported symbols estimated 1,500–3,000; tests ~396 files. A
symbol-level graph would swamp the document graph thirtyfold; test inclusion would double it again.

## Decision

1. **One graph, one schema.** Code enters the existing knowledge graph via a
   `knowledge-graph.schema.json` extension (schemaVersion 1 → 2), not a parallel sub-graph with a
   second pipeline. Separation of concerns stays a UI/query concern (kind filters).
2. **File-level nodes, symbol tables as properties.** Each product source file becomes one node:
   kind `code`, implementation layer, id `code:<POSIX path>`. Exported symbols ride as a node
   property; symbol-level node promotion is deferred (fog, tied to the progressive-disclosure
   interaction decision).
3. **New verb `imports`.** File-level code dependency edges (import/call aggregated per file pair)
   use a dedicated verb rather than overloading `references`, keeping document-citation semantics
   and code-dependency semantics separable for community detection and audit.
4. **Anchors become edges where the target exists.** `feature -[anchors]-> code` is a real,
   deterministic edge when the anchored file is a Code Node. A dead anchor (path absent from the
   tree) never produces a dangling edge — it keeps surfacing as a drift finding attached to the
   declaring node, exactly as in F059. This supersedes the F059 property-only rule for targets
   that are now nodes; the rule stands for any anchor whose target is not a node (globs,
   directories, non-code paths).
5. **Tests stay out.** `tests/` files are excluded from the v2 graph; a future `test → code`
   coverage edge is recorded as fog, pending a consuming use case.
6. **Determinism is non-negotiable.** Code-node extraction uses the TypeScript compiler API
   (existing dependency, zero new supply chain — ticket #262); output is sorted by
   `(path, startLine, startCol, symbolName)`, paths normalized to POSIX, toolchain version
   recorded in provenance. Recompute over an unchanged tree stays byte-identical.

## Consequences

- Graph scale moves to ~490 nodes — inside the 2,000-node re-evaluation trigger set by the
  analytics research (#259), but past the layered-layout 56-per-layer overlap bug, which must be
  fixed (F059 fix batch #267, P1 defence items) before v2 lands.
- The verb enum and node-kind enum change is a breaking schema bump: readers (web adapter, DTO,
  reader whitelist, LLM prompt vocabulary) must be updated in lockstep, and the F059 ghost-kind
  cleanup (#267 P0-2) should land first so the vocabulary has one source of truth.
- Drift findings gain a graph-visible counterpart: a rename like F001 `scaffolding.js → scaffold.js`
  shows up as the anchors edge re-targeting once the anchor is fixed.
