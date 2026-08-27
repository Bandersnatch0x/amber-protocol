# F052: Controlled Runner & Environment Boundaries

**Status:** Proposed  
**Depends on:** F050  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#212](https://github.com/Bandersnatch0x/amber-protocol/issues/212)

## Problem Statement

Amber has narrow governed command and Evidence Runner precedents, but no closed contract for adding
target-write capabilities without becoming an arbitrary shell or Agent Runtime. A valid receipt or
sandbox claim can be mistaken for execution authority, and Development, Staging, and Production
boundaries are not yet enforced through one capability model.

## Solution

Introduce a registered controlled Runner and explicit environment profiles. Every operation is a
closed capability with policy-derived risk, exact scope, human authorization, isolation, bounded
credentials, timeout, real result receipt, and recovery. Sandbox assurance is evaluated separately
from receipt integrity. Production permits only preparation, diagnosis, and separately approved
runbook capabilities.

## User Stories

1. As a Runner owner, I want each executable operation registered, so that callers cannot supply arbitrary shell text.
2. As a security owner, I want Runner identity, version, integrity, and supported capabilities verified, so that an unknown executor fails closed.
3. As an operator, I want exact target and path scope, so that an approved operation cannot widen its blast radius.
4. As an operator, I want policy-derived risk, so that a caller cannot classify its own operation as low risk.
5. As an approver, I want one authorization bound to one request hash and environment, so that approval cannot be replayed elsewhere.
6. As a security owner, I want short-lived scoped credentials delivered only at execution, so that Amber stores no standing production secret.
7. As an auditor, I want sandbox assurance distinct from receipt integrity, so that one proof cannot imply the other.
8. As an auditor, I want denied, attempted, timed-out, failed, committed, and rolled-back outcomes recorded, so that no attempt disappears.
9. As a developer, I want Development execution isolated and policy-gated, so that experiments do not mutate the main working state unexpectedly.
10. As a staging owner, I want only allowlisted deploy and rollback capabilities, so that Staging remains controlled.
11. As a release manager, I want Production limited to preparation, diagnosis, and pre-approved runbooks, so that arbitrary commands cannot run there.
12. As an MCP consumer, I want target-write Actions returned as approval-required and never spawned, so that MCP does not become a Runner.
13. As a recovery operator, I want non-zero, timeout, signal, and partial results fail explicitly, so that execution never reports fake success.
14. As a maintainer, I want capability and environment policy versioned, so that changed authority makes stale approvals unusable.

## Implementation Decisions

- The Runner registry contains closed operation capabilities rather than arbitrary commands or Agent
  prompts. Registration itself is a human-approved governance mutation.
- Every request declares capability, exact target, repository identity, scope, environment, input
  hashes, timeout, expected effects, credential requirement, rollback or compensation, and receipt.
- Capability facts and versioned Policy derive risk and required approval. Callers cannot lower risk
  or add an unregistered effect.
- Development uses isolated target scope. Staging uses allowlisted operations, named approval,
  short-lived credentials, and rollback rehearsal. Production grants no generic target-write.
- Credentials are opaque, purpose-bound, scoped, expiring, and unavailable outside the authorized
  execution. Receipts contain protected digests or Handles, never secret values.
- Runner sandbox assurance, credential assurance, and result integrity are separate fields and
  separate Gate inputs.
- Execution uses durable prepared/committed/aborted settlement and append-only receipts. Non-zero,
  timeout, signal, missing receipt, and scope mismatch abort.
- Existing governed Runner and Git transport exceptions remain unchanged until a dedicated ADR
  explicitly adopts a new capability.
- MCP only validates and returns approval-required mutation submissions. It never starts a Runner.

## Testing Decisions

- The highest seam is public Action request → authorization → registered Runner fixture → receipt
  and settlement.
- Tests assert public request, authorization, target fixture state, receipt, journal, stable error,
  and rollback rather than process-spawn internals.
- Exact fixtures cover registry and request contracts, environment profiles, receipts, and errors.
- Semantic fixtures cover capability allowlisting, risk derivation, scope, credential boundary,
  sandbox independence, environment restrictions, separation of duties, and MCP non-execution.
- Integrity fixtures cover request hash changes, reused Approval, concurrent execution, Runner
  version drift, tampered receipt, timeout, partial result, and journal breakage.
- Prior art is the governed Runner, Evidence Runner, deployment profile, loop and route execution,
  sync transport, MCP action runtime, and ledger suites.

## Out of Scope

- Arbitrary shell, live Agent dispatch, unattended scheduling, daemon operation, or generic remote execution.
- Production deployment itself; F053 defines release and rollback behavior.
- External systems, deletion, notifications, and break-glass.

## Further Notes

Enabling any new target-write capability requires a dedicated accepted ADR. This Spec defines the
contract and environment boundary; it does not silently grant authority.
