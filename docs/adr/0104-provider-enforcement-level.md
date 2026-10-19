# ADR-0104: Provider Enforcement Level Is a Tri-State on the Declared/Effective Boundary

**Status:** Proposed (2026-10-19)
**Date:** 2026-10-19
**Builds on:** [ADR-0100](0100-harness-contract.md) (HarnessContract is the immutable total
contract), [ADR-0101](0101-run-unit-of-auditable-execution.md) (the Run unit),
[ADR-0012](0012-protocol-and-schema-versioning.md) (schema growth), F068 (execution boundary),
`issues/0044` (trusted-control boundary map), `issues/0047` (runtime-interception boundary),
`issues/0059` (generic runtime adapter).

---

## Context

`scripts/lib/harness/execution-adapter.js` compares a run's declared, effective, and observed
execution boundaries (`EXECUTION_VERDICTS = ["ok", "violation", "unevaluated"]`). It can say
"the observed trail stayed inside the declared boundary" — but it cannot say **whether the
boundary is actually enforceable by the backing provider**. A local git worktree and a hardened
container both read as "declared", so a reader cannot distinguish "network denied" from
"network not enforced, merely unobserved". F068 already states that Amber does not own the
sandbox; `issues/0044` lists an Amber-built sandbox runtime as out of scope. The missing piece
is not a sandbox — it is an honest, recorded answer to "how strong is this boundary?".

**Naming hazard.** The repository already uses "capability" for two other things:
`execution-domain-adapter.js`'s `capabilities()` returns the F052 `EFFECT_KINDS`
(`read/write/network/process/external`) — action *effects*, not enforcement strength — and the
trusted-control `Capability` is Scope×Target×Effect×Constraint. This ADR therefore names the
new concept **enforcement level**, never "capability".

## Decision

1. **An enforcement level `unsupported | observed-only | enforced`** attaches to the execution
   section of the Harness Contract (declared) and to the effective boundary (runtime).
2. **There is no runtime provider probe, and none is created.** `prepareExecution` already
   selects the workspace from `contract.workspace.type` (`git-worktree` | `local`) and
   `effectiveBoundaryOf` derives the effective boundary purely from the contract. The declared
   enforcement level is therefore a **static function of the declared provider/workspace type**:
   `git-worktree` and `local` → `observed-only`. Building a provider self-report interface would
   contradict ADR-0022 and `issues/0044`; a future hardened provider enters only through the
   `execution-domain-adapter` seam (`issues/0059`).
3. **Declared enforcement level is frozen at admission** — it is part of the contract's snapshot
   hash (ADR-0100 decision 2). It is the operator's requirement.
4. **Effective enforcement level can only downgrade from declared**, exactly as the existing
   boundary discipline permits: `effectiveBoundaryOf` mirrors the declared shape with defaults so
   the two stay field-comparable, and effective ⊆ declared. With no probe today, effective equals
   declared for every admitted run; the downgrade rule bites only once a provider can report less
   than it was asked for.
5. **The comparison consumes the effective (weaker) value** as the ceiling on `ok`. A contract
   requiring `enforced` whose provider delivers `observed-only` is a mismatch: admission refuses
   it (`unsupported` for that requirement). An observation that exceeds an `observed-only`
   capability is `unevaluated`, never `ok`.

## Consequences

- A receipt can now distinguish "denied" from "not enforced, unobserved" — the boundary-side gap
  `issues/0047` ruling A left open on the PEP side.
- Adding a field to the execution section is a schema change; ADR-0012 versioning applies.
- The comparison fold gains one more input (the effective enforcement level), so every existing
  declared/effective/observed test fixture must state a level or inherit the `observed-only`
  default.
- No new provider interface is introduced; the value is derived, keeping the Core free of any
  sandbox ownership.

## Rejected alternatives

- **Calling it "capability".** Collides with `execution-domain-adapter.js`'s `capabilities()`
  (EFFECT_KINDS) and the trusted-control `Capability`; same word, three meanings.
- **A runtime provider probe.** No such interface exists, and building one would make Amber own
  the sandbox — the boundary ADR-0022 and `issues/0044` hold.
- **Enforcement level only on the contract.** A runtime downgrade would be invisible.
- **Enforcement level only on the effective boundary.** No admission-time requirement, so nothing
  expresses "this run must be `enforced` or it cannot start".
- **A boolean `sandboxed`.** Loses the `observed-only` middle state, which is precisely the state
  every non-hardened provider is actually in.
- **Treating a local worktree as `enforced`.** The whole point is that a worktree is not a
  sandbox; claiming otherwise is the failure mode `issues/0044` warns against.
