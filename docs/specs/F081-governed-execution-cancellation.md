# F081: Owned Governed-Execution Handles and Truthful Cancellation

**spec_id:** F081
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** ADR-0103 §2 (cancellation authority over an already-approved live execution: owned persisted handle, separate cancellation approval, race-safe settlement, restart reconciliation, terminal Evidence); F078 (the explicit refusal this replaces — it named exactly these prerequisites); ADR-0003 (the four gates: policy, approval, isolation, ledger — all unchanged and still preceding any effect); F070 H2b (the prepared-execution consumer); F080 (the lease/fence pattern this reuses); user decision 2026-09-24 (scope B: unify the shared execution seam)
**Feature:** F081

## Problem Statement

Every governed execution consumer — `loop run --execute`, route `command` stage execution,
`harness execution run`, and `evidence-runner` — reaches one shared seam
(`governed-runner.executeInWorktree` → `execution-domain-adapter.executeInPreparedWorkspace`)
that runs the command with `spawnSync`. The CLI process therefore blocks for the whole
command, no process identity is persisted, and no other process can observe or affect the
running execution. F078 correctly refused `harness execution terminate` because truthful
cancellation is impossible in that model: there is nothing to own and nothing to observe.

## Solution

### 1. One asynchronous execution seam, all consumers

`executeInPreparedWorkspace` spawns asynchronously (`spawn`, detached into its own process
group) and returns the same result envelope as before; `executeInWorktree` and
`runGovernedCommand` become `async`, and the four consumers `await` them. The four gates,
the ledger records, the output digests, and the returned shapes stay byte-identical — this
slice is a process-model change with **behavior parity**, proved by the untouched consumer
suites passing unmodified.

### 2. Owned execution handle

While a governed command runs, the seam persists exactly one handle at
`.amber/harness/executions/<runId>.handle.json`:

- `runId`, `attemptId`, `label`, `commandId` (named-command consumers), `workspace`
- `pid`, `leaseId`, `fence` (the F080 ownership pattern), `startedAt`
- `deadlineAt` (the declared budget deadline)
- `target` (absolute) and a canonical Snapshot Hash over the handle body

The handle is written immediately after `spawn` returns a pid (before awaiting the exit),
and removed on settlement. A missing handle is never interpreted as "not running": it
means *no handle*, which cancellation reports as such.

### 3. `harness execution cancel`

`amber harness execution cancel --run <id> --decision <identity>@<revision> --reason <text>`:

1. reads the handle; a missing handle is an explicit refusal
   (`AMBER_E_HARNESS_EXEC_NO_HANDLE`) that names the recorded execution state;
2. verifies the target of the handle matches the requested target;
3. consumes a **separate** single-use human acceptance/approval Decision (the in-lock
   `runtime-decision:`-style spend guard on the Harness ledger) — a cancellation
   authorization is never the execution's own approval and can never be reused;
4. observes the pid **before** signalling and classifies the outcome honestly:
   - `already-exited` — the pid was already gone (restart reconciliation: a dead handle
     never reports a kill);
   - `terminated` — the pid was alive, the signal was delivered, and the pid exited within
     the bound;
   - `unknown` — the pid was alive, the signal was delivered, and it did not exit within
     the bound (never reported as success);
5. writes one immutable cancellation record and one `execution.cancel.requested` +
   `execution.cancelled` event pair on the existing Harness ledger.

Cancellation **never** deletes the workspace (that stays `execution release`), **never**
rewrites the run's terminal result, and **never** claims a kill it did not observe.

### 4. Race-safe settlement

Cancellation and natural settlement both target one terminal fact:

- whichever appends the terminal settlement first wins;
- the loser observes the settled state and reports `already-settled` with the recorded
  outcome instead of writing a second terminal fact;
- the natural path records a signalled exit as a *cancelled* attempt
  (`execution.failed` with a `cancelled: true` marker and the observed signal), so a
  cancelled attempt is never readable as an ordinary failure.

### 5. Restart reconciliation

A stale handle whose pid is gone is reconciled on read: `execution handles` lists live and
stale handles with the observed liveness, and `cancel` on a stale handle records
`already-exited`. Reconciliation never fabricates a termination receipt.

### 6. Authority ceiling

- Cancellation grants **zero launch authority**: it cannot create, widen, retry, or
  re-execute anything.
- The four gates (policy, approval, isolation, ledger) are untouched and still run before
  any effect.
- `harness execution terminate` (F078) becomes an explicit *pointer* refusal: the message
  now names `execution cancel` as the authorized surface, and still refuses the ambiguous
  cancel+release composition.
- No new ledger family, no second hash chain, no new event namespace beyond the two closed
  `execution.cancel*` kinds; existing `runtime.*` and execution event kinds are unchanged.

## CLI

- `harness execution cancel --run <id> --decision <identity>@<revision> --reason <text>`
- `harness execution handles [--run <id>]` — read-only live/stale handle view
- `harness execution terminate` — explicit refusal, now pointing at `cancel`

## User Stories

1. As an operator, I want to stop a governed command that is still running, without
   pretending the workspace was deleted or the boundary violation resolved.
2. As a governance owner, I want cancellation to require its own human Decision, so the
   execution's own approval can never authorize its termination.
3. As an auditor, I want an observed outcome (`terminated` / `already-exited` / `unknown`)
   rather than a claim, and one terminal settlement per attempt.
4. As a maintainer, I want one execution model across loop, route, harness, and evidence
   consumers.

## Testing Decisions

- Parity: the consumer suites (`governed-runner`, `session-stage-runner`, run-contract,
  route, loop, evidence-runner, glx-cli) keep every assertion **unchanged**. Their diff is
  mechanically verified to be `await`/`async` only (the same line count added and removed,
  and every added line equals its removed counterpart once `await `/`async ` is stripped) —
  the process model moved, the expectations did not.
- A real long-running governed command (a Node child that sleeps) is started against a
  prepared workspace, its handle is observed, and `cancel` is issued from the same test
  process: the receipt reports `terminated`, the observed pid is gone, and the prepared
  workspace still exists.
- A handle whose pid is already dead reports `already-exited`; a missing handle refuses with
  `AMBER_E_HARNESS_EXEC_NO_HANDLE` and writes nothing.
- Cancellation without a Decision, with a non-human/review Decision, or a reused Decision
  refuses; the refusals leave the handle live and consume nothing.
- Race: an attempt that settled naturally has no handle, so a late cancellation refuses and
  appends no second terminal fact.
- Raw CLI smoke for `--run`/`--decision`/`--reason`, the `handles` view, and truncated flags.

## Known behaviors worth stating plainly

- A cancellation is **asynchronous** by necessity: the settling execution can run in the
  same process as the cancel caller, so a blocking wait would prevent the very continuation
  that clears the handle from running.
- The seam settles on the child's `exit`, with a short bounded stdio drain, rather than on
  `close`: a cancelled process tree can keep a stdio pipe open indefinitely, and settlement
  must not depend on a survivor releasing it.
- `shell: true` is preserved (the historical command semantics), so the recorded pid is the
  shell's; the whole tree is signalled, and the outcome is still decided by observed
  liveness, never by the signal's return.

## Out of Scope

- Workspace deletion on cancel (stays `execution release`).
- Retry/re-execution (retry remains a new run, ADR-0101).
- Cancelling executions that were never started through the governed seam.
- Distributed/multi-machine cancellation; process supervision across host restarts.
- README positioning (the F082 §55 gate).
