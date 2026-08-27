# ADR-0023: Canonical Artifacts Bind a Human Body to a Versioned Envelope

**Status:** Accepted (2026-08-26)
**Date:** 2026-08-26
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (artifact-first history),
[ADR-0012](0012-protocol-and-schema-versioning.md) (schema/version domains),
[ADR-0021](0021-canonical-artifact-governance-graph-integration.md)

---

## Context

Amber 2.0 needs artifacts that humans can review and machines can validate. A single opaque JSON
record would be difficult to edit, while an unversioned Markdown file plus mutable side metadata
would create a second status authority. The Body and Envelope therefore need a binding and revision
rule before schemas or adapters are implemented.

## Decision

1. A Canonical Artifact is a bound pair: one human-readable Artifact Body and one machine-actionable
   Artifact Envelope. The pair is committed atomically and shares identity, revision, provenance,
   and lifecycle references.
2. `contentHash` covers the documented canonical serialization of the Body. The Envelope has its
   own canonical hash and records the Body hash, schema/policy versions, revision, and `supersedes`
   linkage.
3. Any Body or Envelope change creates an append-only revision. Status and decision references are
   never edited in place or stored in a third mutable sidecar.
4. Canonical serialization, hash encoding, required fields, and pair-binding validation are
   normative schema contracts delivered by M0. A projection or adapter may cache either side but
   cannot replace the pair as authority.

## Consequences

Human review and machine validation can use different representations without losing integrity.
Every mutation has a new revision and hash, so projections and external links must carry revision
identity. Tooling must reject an orphaned Body, orphaned Envelope, mismatched hash, or non-atomic
pair.

## Rejected alternatives

- Hashing only Markdown while leaving Envelope metadata mutable permits status and provenance drift.
- Making one opaque serialization the only user-facing form sacrifices reviewability and does not
  remove the need for explicit revision semantics.

## Related

- Amber 2.0 RFC Roadmap, §§3.1–3.2 (Draft RFC-0.2, 2026-08-26)
- [ADR-0019](0019-distributed-governance-stage1-decisions.md)

