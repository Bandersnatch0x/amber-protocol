# F050: Decisions, Gates & Evidence Assurance

**Status:** Proposed  
**Depends on:** F049  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#210](https://github.com/Bandersnatch0x/amber-protocol/issues/210)

## Problem Statement

Amber needs to distinguish human decisions, deterministic evaluation, Runner claims, and verified
Evidence. Without a common contract, a passed test, Review, Approval, or Agent assertion can be
mistaken for authority, stale Evidence can satisfy a current Gate, and one actor can effectively
approve or verify its own work.

## Solution

Add versioned Principal, Policy, Decision, Gate Contract, Evidence, Verification, and Trace
contracts on top of Canonical Planning Artifacts. Gate evaluation is deterministic and fail-closed;
Evidence Assurance is explicit; Approval is human, scoped, expiring, revocable, and single-use;
and responsibilities are separated at admission and consumption.

## User Stories

1. As a product owner, I want Acceptance distinct from Approval and Review, so that each record represents one authority.
2. As an approver, I want my verified Principal identity and role bound to a Decision, so that a bare name cannot authorize work.
3. As a security owner, I want submitter, Evidence producer, verifier, and approver separated, so that self-approval fails closed.
4. As a Policy owner, I want organization rules to be a non-relaxable ceiling, so that repository configuration cannot widen permissions.
5. As a Gate owner, I want a versioned Gate Contract, so that conditions and thresholds are reviewable and reproducible.
6. As a Gate owner, I want deterministic `allOf` and bounded explicit `anyOf`, so that hidden weights or model confidence cannot decide admission.
7. As an Evidence producer, I want receipts to bind identity, scope, target, inputs, tools, environment, time, status, and outputs, so that results are assessable.
8. As a verifier, I want `unavailable`, `observed`, `replayable`, and `verified` Assurance kept distinct, so that claims cannot impersonate verification.
9. As a verifier, I want a Runner unable to award itself `verified`, so that assurance requires independent proof.
10. As an approver, I want Approval scope, expiry, revocation, and consumption checked atomically, so that one authorization cannot be replayed.
11. As an auditor, I want historical Decisions preserved when later invalidated or stale, so that history is not rewritten.
12. As a Gate consumer, I want dependency-scoped staleness propagation, so that changed Policy or Evidence invalidates only affected bindings.
13. As a query consumer, I want exact scope, checkpoint, limits, ordering, and expiring cursors, so that partial results cannot satisfy strict Gates.
14. As an API consumer, I want stable, layered, redacted errors, so that remediation never depends on natural-language parsing or leaks secrets.
15. As an Eval owner, I want a versioned assessment definition and recorded outcome, so that deterministic checks can supply Evidence to a Gate without becoming Approval or execution authority.

## Implementation Decisions

- Principal and Verifier identities are rooted in a versioned trust registry and bind membership,
  role, capability, scope, validity, issuer, and revocation state.
- Formal Acceptance, Rejection, Gate Approval, and high-risk decisions require independently
  authenticated humans. Agents and service identities cannot occupy a human approval slot.
- Delegation is explicit, non-transitive, scoped, capability-limited, and time-limited; it cannot
  expand the delegator's authority.
- Organization or tenant Policy is the deny-wins ceiling. Repository, Play, and Gate policy may only
  tighten it. Missing, stale, unsupported, or conflicting Policy denies strict consumption.
- Review, schema validation, Approval, Gate evaluation, Evidence, Verification, and lifecycle
  transition remain separate immutable records.
- Gate Contracts declare required Evidence types, assurance, thresholds, comparison rules,
  Decision owners, expiry, dependencies, and failure behavior.
- Assurance is fixed to `unavailable`, `observed`, `replayable`, and `verified`. Independent
  registered verification or deterministic replay is required for `verified`.
- Approval consumption and the authorized Decision settle atomically. Concurrent consumers receive
  stable `already-consumed` behavior.
- `validAt` and `recordedAt` are distinct, time is injected, and expiry is evaluated using a
  half-open interval under a recorded clock source and skew policy.
- Staleness and invalidation append new receipts and propagate through explicit dependencies; they
  never rewrite a historical pass or Decision.
- Strict queries bind exact scope, source checkpoint, projection version, limits, sort, depth, and
  cursor expiry. Degraded reads are explicit and cannot satisfy a strict Gate.
- An Eval is a versioned, model-independent assessment definition plus its recorded outcome. It
  supplies Evidence to a Gate; it is not an Approval and cannot widen execution authority.
  Deterministic replay is `replayable` until an independent verifier awards `verified`. The first
  suite is F058 (instruction-surface).

## Testing Decisions

- The highest seam is Action submission through Gate evaluation and Decision settlement.
- Tests assert public Decisions, Evidence receipts, Assurance, Gate outcomes, stable errors,
  Approval consumption, and authority changes rather than internal evaluator calls.
- Exact fixtures cover Decision and receipt contracts, time boundaries, errors, and Gate results.
- Semantic fixtures cover separation of duties, Policy precedence, self-approval denial, Assurance
  promotion, revocation, dependency staleness, and strict-query refusal.
- Integrity fixtures cover concurrent Approval consumption, changed Policy hashes, tampered
  receipts, clock skew, cursor invalidation, and projection checkpoint mismatch.
- Prior art is the session approval, completion Gate, MCP contract parity, Evidence Runner,
  confidence Gate, ledger, identity, and scoped-query test suites.

## Out of Scope

- Starting target commands, granting Runner capabilities, deployment, deletion, or external effects.
- Agent or service-account formal Approval, implicit weighted Gates, or model confidence as authority.
- Rewriting historical Decisions when identity, Policy, or Evidence later changes.

## Further Notes

F052, F054, and F058 consume these contracts. This Feature writes governance records only and grants
no target-write authority. F058 is the first Eval suite; it does not admit Canonical Eval Artifacts
on its own.
