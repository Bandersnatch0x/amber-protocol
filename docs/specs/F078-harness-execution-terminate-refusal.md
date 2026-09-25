# F078: Harness Execution Terminate — Explicit Refusal, Not a Fake Kill

**spec_id:** F078
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** Harness v2 proposal §20 names `harness execution terminate`; F070 settles the execution boundary's BLOCK posture (a violation emits `execution.failed`, running → blocked, pre-start → cancelled; recovery is human-reviewed or a contract revision, never widening); F074 explicitly deferred `terminate` because it crosses that posture and needs its own spec decision; ADR-0101 supplies the Run lifecycle and already permits explicit Run → cancelled transitions; F052 runner execution already owns `abort` for a prepared request that will never produce a receipt; F070 already owns `execution release` for deleting a prepared workspace as a recorded step; repository execution is synchronous and stores no cancellable live-process handle; wayfinder map `issues/0066` close-out (last named remaining follow-up); user decision 2026-09-24 (`显式拒绝面`).
**Feature:** F078

## Problem Statement

The proposal names `amber harness execution terminate --run <id>`, but Amber has no
semantic object that command could truthfully terminate:

- a **Run** is a durable lifecycle record and already has the explicit
  `harness advance --run <id> --to cancelled --reason <text>` transition;
- a **runner request** that will never produce a receipt already has
  `amber runner execution abort --request-hash <hash> --reason <text>` — an
  append-only bookkeeping settlement, never process control;
- a **prepared workspace** already has `harness execution release --run <id>` — a
  recorded deletion step;
- the governed command path executes synchronously and persists no process handle,
  PID ownership proof, cancellation token, or termination receipt.

Implementing `terminate` as `cancel + release` would therefore be false: it could mark
the Run cancelled and delete its workspace while a child process still runs. It would
also collapse three independently auditable facts (lifecycle, request settlement,
workspace lifetime) into one ambiguous mutation and weaken F070's BLOCK posture by
making an operator-looking kill appear to resolve a boundary violation.

## Solution

Deliver an **explicit refusal surface**:

`amber harness execution terminate [--run <id>] --target <repo>` is recognized by the
nested execution dispatcher and always returns `AMBER_E_INVALID_ARG` with a stable,
actionable explanation:

1. Amber has no cancellable live-execution handle, so this command cannot truthfully
   terminate a process.
2. To cancel the Run record, use `amber harness advance --run <id> --to cancelled
   --reason <text>` (only where ADR-0101 permits that transition).
3. To settle a prepared runner request that will never produce a receipt, use
   `amber runner execution abort --request-hash <hash> --reason <text>`.
4. To remove a prepared workspace, use `amber harness execution release --run <id>`.
5. A blocked run remains BLOCKED until its existing human-review recovery / terminal
   lifecycle transition; `terminate` never bypasses or widens that posture.

The refusal reads no run/execution record and writes nothing. `--run` is optional on
the refusal because no target-specific operation occurs; both with and without the
flag return the same semantic refusal (the provided id may be named only in examples,
never used to infer authority).

## User Stories

1. As an operator, I want a named `terminate` invocation to explain why Amber cannot
   kill a process and point me to the exact lifecycle/request/workspace commands, so
   that I do not mistake an unknown-action error for missing documentation.
2. As a governance owner, I want cancellation, request abort, and workspace release
   to remain separate auditable facts, so that one convenience verb cannot erase the
   distinction between them.
3. As a safety reviewer, I want `terminate` to be structurally unable to delete a
   workspace or rewrite a blocked run, so that F070's BLOCK posture remains intact.

## Implementation Decisions

- **Refusal lives in the existing `execution` nested dispatcher**: one explicit
  `sub === "terminate"` branch in `scripts/lib/harness/harness-commands.js`, before
  the generic unknown-subcommand response. No core function exists because there is
  no domain mutation to own.
- **Stable existing code**: use `AMBER_E_INVALID_ARG`; no new error code, event kind,
  schema, artifact, ledger event, or state transition.
- **No composed mutation**: the branch must not call `transitionRun`,
  `abortRunnerExecution`, `releaseExecution`, or any process API. It must not read a
  Run first — a missing run and an existing run refuse identically because the
  command's capability is absent, not target-dependent.
- **Help is honest**: command help and usage list `terminate` as an explicit refusal
  and name the three alternatives. It is not advertised as successful execution
  control.
- **F070 unchanged**: BLOCK remains violation → `execution.failed` + blocked/cancelled
  posture; existing recovery and terminal transitions remain the only lifecycle
  routes.

## Testing Decisions

- Through the real dispatcher, `execution terminate --run <existing>` and
  `--run <missing>` both return `AMBER_E_INVALID_ARG` and the alternative commands.
- Byte-pin the entire target directory (files plus empty directories) before/after
  refusal against a real prepared run: no run record, execution record, event ledger,
  workspace, runner ledger, or directory changes.
- Raw CLI smoke through `scripts/amber.js` proves `terminate` reaches the explicit
  branch rather than the generic unknown-action path; invocation without `--run`
  returns the same refusal.
- Existing execution/run tests remain unchanged and pass; full gates + stage-7
  dual-axis review.

## Out of Scope

- Live process cancellation. That requires a new protocol: a persisted, ownership-
bound cancellable handle; cross-process coordination; signal/timeout semantics;
termination Evidence/receipt; race handling against settlement; and recovery after the
controller dies. It is not hidden inside this refusal.
- Changing Run transitions, runner abort semantics, release behavior, BLOCK recovery,
or synchronous governed execution.
- Adding a convenience command that performs cancel + abort + release.

## Further Notes

- HITL decision: `issues/0128` — user selected **显式拒绝面** on 2026-09-24.
- This closes the last named `issues/0066` follow-up without pretending Amber owns a
  capability it does not have.
