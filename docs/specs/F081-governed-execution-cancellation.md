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

`terminated` is therefore claimed only when BOTH hold: the signal was delivered and the pid
is observed gone. When the signal was not delivered and the pid is gone anyway, the process
exited on its own — that is `already-exited`, never a kill the seam did not perform. The
seam also verifies the pid is still OURS before signalling: the handle records the process
start time where the platform exposes one (Linux `/proc/<pid>/stat`), and a pid whose
identity no longer matches is never signalled (`already-exited`, `signalResult.reason:
"pid-reused"`). The residual, stated plainly: a platform that cannot name a process identity
cannot falsify ownership, so there the recorded pid is signalled as before — the handle's
fence and lease name the owner, but they are not a process identity.
5. writes one immutable cancellation record and one `execution.cancel.requested` +
   `execution.cancelled` event pair on the existing Harness ledger.

Cancellation **never** deletes the workspace (that stays `execution release`), **never**
rewrites the run's terminal result, and **never** claims a kill it did not observe.

### 4. Race-safe settlement

One cancellation per attempt, and the attempt's own terminal fact stays the natural one:

- the cancellation writes its own immutable record and the `execution.cancel*` pair; it never
  writes the run's terminal result and never appends a second terminal fact;
- a cancellation that arrives after the attempt settled refuses —
  `AMBER_E_HARNESS_EXEC_NO_HANDLE` when the handle is gone, or the conflict refusal when a
  record already exists — and that refusal names the **recorded outcome**: the outcome the
  settlement event cites on the chain, so an edited record is reported as unconfirmed
  instead of being read back as "the outcome";
- two racing cancellations settle once: the loser refuses, and a racing loser never removes
  the winner's record;
- the natural path records a signalled exit as a *cancelled* attempt: `execution.failed`
  carries `cancelled: true` together with the observed `signal` and the `execution-cancel*`
  pointer it was attributed from, so a cancelled attempt is never readable as an ordinary
  failure. Attribution is deterministic: it comes from the cancellation REQUEST, which is
  appended BEFORE the signal, not from the settlement record, which is only written after the
  process is observed dead — waiting for that record would make the marker depend on which
  of two racing writers finished first.

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

- Cancellation consumes its authorization BEFORE it signals, so a transient
  failure of the terminal append can leave a recorded request with no
  settlement. Re-running the same command with the SAME Decision finishes that
  settlement: it never re-consumes the authorization and never signals a second
  time, and a different Decision is refused while the request is unsettled. A
  consumed-but-unsettled request is a recoverable state, never an audit dead end.
- That recovery does NOT depend on the execution handle: the shared seam clears
  the handle from its own settlement `finally`, so recovery settles from the
  attempt's own immutable record, or (with no surviving evidence) records
  `unknown` — never a claimed termination. The record is written once, never
  deleted, so a racing loser reports `already-settled` and cannot remove the
  winner's evidence.
- A record is EVIDENCE, so it is verified before it is ever cited and again at
  the moment it becomes authoritative. Verification binds IDENTITY and INTERNAL
  CONSISTENCY: a closed field set; the required fields present with their types
  (Decision, handle snapshot hash, signalResult, observation and a real
  date-time); a recomputed Snapshot Hash; and binding to this run's recorded
  request, handle snapshot and Decision. A record failing any of those is refused
  (`AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT`) instead of being promoted to a settled
  outcome, and it is re-verified at the moment it becomes authoritative. The
  binding fields are REQUIRED and their checks are unconditional: a record that
  omits its Decision or its handle snapshot is refused, so an absent binding
  never reads as a matching one. A record that cannot pass verification is
  refused BEFORE it is written, so a bad record is never persisted.
- The residual, stated plainly: the Snapshot Hash is derived from the record
  body, so an actor who can WRITE the record file can also rewrite the observed
  outcome (`outcome`, `observation`) and recompute a consistent hash, and no
  self-describing record can distinguish that — verification is not
  authentication. Two properties bound the exposure: the record lives inside the
  target's own `.amber/` state, whose write access is the same grant that could
  already rewrite the ledger, and the settlement event cites
  `execution-cancel:<run>#<hash>`, so an edit AFTER settlement is detectable
  against the tamper-evident chain. A first-attempt record is therefore
  authoritative by construction; a resumed record is trusted as the only
  surviving observation of an attempt whose settlement had failed.

- A cancellation is **asynchronous** by necessity: the settling execution can run in the
  same process as the cancel caller, so a blocking wait would prevent the very continuation
  that clears the handle from running.
- The seam settles on the child's `exit`, with a short bounded stdio drain, rather than on
  `close`: a cancelled process tree can keep a stdio pipe open indefinitely, and settlement
  must not depend on a survivor releasing it.
- `shell: true` is preserved (the historical command semantics), so the recorded pid is the
  shell's and the whole tree is signalled. The outcome is decided by observed liveness
  TOGETHER WITH whether the signal was delivered (§3): a kill is claimed only when both hold,
  so a process that exited on its own is `already-exited`, not a kill.

## Out of Scope

- Workspace deletion on cancel (stays `execution release`).
- Retry/re-execution (retry remains a new run, ADR-0101).
- Cancelling executions that were never started through the governed seam.
- Distributed/multi-machine cancellation; process supervision across host restarts.
- README positioning (the F082 §55 gate).
