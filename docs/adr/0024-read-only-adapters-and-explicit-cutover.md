# ADR-0024: Legacy and External Records Migrate through Read-Only Adapters

**Status:** Accepted (2026-08-26)
**Date:** 2026-08-26
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (never overwrite user files),
[ADR-0011](0011-safety-philosophy-upgrades.md) (uncertainty fails closed),
[ADR-0021](0021-canonical-artifact-governance-graph-integration.md)

---

## Context

The 2.0 RFC names `feature_list.json`, `plans/`, handoff records, workflow reports, and external
ticket/incident/release systems as migration surfaces. Their ownership and formats differ. A bulk
import or silent rewrite would manufacture history and make it impossible to tell whether Amber or
the external system is authoritative.

## Decision

1. Migration starts with lazy, read-only Adapters. Each Adapter preserves source bytes, source hash,
   provenance, external identity, and an explicit link to any derived Canonical Artifact.
2. Canonical Owner is declared per artifact type and scope. Until an explicit Cutover, the legacy or
   external owner remains authoritative; Amber projections cannot silently promote a derived record.
3. Unavailable source, changed hash, contradictory records, and unsupported shapes are represented
   explicitly as `unavailable`, `stale`, `conflict`, or `unmapped`. None may satisfy `accepted`,
   `approved`, or `verified` conclusions.
4. Cutover is explicit, bounded, reversible, and approval-gated. It requires a dry-run, compatibility
   fixtures, source and target hashes, backup/restore or rollback evidence, and a declared owner
   change. Historical records are not rewritten or deleted to make the cutover appear clean.
5. Adapter removal is allowed only after compatibility fixtures pass in CI and the replacement
   owner can reproduce required traces and provenance.

## Consequences

Adoption can proceed without changing user-authored files, and uncertainty remains visible. The cost
is duplicated read paths during migration and an explicit reconciliation step before ownership can
move. Automation must treat all non-verified adapter states as read-only.

## Rejected alternatives

- Bulk import with immediate Amber ownership would lose source authority and create false history.
- Letting Amber overwrite an external system would violate the repository-local product boundary and
  require an unapproved third-party write surface.

## Related

- Amber 2.0 RFC Roadmap, §10 and M5 (Draft RFC-0.2, 2026-08-26)
- [ADR-0003](0003-governance-gated-execution.md)
- [ADR-0020](0020-governed-live-git-transport.md)
