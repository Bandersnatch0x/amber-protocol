# F072: Harness H4 — Runtime Lifecycle (Attempts, Checkpoints, the Unified Mapping)

**spec_id:** F072
**Status:** accepted
**Updated:** 2026-09-23
**Provenance:** Harness v2 proposal §4.4 (L — Lifecycle), §6 (Run Model), §14 (Lifecycle Specification: runtime may emit/request/pause/fail/complete, never self-approve or widen), §33 (H4 Specification + acceptance), §42 (Phase H4 gate: route/session/loop/execution all map to the unified lifecycle), §49 (No-Progress Detection as the deterministic attempt consumer); F065 H0 (nine-state machine, ADR-0101), F068/F070 (execution boundary + wiring, per-attempt observation), F066 (loop↔run adapter, ADR-0101 decision 4); the session checkpoint seam (`scripts/lib/checkpoint-manager.js`); wayfinder map `issues/0066`; user direction 2026-09-23 (「继续推进v2.2」)
**Feature:** F072

## Problem Statement

The Run spine exists — a closed nine-state machine with pause/resume, failure/block
distinction, immutable run identity, and fail-closed terminal records — but the §33
deliverables above it are missing. An **Attempt** is only a string (`att-…`) minted inside
`runPreparedExecution` and scattered across governed-ledger records and observed entries;
there is no run-scoped attempt record, so "how many attempts, which failed, did the same
failure repeat" (the §49 no-progress question) is answerable only by walking ledgers by
hand. A **Checkpoint** has no run-scoped home at all — the only checkpoint implementation
is session-scoped (`checkpoint-manager.js`) — so "checkpoint supports recovery" (§33
acceptance) cannot be answered for a run. And the §42 gate asks for a unified view: route,
session, loop, and execution must all be *mappable* to the unified lifecycle, but nothing
renders that mapping; the run is the spine and the other surfaces are invisible from it.

The runtime-permission half of §14.2 is already enforced (F070: the four gates precede any
effect; BLOCK posture stops a violating run) and is not re-litigated here.

## Solution

Make attempts and checkpoints first-class, run-scoped records — composed from what already
exists, never a second trail — and add the one read-only view the gate needs:

- **Attempt records under the run** (`scripts/lib/harness/attempt-core.js`): every governed
  attempt (`runPreparedExecution`) and every lifecycle transition that names one appends a
  run-scoped attempt record under `.amber/harness/attempts/<runId>/<attemptId>.json` —
  `{attemptId, runId, state: running|completed|failed|refused, commandId, exitCode?,
   governedRef (ledger pointer), observedRef, startedAt, finishedAt?}`. The record is
  derived at write time from the attempt's real governed result and is never rewritten
  (a refused attempt and a failed command are both records; F070's distinction is kept:
  classify by `governed.executed`/`governed.ledgerRecord`). `listAttempts(runId)` folds the
  records deterministically; `no-progress` is derivable from them (same commandId + same
  failed exitCode repeated ≥ 2 consecutive attempts) and is *reported*, never enforced —
  no-progress *enforcement* stays §49's "future Loop/Runtime" concern.
- **Event emissions become attempt-scoped and truthful**: `runPreparedExecution` currently
  emits no `execution.*` events of its own (only the violation BLOCK path emits
  `execution.failed`). Each governed attempt now appends `execution.started` at launch and
  `execution.completed` / `execution.failed` at outcome (exitCode 0 vs non-zero; a gate
  refusal emits `execution.failed` with the refusal reason and records state `refused`).
  The three kinds are already in the closed event enum and run-scoped — additive wiring,
  zero enum growth. Existing H0–H3b behavior is unchanged where no attempt runs.
- **Run-scoped checkpoints** (`checkpointRecord` in `run-core.js` or a sibling module):
  `checkpoint` records a run-scoped snapshot under `.amber/harness/checkpoints/<runId>/` —
  `{checkpointId, runId, at, state (the run state at capture), reason?, refs: {run file
  digest, execution record digest, attempt count}}` — a JSON record, not a ledger event
  (checkpoints are snapshots, not facts; the event ledger stays the one trail). Recovery
  is the standalone `checkpoint verify` command: it reads the checkpoint (latest, or a
  named one) and verifies the run is still in the captured state — run-record digest,
  execution-record digest, and attempt count all re-derived and compared — before the
  captured facts are re-cited; a drifted run refuses recovery (fail closed). It never
  rewrites run state and is not wired into the advance path: `harness advance` stays the
  state machine's own surface. Capture is available in any non-final state; recovery is a
  read + verify, never a state rewrite.
- **The unified lifecycle view** (`amber harness lifecycle [--run <id>]`): one read-only
  report answering §42 — for a run (or the whole registry with no `--run`), it maps the
  four existing surfaces onto the unified spine: the run's own nine-state state + history,
  its loop provenance (`--from-loop` binding from F066, read from the run's admission
  pointers), its session/task subject refs, its execution record (declared/effective
  verdict), its attempts (count + states), and its checkpoints. Every field is read from
  existing records; the view writes nothing and re-derives nothing it cannot cite.
- **Additive everything (ADR-0012)**: run record grows an optional `attempts` summary
  section (`{count, lastAttemptId, lastAttemptState}`) and an optional `checkpoints`
  summary (`{count, lastCheckpointId, lastCheckpointAt}`) — absent on pre-H4 records, which
  stay schema-valid; no new schema file (schema-count pin unchanged at 28); the attempt and
  checkpoint record shapes are closed inline shape checks (the H2a ExecutionRecord
  precedent), not schema files.
- **New error codes register in the catalog** (`AMBER_E_HARNESS_ATTEMPT_*`,
  `AMBER_E_HARNESS_CHECKPOINT_*`) — the error-catalog test refuses unregistered literals.

## User Stories

1. As a reviewer, I want every governed attempt recorded as a run-scoped attempt record
   with its outcome, so that attempt history is readable without walking governed ledgers.
2. As a maintainer, I want `execution.started`/`execution.completed`/`execution.failed`
   emitted per governed attempt, so that the event trail tells the execution story by
   itself.
3. As a maintainer, I want `amber harness checkpoint --run <id>` to capture a run-scoped
   checkpoint, so that recovery has a named, verifiable rest point (§33).
4. As a reviewer, I want recovery to verify the run still stands where the checkpoint
   captured it, so that a drifted run never resumes on stale citations.
5. As an operator, I want `amber harness lifecycle --run <id>` to show state, history,
   loop/session/task mapping, execution verdict, attempts, and checkpoints in one view, so
   that the §42 gate question ("do route/session/loop/execution map to the unified
   lifecycle?") is answered by reading, not reassembling.
6. As a maintainer, I want repeated identical failures derivable from attempt records, so
   that the §49 no-progress signal has a deterministic foundation (reported, not enforced).

## Implementation Decisions

- **Compose, never duplicate**: attempt records cite the governed ledger pointer and the
  observed-entry source the F070 wiring already produced; the checkpoint cites file digests
  of the run and execution records. No second hash chain, no second trail, no new event
  types.
- **A refusal is an attempt**: the F070 distinction (gate refusal = never executed; failed
  command = executed with non-zero exit) is carried into the attempt record verbatim —
  state `refused` vs `failed`, both terminal, both recorded. Mutations of an executed-but-
  failed attempt are still observed (F070 behavior unchanged).
- **Checkpoints are snapshots, not events**: they live outside the event ledger (JSON
  records under the harness state area) precisely so the trail stays facts-only; the
  checkpoint's `refs` carry digests so a consumer can verify staleness without Amber
  re-deriving content.
- **The lifecycle view is read-only and cite-only**: it renders existing records and
  refuses (fail closed) on a corrupt one; it never writes, repairs, or infers a mapping it
  cannot cite. Loop provenance is read from the run's admission pointers (`approval:*`,
  `contract:*`), not re-walked from the loop ledger.
- **CLI stays untyped, expert tier**: `harness lifecycle`, `harness checkpoint`, and
  attempt listing join the existing `harness` surface; new flags (`--checkpoint` already
  exists in FLAG_SPECS for its prior owner — verify no collision; add `--attempt` only if
  needed) must be smoke-tested through the real CLI (the parseArgs whitelist silently
  turns unregistered flags into positionals).
- **Naming/seam/guard constraints identical to F065–F071**: the banned-string list the
  legacy-references test enforces; all paths
  through `statePath()`/`statePathForCreate()`; new files `git add`ed explicitly before the
  full suite (F063 N4).

## Testing Decisions

- Conformance at the real path: `runPreparedExecution` against a prepared workspace emits
  started + completed/failed; a gate refusal emits `execution.failed` + a `refused` attempt
  record; `listAttempts` folds records; the no-progress derivation fires on two consecutive
  identical failures and stays silent otherwise; checkpoint capture in a non-final state +
  recovery-verify on an unchanged run passes while a drifted (transitioned) run refuses;
  terminal-state capture refuses; the lifecycle view renders a run with loop provenance,
  execution verdict, attempts, and checkpoints, and fails closed on a corrupt record.
- CLI smoke: dispatch-level tests for every new subverb (checkpoint capture/list/verify,
  attempt list/inspect, lifecycle with and without `--run`), plus a raw-argv smoke against
  the real `scripts/amber.js` process for the `--attempt` flag mapping (the parseArgs
  whitelist silently turns unregistered flags into positionals — dispatch-level tests
  bypass argv parsing and hide that).
- Pre-H4 compatibility: a run record with no attempts/checkpoints sections stays
  schema-valid (schema `additionalProperties: false` rejects nothing new because nothing
  new is required), asserted at the schema contract; the sections are absent unless an
  attempt is recorded or a checkpoint captured (byte-compatibility by construction — no
  code path grows them otherwise).

## Out of Scope

- No-progress *enforcement* (auto-cancel/budget-stop — §49 names it a future Loop/Runtime
  concern); Checkpoint blob/file-tree snapshotting (Amber does not own the sandbox; the
  checkpoint cites digests, it does not copy workspaces); scheduler/daemon (H7 frozen);
  replay (H5 — its own fog); session-machine changes (ADR-0101 decision 2: untouched);
  MCP projection; homepage/charter change.

## Further Notes

- Design decisions above follow the standing user directive (map `issues/0066`: 执行带入;
  this session's「继续推进v2.2」continues it). The HITL gate for draft → accepted is
  `issues/0110`.
- The §42 gate demo (route/session/loop/execution → unified lifecycle) lands as an
  orchestration artifact under `.scratch/orchestration/f072-h4/` like the §40/§41 demos.
