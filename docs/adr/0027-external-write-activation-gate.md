# ADR-0027: External-Write Capability Activates Per Contract, Never By Surface

**Status:** Accepted (2026-08-29)
**Date:** 2026-08-29
**Builds on:** [ADR-0003](0003-governance-gated-execution.md) (governance-gated execution),
[ADR-0020](0020-governed-live-git-transport.md) (the narrow self-owned transport exception),
[ADR-0026](0026-deletion-execution-gate.md)

---

## Context

F056 (Registered External Side Effects) requires that "no external-write capability becomes live
until its own Adapter contract and accepted ADR exist," and that execution is performed only by
the registered Adapter "under a dedicated accepted ADR." The `amber external` surface now carries
`execute`, `settle`, `reconcile`, and `compensate` beyond registration/proposal/authorization, so
what that surface does — and does not — enable must be recorded explicitly.

## Decision

1. **What the surface enables.** `external execute` and `external settle` are governance
   settlement only: execute opens one execution record for one authorized, drift-checked request,
   and settle records the Adapter's declared result receipt, from which Amber derives the terminal
   outcome. Both write exclusively to the hash-chained ledgers under `.amber/external/`. Amber
   dispatches no Adapter, opens no network connection, runs no command, and holds no third-party
   credential — only the purpose/scope/expiry credential boundary is ever recorded.
2. **Activation is per capability, not per surface.** A concrete external-write capability (a real
   ticket comment, PR, notification, deployment) becomes live only when BOTH exist: its own
   registered Adapter contract (owner, system, operation, exact target/scope, declared input
   schema, idempotency, credentials class, expected receipt fields, compensation or
   irreversibility, bounded timeout) and its own dedicated accepted ADR naming that capability.
   This ADR activates none; it records the activation rule.
3. **The contract is the ceiling.** Caller input can never supply a command, executable, remote
   URL, or unregistered operation — registered names are slug-checked, the Adapter pin owns the
   endpoint, and effect/Adapter version drift between proposal, authorization, and execution
   refuses. An unknown external outcome never becomes committed without independent reconciliation
   Evidence, and compensation is a new governed effect with its own authorization and receipt.
4. **MCP never executes.** External-write Actions surface through MCP as approval-required
   contracts only; the adapter seam never spawns them (F018 seam, F056 story 12).
5. **ADR-0020 stays narrow.** The repository-origin sync transport remains a self-owned governance
   exception (local `git add`/`git commit`, never push) and does not authorize any third-party
   write under this Feature.

## Consequences

The full propose → authorize → execute → settle → compensate contract is exercisable end-to-end
against declared receipts (the F056 test seam's "local fake Adapter") while Amber acquires no live
external-write capability. Each real capability's activation is a reviewable event — one Adapter
contract plus one accepted ADR — instead of an ambient property of the CLI. The cost is that
operators carry receipts across the boundary manually until a capability's own ADR lands.

## Rejected alternatives

- A generic account-bearing CLI or arbitrary HTTP escape hatch would leak credentials and conflate
  target-write with external-write — exactly what F056 exists to prevent.
- Activating all registered effects wholesale once one ADR exists would make registration itself
  the live switch and erase the per-capability review the spec demands.
- Blocking the settlement ledgers until a live Adapter exists would leave the governance contract
  untestable and push early adopters back to ungoverned side channels.

## Related

- `docs/specs/F056-registered-external-side-effects.md` (Further Notes: per-capability ADR)
- [ADR-0024](0024-read-only-adapters-and-explicit-cutover.md) (read-only Adapters; cutover
  discipline)
