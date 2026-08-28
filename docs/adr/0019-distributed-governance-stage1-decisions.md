# ADR-0019: Distributed Governance Stage 1 — Contract-First Ordering, Envelope Schema Placement, and Identity Bootstrap

**Status:** Accepted
**Date:** 2026-08-23
**Builds on:** ADR-0001 (governance-first, artifact-first), ADR-0009 (contract-driven context distillation), ADR-0012 (protocol and schema versioning)
**Authority:** `docs/architecture/distributed-governance-baseline.md` (Accepted), GitHub #158

---

## Context

The distributed-governance baseline (`docs/architecture/distributed-governance-baseline.md`) is accepted. It defines six bounded contexts, three deployment profiles, a 12-row invariant traceability matrix, and three ADR amendments (ADR-0001, ADR-0009, ADR-0012). Issue #158 implements the baseline as a staged, evidence-gated build.

Before implementation, five open decisions needed adjudication. A roundtable debate produced positions for each; the decisions below are the resolved outcomes.

## Decisions

### D3: Stage 1 ordering — Contract-first

Stage 1 delivers ADR-0001/0009/0012 amendments + the versioned protocol/artifact model schema only. Personal Node is Stage 2. Team Hub is Stage 3. Organization is Stage 4.

**Rationale.** The baseline's invariant traceability matrix lists ADR-0001 and ADR-0012 amendments as foundational — every downstream bounded context depends on them. Personal Node is already working repo-local Amber Core (`scripts/amber.js`, full CLI, session lifecycle, evidence ledger); Stage 1 does not re-deliver it. Stage 1 delivers the versioned protocol/artifact model that makes Personal Node *configurable* as a distributed profile. A contract-only stage was proven viable by ADR-0012, which shipped pure metadata (versioning fields, execution routing taxonomy, migrate backfill) with no new user-visible behavior.

**Rejected alternative.** Contract + Personal Node in Stage 1. Mixing contract and profile work risks double waste: if the contract is wrong, the profile work is wasted; if the profile work forces contract compromise, the contract is contaminated.

### D2: Envelope schema placement — New files

The sync envelope and structural identity schemas are added as new files: `schemas/sync-envelope.schema.json` and `schemas/structural-identity.schema.json`.

**Rationale.** The baseline separates Amber Core (governed Actions and Functions) from Sync Runtime (immutable envelopes, bounded delivery) as distinct bounded contexts. An envelope is a transport payload, not a governance operation — `schemas/action.type.schema.json` defines operations a user submits (session start, route test, governance report). Conflating them violates the bounded-context boundary. The existing `schemas/` convention is one concept per file (15 files, 15 concepts); adding 2 files follows the established pattern.

**Rejected alternative.** Extend `action.type.schema.json` with envelope fields. This conflates governance operations with transport payloads and mixes two bounded contexts in one schema.

### D4: Identity bootstrap — Hybrid

Personal Node bootstraps identity via git inference for Person/Agent (zero-config default from `git config user.name`/`user.email`) with `.amber/identity.json` as an optional override for Tenant/Organization/explicit identity. When `.amber/identity.json` is present, it wins over git inference. Default Tenant is `local`, default Organization is `personal`. As shipped, git inference covers `personId` only; `agentId` is never inferred and requires explicit declaration.

**Rationale.** Person/Agent are low-risk local display identifiers — git config is the de facto developer identity and inferring it is zero-friction. Tenant/Organization affect admission/mapping when joining Team Hub — they need explicit declaration. The hybrid satisfies the baseline's "one explicit deterministic local Tenant, Organization, and Person scope": defaults are explicit (hardcoded, not guessed) and deterministic (always the same), and the override seam (`.amber/identity.json`) provides explicit identity when needed. For solo Personal Node use, it is zero-config; for Team Hub joining, it is explicit.

**Rejected alternatives.** (A) Local config file only — forces users to write identity JSON before first use, adding adoption friction. (B) Git inference only — git config is not governance identity; no Tenant/Organization concept, not deterministic across machines.

### D1: Transport choice — Deferred to Stage 3

Stage 1 delivers the envelope schema (shape: version, identity, provenance, conflict records) but does not select a transport technology. Transport choice is deferred to Stage 3 (Team Hub), when the actual sync requirements are known.

**Rationale.** D3 chose contract-first — Stage 1 is schema/ADR, not runtime. The envelope schema defines what is transported, not how. Deferring transport avoids locking a technology before Team Hub's real needs are visible. The risk of schema rework is mitigated by the #160 fixture family, which validates envelope shape deterministically — if the shape is right, the transport layer is swappable.

### D5: Projection scope — Schema reservation + documentation

Stage 1 reserves projection versioning fields in the ADR-0012 amendment (`projection_type`, `projection_version`, `rebuild_checkpoint`) and documents the projection interface contract. No projection code is built in Stage 1. Projections (Governance Graph, Governed Knowledge Base, Visualization Workbench) are Stage 4.

**Rationale.** Contract-first delivers contracts, not stubs. The baseline's invariant matrix row 5 directs "amend ADR-0012 for projection and interchange versioning." Reserving schema fields in Stage 1 means the projection interface is contractually defined without dead code. Stage 4 fills the implementation against an already-validated schema.

**Rejected alternatives.** (A) Fully defer — no schema reservation; risks rework when projections need versioning fields not present in the schema. (B) Empty stubs — dead code in Stage 1 with no behavior to validate.

## Consequences

**Positive.** Stage 1 is a single-concern contract stage: three ADR amendments, two new schemas, one identity bootstrap mechanism. It is verifiable through the existing fixture family and schema validators. Every downstream stage builds on a validated contract.

**Negative.** Stage 1 has no user-visible behavior — it is pure schema/ADR work. This is acceptable: ADR-0012 set the precedent, and the fixture family provides deterministic validation of the contract shape.

**Neutral.** Transport technology remains open until Stage 3. The envelope schema is designed to be transport-agnostic; the fixture family validates shape, not transport.

## Related

- ADR-0001 (governance-first, artifact-first) — amended by this stage
- ADR-0009 (contract-driven context distillation) — amended by this stage
- ADR-0012 (protocol and schema versioning) — amended by this stage
- `docs/architecture/distributed-governance-baseline.md` — accepted baseline
- GitHub #158 — distributed governance implementation specification
- GitHub #160 — deterministic fixture family (shipped: 7 fixtures, 4 paths, 3 profiles, 2 variants)
