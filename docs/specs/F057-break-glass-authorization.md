# F057: Break-glass Authorization

**Status:** Proposed  
**Depends on:** F053, F056  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#217](https://github.com/Bandersnatch0x/amber-protocol/issues/217)

## Problem Statement

Production incidents may require an operation faster than the ordinary release path, but a generic
force flag, reusable emergency token, or Agent-granted exception would permanently weaken Amber's
governance boundary. Emergency pressure must not erase identity, scope, capability, Evidence,
revocation, or post-incident accountability.

## Solution

Add break-glass as a distinct, one-use human authorization. A grant is limited by registered
capability, exact scope, environment, purpose, time, credential boundary, and incident reference.
It cannot be self-granted by an Agent or executor. Use is consumed atomically and produces the same
real execution and external-effect receipts as the underlying capability. Every grant ends through
use, revocation, or expiry and requires a post-review record.

## User Stories

1. As an incident commander, I want an emergency grant tied to one incident and purpose, so that urgency cannot create standing access.
2. As a security owner, I want only registered capabilities eligible, so that break-glass cannot become arbitrary shell or HTTP access.
3. As an approver, I want exact environment, repository, target, scope, and effect, so that the grant cannot widen itself.
4. As an approver, I want a short validity window and one use, so that replay is impossible.
5. As an incident commander, I want explicit human authorization, so that an Agent or executor cannot self-grant.
6. As an operator, I want the grant consumed atomically with execution admission, so that concurrent callers cannot use it twice.
7. As a security owner, I want revocation immediately block future use, so that compromise response is effective.
8. As an auditor, I want expiry and revocation preserve the original grant, so that emergency history is not rewritten.
9. As an auditor, I want the underlying Runner or Adapter receipt linked, so that break-glass never substitutes a claim for execution Evidence.
10. As a privacy owner, I want emergency credentials opaque, scoped, and short-lived, so that the audit trail contains no secret.
11. As an incident commander, I want failures and partial outcomes recorded, so that an emergency attempt cannot disappear.
12. As a governance owner, I want mandatory post-review with outcome, necessity, impact, and follow-up, so that emergency use improves future controls.
13. As a governance owner, I want an overdue post-review visible and blocking according to Policy, so that review cannot be silently skipped.
14. As an MCP consumer, I want break-glass returned as approval-required and never executed, so that MCP cannot wield emergency authority.
15. As a maintainer, I want no `--force` or `--yes` interpretation as break-glass, so that ordinary confirmation cannot bypass controls.

## Implementation Decisions

- Break-glass is a distinct Action and Decision family, not a flag on ordinary execution.
- A grant declares incident, purpose, registered capability, exact target and scope, environment,
  risk, approvers, credential class, `validFrom`, `validUntil`, one-use key, and post-review deadline.
- Agents, service identities, submitters, executors, and Evidence producers cannot satisfy the
  required human emergency authorization slots.
- Grant use and underlying prepared transaction consume the one-use authorization atomically. A
  failed admission does not consume it; a settled execution cannot be replayed after caller timeout.
- Underlying target-write or external-write behavior still uses the registered F052/F053/F056
  capability, scope, credentials, receipt, rollback, and stable errors. Break-glass does not grant a
  new generic executor.
- Revocation prevents future consumption immediately. Expiry uses the injected governance clock and
  half-open validity interval. Historical grant, use, revoke, and expiry records remain immutable.
- Every use records underlying outcome, rollback or compensation, grant settlement, and mandatory
  human post-review. Policy determines consequences for an overdue review.
- Break-glass cannot waive identity, target confinement, receipt, journal, redaction, or audit.
- MCP returns break-glass as approval-required and never starts the underlying capability.

## Testing Decisions

- The highest seam is grant → atomic use → registered Runner or Adapter fixture → revoke or expiry →
  post-review.
- Tests assert public grant state, Decision identities, target or external fixture state, underlying
  receipt, settlement, post-review, and stable errors.
- Exact fixtures cover grant, use, revoke, expiry, post-review, and error contracts.
- Semantic fixtures cover one-use, exact scope, capability and environment, human authorization,
  no self-grant, revocation, expiry boundary, failed admission, failed execution, and MCP refusal.
- Integrity fixtures cover concurrent use, clock skew, changed request hash, reused credentials,
  tampered receipt, missing post-review, and journal breakage.
- Prior art is single-use loop and transport approvals, phase rollback, identity gates, controlled
  Runner, external-effect settlement, injected-clock tests, and ledger integrity suites.

## Out of Scope

- Standing emergency credentials, reusable grants, arbitrary shell or HTTP, Agent self-grant, or silent post-review waiver.
- Treating `--yes`, `--force`, administrator role, or production access as implicit break-glass.
- Bypassing identity, receipt, target confinement, redaction, or audit requirements.

## Further Notes

Break-glass is the final dependent Feature and must not ship before both controlled release and
registered external-effect foundations are accepted and independently reviewed.
