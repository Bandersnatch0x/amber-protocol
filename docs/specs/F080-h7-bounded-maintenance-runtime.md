# F080: H7 Bounded Maintenance Runtime

**spec_id:** F080
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** ADR-0103/F079 accepted authority; Harness v2 §27/§36 (first H7 candidate: read-only maintenance proposal generation), §47–§49 (events, budgets, no-progress), §51; ADR-0028 ledger-family; F050 human Decision primitives; F072 no-progress precedent; user sequence 2026-09-24 (Charter → H7 → live-cancel → positioning evidence)
**Feature:** F080

## Problem Statement

F079 authorizes one narrow runtime, but no runtime contract, schedule registry, wake
loop, lease, daemon, proposal job, or audit trail exists. Existing Loop Contracts must
remain unscheduled, and reusing `loop run --execute` would cross the exact boundary
F079 created. H7 must prove that time can trigger **internal deterministic maintenance
proposal generation** without becoming target-command or agent execution.

## Solution

Deliver a repository-local H7 runtime under `amber harness runtime`:

### 1. Closed Maintenance Job registry

The code registry initially contains exactly one job:

- **`draft-spec-review`** — recursively reads `docs/specs/**/*.md`, finds documents
  whose canonical status header is `draft`, and emits one deterministic review
  proposal listing sorted repository-relative paths. It never edits a document. No
  caller path, command, module, script, model, or callback is accepted.

Every job declares the immutable authority tuple:

```json
{
  "executesAnything": false,
  "schedulesJobs": true,
  "dispatchesAgents": false,
  "writesExternalSystems": false
}
```

### 2. Human-approved Schedule records

`amber harness runtime schedule admit --file <schedule.json>` admits one immutable
schedule under `.amber/harness/runtime/schedules/<id>.json`. Closed contract:

- `apiVersion: amber.dev/v1`
- `kind: HarnessMaintenanceSchedule`
- `metadata.id`, `metadata.version`
- `job` — closed registry name
- `cadence.everyMs` — bounded interval
- half-open `validAt` / `validUntil` (maximum 30 days)
- `budget.maxRuns` and `budget.maxProposals`
- `decision: {identity, revision}` — one committed human acceptance/approval Decision

Admission composes canonical Decision resolution. One Decision may register only one
schedule. The record carries a canonical Snapshot Hash; the `runtime.schedule.registered`
event freezes that hash. Reads re-hash the file and reconcile it to the verified event
trail; edits fail closed.

`runtime schedule revoke --schedule <id> --decision <identity>@<revision> --reason`
requires a fresh human Decision and emits one terminal revocation event. Records remain
listable forever.

### 3. One Harness event ledger

Extend the existing Harness ledger and event schema (no second hash chain) with closed
non-run-scoped kinds:

- `runtime.schedule.registered|revoked`
- `runtime.daemon.started|stopped|recovered`
- `runtime.wake.started|skipped`
- `runtime.job.completed|failed`
- `runtime.budget.stopped`
- `runtime.no-progress.stopped`

Events use existing `inputHash`, `outputHash`, `reason`, and `pointers`. Schedule/job
state is derived from the verified chain plus immutable schedule/proposal records.

### 4. Deterministic tick

`amber harness runtime tick [--schedule <id>] [--now <iso>]`:

1. verifies schedule records against the event chain;
2. derives active/revoked/expired/budget/no-progress state;
3. selects due schedules in id order;
4. emits wake start;
5. invokes the registered internal function directly;
6. writes an immutable content-addressed proposal under
   `.amber/harness/runtime/proposals/<proposalId>.json` only when findings exist;
7. emits completion/failure with hashes and pointers.

No findings is a successful observation with no proposal. Repeating the same output on
two consecutive due runs triggers one terminal `runtime.no-progress.stopped` event;
`maxRuns` or `maxProposals` triggers one terminal `runtime.budget.stopped` event.
Neither stop widens or retries the schedule.

### 5. Repository-local daemon with lease/fence

`runtime daemon start --poll-ms <n>` launches `scripts/amber-runtime.js` as a detached
local Node process. It invokes only `runtime tick`; it accepts no command/job code.

- Exclusive start lock prevents races.
- `.amber/harness/runtime/daemon.json` records PID, random lease id, monotonic fence,
  target, poll interval, and start time.
- Before every tick the worker re-reads the state and exits if PID/lease/fence no
  longer match.
- Start detects a stale PID as crash recovery, emits `runtime.daemon.recovered`, bumps
  the fence, and starts a new owner.
- `daemon stop` sends a signal only to this recorded internal daemon after ownership
  checks; it never signals a governed target execution. It records stop request and
  removes operational state after exit.
- `daemon status` is read-only and distinguishes running/stale/stopped.

### 6. Authority ceiling

No H7 path may call child-process execution except daemon self-spawn/stop. A seam test
statically rejects imports/calls to governed runner, execution adapter, runner
execution, eval/model, MCP writes, external effects, Route execution, Loop execution,
or arbitrary command APIs from the runtime job/core modules.

H7 writes only schedule/proposal/daemon operational records below
`.amber/harness/runtime/` and typed events through the existing Harness ledger.

## CLI

- `harness runtime jobs`
- `harness runtime schedule admit|list|show|revoke`
- `harness runtime tick [--schedule] [--now]`
- `harness runtime daemon start|stop|status [--poll-ms]`

Expert-tier, untyped; default seven verbs unchanged.

## User Stories

1. As a maintainer, I want an approved schedule to produce draft-spec review proposals
   without editing specs or running a command.
2. As a reviewer, I want every wake/skip/result/stop/crash-recovery fact on the Harness
   ledger.
3. As a safety owner, I want the daemon unable to dispatch agents, commands, workflows,
   or external effects.
4. As an operator, I want one fenced local owner and explicit start/stop/status.
5. As a governance owner, I want budgets, expiry, revocation, and no-progress to stop
   schedules deterministically.

## Testing Decisions

- Real human Decision fixture admits a schedule; unresolved/service/non-human/reused
  decisions refuse.
- Tampered schedule or proposal fails closed against Snapshot Hash/event pointer.
- Manual ticks cover due/not-due, half-open time boundaries, sorted ordering,
  revocation, expiry, maxRuns/maxProposals, identical-output no-progress, zero-findings,
  job failure, and idempotent content-addressed proposals.
- A real daemon process starts, executes one due schedule, produces a proposal/event,
  reports running, stops, and leaves no child; stale PID recovery bumps fence.
- Whole target tree proof: only declared runtime paths and Harness event ledger change;
  docs/specs bytes remain identical.
- Static seam guard proves no target/agent/workflow/external execution imports.
- Existing workflow-pack all-false census remains green.

## Out of Scope

Target/governed command scheduling; agents/models/subagents; Dynamic Workflows;
external writes; arbitrary/caller job code; document edits; multi-machine scheduler;
real live cancellation (F081); README positioning (F082 gate).

## Further Notes

HITL gate `issues/0132` closed 2026-09-24: user selected 「全部按推荐」 for all
six record/CLI/job/daemon choices.
