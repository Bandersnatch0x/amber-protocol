# ADR-0012: Protocol and Schema Versioning — Execution Routing and Context Persistence

**Status:** Accepted
**Date:** 2026-08-07
**Builds on:** ADR-0003 (governance-gated execution), ADR-0011 (governance-readiness scoring)

---

## Context

Amber Protocol produces inspectable artifacts (loop contracts, session manifests, routes,
timeline events, knowledge plans, workflow assessments, context pages, context requests). As the
artifact surface grows and execution routing becomes richer, two gaps emerge:

1. **Artifact drift.** There is no machine-readable way to detect when an artifact was produced by
   an older protocol version whose semantics differ from the current install. This makes migrations
   and schema evolution opaque.
2. **Execution routing classification.** ADR-0003 introduced governed loop execution and route
   command-stages, but the taxonomy for *how* a route or loop should be dispatched (direct,
   bounded-loop, swarm, DAG) lives as informal conventions, not as validated fields.
3. **Execution context persistence.** When a loop or session is executed, the environment
   (engine, model, reasoning effort, who pinned it and when) is only captured ad hoc, which
   weakens auditability and reproducibility.

These three concerns are related: they all deal with the *metadata layer* that sits above every
Amber artifact and makes governance, migration, and introspection systematic rather than
hand-crafted per artifact.

## Decision

### 1. Versioned wire protocol

Every artifact schema gains four **optional** top-level fields:

- `amber_protocol_version` (string) — the Amber package version that produced or last touched
  this artifact.
- `artifact_sequence` (integer) — a monotonically-increasing sequence number within the
  artifact's identity scope.
- `created_at` (string, `format: date-time`) — ISO 8601 timestamp of first creation.
- `artifact_type` (string) — a stable discriminant (e.g. `"loop-contract"`, `"route"`,
  `"session-manifest"`).

All four fields are optional and **never added to `required` arrays**. Legacy artifacts without them
must continue to validate. Amber tooling MAY populate these fields when writing artifacts and
MUST NOT reject artifacts that lack them.

### 2. Execution routing taxonomy

`route` and `loop-contract` gain an optional `execution_mode` field:

```json
"execution_mode": { "enum": ["direct", "bounded_loop", "swarm", "dag"] }
```

This is a **declarative** classification, not a real-time scheduler. It tells host agents and
governance tooling *how* the route/loop should be dispatched when a human triggers execution.

- `direct` — single linear stage pipeline.
- `bounded_loop` — iterative with a hard stop ceiling (`loop-contract.hardStops.maxIterations`).
- `swarm` — parallel fan-out of independent sub-tasks.
- `dag` — stage graph with explicit dependencies (`route.gates`).

Route also gains an `objective` field (short, machine-readable goal) alongside the existing
`description` field. These are consumed by next-command matching logic in other subsystems.

### 3. Execution context persistence

`loop-contract` and `session-manifest` gain an optional `execution_context` block:

```json
"execution_context": {
  "type": "object",
  "properties": {
    "engine": { "enum": ["claude-code", "codex", "cursor"] },
    "model": { "type": "string" },
    "reasoning_effort": { "enum": ["low", "high", "max"] },
    "pinned_at": { "type": "string", "format": "date-time" },
    "pinned_by": { "type": "string" }
  }
}
```

This captures the execution environment at the moment a human pins a contract or starts a session,
providing an auditable record of which engine/model was used.

### 4. Doctor version drift

`amber doctor` gains a check that scans artifacts for `amber_protocol_version`. When the field is
present and does not equal the current package version, a **warning** is emitted so users can
trigger a `migrate` backfill.

### 5. Migrate backfill

`amber migrate` learns to backfill the four optional versioning fields into existing artifacts:
`amber_protocol_version` set to the current package version, `artifact_sequence` to `0`,
`created_at` to the file's `mtime`, and `artifact_type` inferred from artifact content or path.
The operation is idempotent — running it twice produces the same result.

## Consequences

**Positive:** artifacts become self-describing; the protocol version enables safe schema evolution;
execution routing and context become first-class, validated concepts; doctor and migrate cover the
full lifecycle.

**Negative:** the optional fields increase schema surface; tooling must handle both populated and
absent states everywhere, which adds branching in migration and validation code.

**Neutral:** backward compatibility is preserved by keeping all new fields optional and never
modifying `required` arrays. Legacy artifacts in the wild are unaffected.

## Related

- ADR-0003 (governance-gated execution)
- ADR-0011 (governance readiness dimensions)
- ADR-0013 (governance-readiness computeConfidenceClasses)
- ADR-0014 (governance-report integration)

---

## Amendment (ADR-0019, 2026-08-23): Distributed envelope, structural identity, version negotiation, compatibility/refusal, and projection versioning

Per the distributed-governance baseline (`docs/architecture/distributed-governance-baseline.md`)
and ADR-0019, this ADR is amended with the interchange contract for the Sync Runtime bounded
context. The amendment adds five concerns:

### A. Distributed envelope

A new schema, `schemas/sync-envelope.schema.json`, defines the versioned, immutable interchange
contract for transporting governed artifacts across Amber instances. An envelope wraps exactly one
artifact with its content hash, structural identity, origin metadata, and optional conflict record.
Envelopes never carry source code, secrets, agents, tools, or arbitrary files (baseline §Authority
Boundaries, item 6; #158 user stories 19-20).

### B. Structural identity

A new schema, `schemas/structural-identity.schema.json`, defines the ownership-bearing identity
contract that anchors an artifact to its origin tenant, repository, and generation. Structural
identity is immutable within a generation; a fenced repository transfer starts a new generation
and terminates old-tenant role and policy applicability (baseline §Deployment Profiles).

### C. Version and capability negotiation

The envelope carries a `versionNegotiation` block: `amberProtocolVersion`, `minCompatibleVersion`,
and a `capabilities` array. This enables compatibility checks: an instance that cannot interpret
the envelope's protocol version or lacks a declared capability must refuse the envelope rather
than silently downgrading semantics (baseline invariant: "No hidden authority or execution";
#158 user story 26: mixed-version tests).

### D. Compatibility/refusal contract

Refusal is explicit and recorded. A refused envelope produces a conflict record with
`conflictType: "version-mismatch"` and `resolution: "pending"`. Conflicts are never silently
overwritten (baseline invariant: "Conflict preservation and governed resolution"; #158 user
stories 5, 17).

### E. Projection versioning

The ADR-0012 versioning fields (`amber_protocol_version`, `artifact_sequence`, `created_at`,
`artifact_type`) are extended to projection artifacts. Three new optional fields are reserved for
projection schemas (to be defined in Stage 4):

- `projection_type` (string) — the projection kind (governance-graph, knowledge-base,
visualization-workbench).
- `projection_version` (integer) — the projection schema version.
- `rebuild_checkpoint` (string) — the checkpoint anchor for deterministic rebuild.

These fields are reserved now so that projection schemas defined in Stage 4 inherit the ADR-0012
versioning surface without a breaking amendment. No projection code is built in Stage 1 (ADR-0019
decision D5).

The invariant traceability matrix (baseline rows 4, 5, 11) directs this amendment.
