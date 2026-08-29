# F055: Retention, Coordinated Deletion & Proof

**Status:** Proposed  
**Depends on:** F051  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#215](https://github.com/Bandersnatch0x/amber-protocol/issues/215)

## Problem Statement

Amber can report retention candidates, but report-only eligibility is not deletion. Canonical
records, raw output, caches, indexes, exports, external Holders, and Legal Hold have different
obligations. Deleting one local file and claiming complete erasure would be unsafe, while retaining
public hashes or sensitive receipts can preserve the very data that deletion intends to remove.

## Solution

Add governed retention classification, deletion candidates, registered Holder aggregation,
Legal Hold, approved Adapter execution, deletion-pending settlement, and a minimal Deletion Proof.
The Proof states only the declared and settled coverage. Unknown or failed Holders prevent a deleted
claim. Sensitive content is removed while a controlled, non-public proof fingerprint and minimal
governance metadata remain.

## User Stories

1. As a retention owner, I want each admitted record assigned an effective retention class and Policy, so that expiry is deterministic.
2. As a privacy owner, I want secrets and personal data blocked or minimized before storage, so that deletion is not the first privacy control.
3. As a legal owner, I want Legal Hold to override ordinary TTL, so that required records are not deleted.
4. As a legal owner, I want Hold scope, reason, issuer, effective time, and release recorded, so that it cannot become an invisible permanent exception.
5. As an operator, I want a deletion candidate generated without deleting content, so that scope and protected records can be reviewed.
6. As a deletion approver, I want exact record, Holder, scope, Policy, and expected effects, so that authorization is bounded.
7. As a Holder owner, I want my registered Adapter to return a real deletion receipt, so that settlement is evidence-backed.
8. As a deletion operator, I want body, raw output, cache, index, export, and Subscription copies included when registered, so that known copies are coordinated.
9. As an auditor, I want status remain deletion-pending while any registered Holder is unknown or failed, so that Amber cannot overclaim completion.
10. As an auditor, I want a minimal Deletion Proof, so that the governed action remains reviewable without retaining deleted content.
11. As a privacy owner, I want controlled proof fingerprints instead of public reconstructable hashes, so that proof does not preserve personal data.
12. As a graph consumer, I want deleted records represented as redacted or pending tombstones, so that projections do not recreate content.
13. As a Gate owner, I want deleted Evidence unable to satisfy replay or content-dependent Gates, so that historical existence is not mistaken for current proof.
14. As a recovery operator, I want partial settlement explicit and retryable only for unsettled Holders, so that a retry cannot repeat completed deletion effects.

## Implementation Decisions

- Retention classes have protocol-defined semantics while TTL and legal basis resolve from versioned
  tenant Policy at admission.
- Secret or personal raw content is rejected or minimized before canonical storage. Deletion does
  not justify collecting unsafe content first.
- A deletion candidate is governance-write only. It enumerates exact records, retention basis,
  Legal Hold state, registered Holders, and proposed effects without deleting.
- Legal Hold has priority over TTL and normal deletion. Hold creation and release are immutable
  human Decisions.
- Deletion execution is a registered Adapter capability with explicit approval, scope, credentials,
  isolation, receipt, and retry behavior.
- Every known Holder settles independently. Any unavailable, unknown, refused, or failed Holder
  keeps the transaction `deletion-pending`.
- Deletion Proof records transaction identity, declared coverage, Holder receipts, Policy and legal
  basis, settlement time, and a controlled proof fingerprint. It does not claim universal physical
  erasure.
- Projection tombstones preserve minimal stable identity and Proof reference but cannot expose or
  reconstruct deleted content.
- Tombstone and Proof reads fail closed across ledgers: a deletion transaction whose candidate no
  longer resolves (candidate ledger removed, emptied, or truncated) refuses the read instead of
  treating the missing half as empty — tombstones never silently vanish.
- Historical Evidence may prove that an event occurred but cannot satisfy a new Gate requiring raw
  content, replay, or current freshness.

## Testing Decisions

- The highest seam is retention evaluation → deletion candidate → approval → Holder fixtures →
  pending or completed Proof.
- Tests assert candidate scope, Holds, Holder effects, receipts, tombstone projection, Proof,
  stable errors, and absence of deleted content.
- Exact fixtures cover retention, Hold, candidate, Holder receipt, Proof, and error contracts.
- Semantic fixtures cover TTL, Legal Hold, multiple Holders, unknown Holder, partial deletion,
  retries, redacted projection, and Gate consumption after deletion.
- Integrity fixtures cover public-hash leakage, proof fingerprint separation, changed Holder
  registry, duplicate execution, concurrent settlement, tampered receipt, and journal breakage.
- Prior art is context retention, context deletion, organization retention audit, memory privacy,
  projection freshness, Adapter, and ledger suites.

## Out of Scope

- Claiming deletion outside registered Holder coverage or proving physical media erasure.
- Automatic deletion from a retention report, silent Legal Hold bypass, or retaining deleted raw output for debugging.
- Unregistered external-system deletion; F056 governs external effects.

## Further Notes

Enabling deletion execution requires a dedicated accepted ADR. Until then, existing retention
surfaces remain report-only.
