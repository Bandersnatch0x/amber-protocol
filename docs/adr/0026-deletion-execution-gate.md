# ADR-0026: Deletion Execution Is Governance Settlement, Never Content Destruction

**Status:** Accepted (2026-08-29)
**Date:** 2026-08-29
**Builds on:** [ADR-0003](0003-governance-gated-execution.md) (governance-gated execution),
[ADR-0011](0011-safety-philosophy-upgrades.md) (uncertainty fails closed),
[ADR-0024](0024-read-only-adapters-and-explicit-cutover.md)

---

## Context

F055 (Retention, Coordinated Deletion & Proof) requires that "enabling deletion execution requires
a dedicated accepted ADR; until then, existing retention surfaces remain report-only." The
`amber retention` surface now carries `execute`, `settle`, `status`, and `proof` beyond the
report-only classification/evaluation/candidate commands, so the enablement decision must be
recorded explicitly — including exactly how little "execution" means here.

## Decision

1. **What is enabled.** Deletion execution is governance settlement only: `retention execute`
   opens one transaction per human-authorized candidate, and `retention settle` records one
   declared receipt per registered Holder. Both write exclusively to the hash-chained ledgers
   under `.amber/retention/`. Amber deletes no bytes, dispatches no Adapter, and touches no
   canonical artifact Body or Envelope — the deletion effect happens inside each Holder's own
   system, performed by its owner, and Amber records the declared receipt.
2. **Preconditions ride the surface, not convention.** Execution refuses a candidate that is not
   human-authorized (bounded, single-use approval consumed at authorization), Legal Hold has
   priority (held records never enumerate into a candidate), duplicate execution of a candidate
   refuses, and a retry settles only the existing transaction's unsettled Holders — a settled
   Holder can never repeat.
3. **No overclaiming.** Any unknown, refused, failed, or unavailable Holder keeps the transaction
   `deletion-pending`; the Deletion Proof derives only from full settled coverage and carries a
   controlled proof fingerprint, never a public reconstructable content hash.
4. **Deletion becomes effective inside Amber on the read side.** Records named by a deletion
   transaction project as redacted or pending tombstones in the Governance Graph (minimal stable
   identity plus the transaction reference; content-bearing fields and outgoing trace edges
   withheld), and Gate evaluation refuses a tombstoned subject — historical existence is not
   current proof.
5. **Adapter-dispatched deletion stays gated.** A capability that lets Amber itself perform a
   Holder-side deletion effect (calling an external system through a registered Adapter) is NOT
   enabled by this ADR. It requires its own accepted ADR on top of the F056 external-effect
   governance (registered write capability, admission, approval, isolation, receipts).

## Consequences

Coordinated deletion can settle and prove without Amber acquiring any destructive capability, and
an auditor can distinguish "Amber recorded the deletion" from "Amber performed the deletion" — the
latter never happens today. The cost is that operators settle each Holder explicitly with a real
receipt from the owning system; there is no one-command purge, and a transaction stays visibly
`deletion-pending` until every registered Holder settles.

## Rejected alternatives

- Executing Holder deletions from Amber via Adapters now would grant a destructive external write
  capability before F056's external-effect governance exists, violating ADR-0003.
- Physically deleting canonical artifact bytes on settlement would break hash-chained journal
  verification and turn every read of the store fail-closed; redacted tombstone projection keeps
  the store verifiable while removing content from every projection consumers read.
- Leaving execution ungated (no ADR) would contradict the F055 spec's explicit enablement
  requirement and hide the report-only → settlement transition from review.

## Related

- `docs/specs/F055-retention-coordinated-deletion-proof.md` (Further Notes: dedicated accepted ADR)
- [ADR-0021](0021-canonical-artifact-governance-graph-integration.md) (the Governance Graph is the
  only graph projection; tombstones ride it)
