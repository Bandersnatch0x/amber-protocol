# ADR-0021: Canonical Artifacts Reuse the Governance Graph Projection

**Status:** Accepted (2026-08-26)
**Date:** 2026-08-26
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (artifact-first governance),
[ADR-0016](0016-deep-governance-decision-seams.md) (explicit decision seams),
[ADR-0019](0019-distributed-governance-stage1-decisions.md) (contract-first schemas)

---

## Context

The Amber 2.0 RFC names an `Artifact Graph` for Intent, Spec, Plan, Eval, Finding, and related
records. Amber already has an Amber Core state model, a Governance Graph, registered Action Types,
and bounded MCP/read-model contracts. The Governance Graph is explicitly a rebuildable projection,
not a write authority. Introducing a second graph or artifact store would make status, provenance,
and approval ownership ambiguous.

## Decision

1. Intent, Spec, Plan, Eval, Finding, and Trigger Proposal are registered Amber Artifact types or
   related governed records in the existing Core model.
2. The existing Governance Graph remains the only graph projection. Its registry, schemas, edges,
   rebuild receipts, freshness checks, and bounded queries may be extended for 2.0 types.
3. Canonical Artifacts remain the write authority. Graph nodes, adapters, and read models carry
   source references, hashes, provenance, projection-rule versions, and freshness; they never own
   mutable lifecycle state.
4. New CLI or MCP surfaces must be registered Action Types and obey existing target containment,
   approval-required mutation, and bounded-query contracts.
5. A Trigger Proposal is a projected/request record, not an implicit transition or execution
   command. A deterministic adapter must re-check input freshness and Gate prerequisites.

## Consequences

There is one provenance and status authority, and existing projection rebuild and MCP safety rules
remain reusable. The 2.0 schema work must extend current registries rather than ship a parallel
graph implementation. Cross-context projections may expose 2.0 nodes only with explicit linkage
and freshness state.

## Rejected alternatives

- A separate 2.0 Artifact Store/Graph would create competing authorities and a synchronization
  problem before the protocol has a stable contract.
- Treating graph nodes as mutable records would violate the existing Projection and Governance Graph
  definitions.

## Related

- Amber 2.0 RFC Roadmap, §§2–4 (Draft RFC-0.2, 2026-08-26)
- [ADR-0004](0004-evidence-grade-verification.md)
- [ADR-0012](0012-protocol-and-schema-versioning.md)

