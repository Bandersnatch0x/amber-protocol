# F056: Registered External Side Effects

**Status:** Proposed  
**Depends on:** F055  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#216](https://github.com/Bandersnatch0x/amber-protocol/issues/216)

## Problem Statement

Amber deliberately forbids third-party writes such as ticket, PR, notification, deployment, and
account-bearing CLI operations. Some governed workflows need bounded external effects, but a generic CLI
escape hatch would leak credentials, bypass ownership, conflate target-write with external-write,
and leave partial external state without evidence or compensation.

## Solution

Add a registered External Effect proposal, authorization, Adapter execution, settlement, and
compensation contract. Each effect names one external system, operation, target, scope, credential
boundary, approver, expected receipt, and rollback or compensation. Only a registered Adapter with
short-lived scoped credentials can execute it. Every denied, attempted, committed, failed, and
compensated outcome is journaled.

## User Stories

1. As an integration owner, I want each external system and operation registered, so that callers cannot invoke arbitrary account-bearing commands.
2. As an operator, I want an External Effect proposal before execution, so that exact target and consequences can be reviewed.
3. As an approver, I want system, effect, target, scope, payload hash, credentials class, and compensation bound to my Decision, so that authorization cannot drift.
4. As a security owner, I want short-lived purpose-bound credentials, so that Amber stores no standing third-party secret.
5. As an external owner, I want one registered Adapter to be the executor, so that ownership and API behavior are explicit.
6. As an auditor, I want a real external record ID, request digest, status, and response digest in the receipt, so that an effect is traceable.
7. As an operator, I want duplicate requests idempotent, so that retries do not create duplicate tickets, notifications, or records.
8. As an operator, I want partial and failed effects explicit, so that missing output never means success.
9. As a recovery operator, I want rollback or compensation declared before execution, so that recoverable effects have a governed path.
10. As a recovery operator, I want compensation produce its own receipt, so that external state history remains complete.
11. As a privacy owner, I want payloads and errors redacted, so that external diagnostics do not expose secrets or unauthorized data.
12. As an MCP consumer, I want external-write Actions returned as approval-required and never spawned, so that MCP cannot perform third-party writes.
13. As a repository owner, I want the existing self-owned Git transport exception kept separate, so that it does not authorize arbitrary external writes.
14. As a maintainer, I want Adapter and effect versions pinned, so that changed external semantics invalidate stale authorization.

## Implementation Decisions

- External effects are a separate boundary class from target-write and governance-write.
- Each registered effect contract declares external owner, system type, operation, exact target and
  scope, input schema, idempotency behavior, credentials class, the expected receipt fields (the
  response the external system must return), compensation or irreversibility, and a bounded
  timeout. Failures settle under the surface's fixed declared-status and outcome vocabulary with
  stable error codes; they are a surface contract, not a per-contract field (ADR-0027 §2 records
  the same list).
- Proposal is governance-write only. Authorization is a separate human Decision bound to canonical
  request hash, Adapter version, credentials class, and expiry.
- Execution is performed only by the registered Adapter under a dedicated accepted ADR. Caller
  input cannot supply a command, executable, remote URL, or unregistered operation.
- Credentials are opaque, short-lived, purpose-bound, scope-limited, and absent from receipts,
  logs, errors, and Canonical Artifacts.
- Settlement records denied, attempted, committed, failed, unknown, and compensated outcomes. An
  unknown external result never becomes committed without reconciliation Evidence.
- Idempotency binds external owner, effect, target, scope, and canonical payload hash.
- Compensation is a new governed external effect with its own authorization and receipt; it does
  not rewrite the original result.
- MCP never starts an External Adapter. It returns an approval-required command or proposal contract.
- ADR-0020's repository-origin transport remains a narrow self-owned governance exception and does
  not widen this Feature.

## Testing Decisions

- The highest seam is proposal → authorization → local fake Adapter → settlement or compensation.
- Tests assert proposal, Decision, fake external fixture state, receipts, stable errors, journal,
  redaction, and idempotency rather than HTTP-client internals.
- Exact fixtures cover effect registry, proposal, authorization, receipt, compensation, and errors.
- Semantic fixtures cover owner and scope, credentials boundary, separation of duties, unknown
  outcome, irreversible effects, compensation, MCP non-execution, and transport exception isolation.
- Integrity fixtures cover payload changes, duplicate requests, concurrent settlement, Adapter
  version drift, tampered response, credential leakage, and journal breakage.
- Prior art is sync transport, Adapter, MCP mutation refusal, memory opaque Handle, retention Holder,
  action contract parity, and ledger suites.

## Out of Scope

- A generic account-bearing CLI, arbitrary HTTP request, caller-supplied executable or remote URL.
- Autonomous PR, ticket, notification, deployment, or production mutation.
- Break-glass; F057 governs emergency external capability.

## Further Notes

No external-write capability becomes live until its own Adapter contract and accepted ADR exist.
