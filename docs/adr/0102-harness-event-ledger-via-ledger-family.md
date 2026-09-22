# ADR-0102: The Harness Event Ledger Composes the Governed-Ledger Factory

**Status:** Proposed (2026-09-22)
**Date:** 2026-09-22
**Builds on:** [ADR-0028](0028-ledger-family-factory-and-decision-primitives.md) (one factory,
one dialect; byte-compatibility contract), [ADR-0012](0012-protocol-and-schema-versioning.md) (closed-field versioning conventions), the shared governed-ledger core
(`scripts/lib/core/registry-ledger.js`, `scripts/lib/core/ledger-family.js`), and the Harness
v2 proposal §4.5/§15/§47.

---

## Context

V2.2 requires a tamper-evident, append-only, run-scoped Event Ledger as the system-of-record
evidence ("Metrics 是聚合视图；Event 是事实") and explicitly demands consistency with the
existing governed execution hash-chain ledger "而不是另造一套完全不同的审计机制". The repo
already owns exactly that machinery: `defineLedgerFamily` (ADR-0028) is the one admission path
for new families, carrying the full-orchestration dialect (append lock, ceiling-bounded
appends, chain-walked folds, fail-closed reads). Adding a thirteenth family is the cheap path;
hand-rolling a parallel hash chain would create a second audit dialect — the exact drift
ADR-0028 exists to prevent.

## Decision

1. **One family, the factory way.** Harness events append through `defineLedgerFamily` as the
   `harness` family. State lives under `.amber/harness/` (`events.jsonl`); paths resolve via
   the state-dir seam (`statePath`/`statePathForCreate`), never hand-joined (seam-guard
   invariant). The family rides the governed-ledger core's chain hash, exclusive append lock,
   ceiling bounds, and fail-closed reads — no second hash implementation anywhere.
2. **One event schema, closed type enum.** `schemas/event.schema.json`, `apiVersion:
   amber.dev/v1`: `id`, `timestamp` (UTC), `runId`, `type` (closed enum), `actor`,
   `action` (tool/resource), `decision` (result/policy/version), `inputHash`, `outputHash`,
   plus the chain fields the factory dictates. H0 seeds the enum with the types the vertical
   slice emits (`run.*`, `policy.evaluated`, `approval.requested/granted`,
   `execution.started/completed/failed`, `validation.completed`); new types arrive as additive
   schema changes, and closed-field growth follows the ADR-0012 ALLOWED/REQUIRED split.
3. **Append-only, run-scoped, causally attributable.** Every event names its run; nothing
   downstream may edit or delete an event; a corrupt or out-of-order chain fails every read
   closed.
4. **Events are facts; metrics are aggregates.** Any counters/metrics surface (H6+) must be
   derivable by folding the ledger, never maintained as a parallel truth.
5. **Vocabulary.** CONTEXT.md carries **Harness Event** and **Harness Event Ledger**.

## Consequences

The thirteenth family costs a data table plus a domain fold instead of a new audit mechanism,
and inherits reviewable, already-tested fail-closed semantics. The cost: the family inherits
the factory's append ceremony and ceiling budget, and the closed enum needs deliberate care
when new event kinds appear.

## Rejected alternatives

- **A free-standing JSONL audit log outside `.amber/`** breaks the state-dir seam and the
  fail-closed read guarantee.
- **A parallel hash-chain implementation "just for events"** creates a second audit dialect —
  precisely the drift ADR-0028 bans.
- **Open-ended event types** break closed-field validation and make the ledger unfalsifiable.
