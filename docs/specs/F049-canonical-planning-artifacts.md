# F049: Canonical Planning Artifacts

**Status:** Proposed  
**Depends on:** None  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#209](https://github.com/Bandersnatch0x/amber-protocol/issues/209)

## Problem Statement

Amber records plans, decisions, and projections, but it does not yet expose one canonical contract
for Intent, Spec, and Plan revisions. Human-readable content, machine metadata, lifecycle state, and
Governance Graph nodes can drift or be mistaken for independent authorities. Concurrent edits and
retries also lack a single durable admission contract.

## Solution

Introduce repository-local Canonical Planning Artifacts. Each Intent, Spec, and Plan revision binds
a human-readable Artifact Body to a machine-actionable Artifact Envelope. Revisions are immutable,
admitted through deterministic compare-and-swap transactions, linked by typed Trace records, and
projected into the existing Governance Graph without granting the projection write authority.

## User Stories

1. As a product owner, I want an Intent to state outcome, scope, constraints, and non-goals, so that work starts from an explicit need.
2. As a technical owner, I want a Spec to refine one accepted Intent revision, so that requirements remain traceable.
3. As an engineer, I want a Plan to realize one approved Spec revision, so that implementation cannot silently change its inputs.
4. As a reviewer, I want a human-readable Artifact Body, so that governance records remain reviewable in version control.
5. As an integration author, I want a machine-actionable Artifact Envelope, so that identity, revision, scope, provenance, and hashes are deterministic.
6. As a Canonical Owner, I want Body and Envelope admitted as one revision, so that neither can drift independently.
7. As a Canonical Owner, I want stable Artifact identity and monotonic immutable revisions, so that history is never rewritten.
8. As a concurrent editor, I want expected-head compare-and-swap, so that another accepted revision cannot be overwritten.
9. As a caller, I want idempotent retries bound to canonical content, so that retries do not create duplicate revisions.
10. As an auditor, I want typed `refines`, `realizes`, and `supersedes` Trace records, so that lineage is explicit rather than inferred from filenames.
11. As a graph consumer, I want the Governance Graph rebuilt deterministically, so that a projection cannot become a second authority.
12. As an operator, I want incomplete, mismatched, cyclic, cross-scope, or corrupt revisions rejected with stable errors, so that projections never guess missing authority.
13. As a maintainer, I want unknown required versions and fields rejected, so that compatibility cannot silently change semantics.
14. As a maintainer, I want bounded Artifact and projection resource limits, so that partial output is never mistaken for a complete record.

## Implementation Decisions

- The existing Governance Graph is the only graph projection and remains rebuildable and read-only.
- Intent, Spec, and Plan are registered Artifact Types with closed lifecycle and transition contracts.
- Each revision consists of an Artifact Body, Artifact Envelope, canonical content hash, provenance,
  scope, revision identity, expected head, and admission receipt.
- Canonical identity is owner-generated. Caller idempotency keys, filenames, titles, branch names,
  external ticket IDs, and display URLs are not authority.
- Admission uses durable `prepared`, `committed`, and `aborted` settlement with append-only journal
  records. Only fully committed revisions are visible to projections and queries.
- Exact duplicates return the original result. Reused idempotency keys with different content, or a
  changed expected head, fail closed as conflict or corruption.
- Trace types, directions, scope, and cardinality are registered and versioned. A generic relation
  cannot satisfy required planning lineage.
- Markdown is a human representation of the Artifact Body. A manual change is new admission input,
  not an in-place status mutation.
- Projection rebuild records source checkpoint, rule and schema versions, result hash, and receipt;
  it never repairs or writes Canonical Artifacts.
- Canonical serialization, hashes, times, version negotiation, extension namespaces, stable errors,
  and resource ceilings are explicit contracts.

## Testing Decisions

- The highest seam is public Artifact admission followed by public projection rebuild and query.
- Tests assert externally visible revisions, receipts, Trace lineage, projection output, stable
  errors, and whether authority changed; they do not assert private helper calls.
- Exact fixtures cover canonical serialization, Body/Envelope binding, identity, revision, hashes,
  status names, and error codes.
- Semantic fixtures cover required Intent → Spec → Plan lineage, scope confinement, omitted-Spec
  policy, immutable history, and projection non-authority.
- Integrity fixtures cover compare-and-swap races, idempotency collisions, partial transactions,
  journal tampering, orphaned Body or Envelope, cyclic Trace, and deterministic rebuilds.
- Prior art is the existing Action Type schema integration, governance graph, projection registry,
  sync admission, ledger, and CLI integration suites.

## Out of Scope

- Human Approval, Gate evaluation, and Evidence Assurance beyond the references needed by planning.
- Runner execution, deployment, maintenance automation, deletion, external writes, or break-glass.
- A second graph, mutable Markdown authority, last-write-wins merge, or automatic conflict repair.

## Further Notes

This is the foundation for F050 and F051. It introduces no new target-command or external-write
authority.
