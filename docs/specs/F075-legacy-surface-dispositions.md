# F075: Harness §52 Migration — Legacy Surface Dispositions (task / result / profile inspect)

**spec_id:** F075
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** Harness v2 proposal §20 (旧命令作为 compatibility surface，逐步复用 Harness Core), §52 Rules 4–7 (declared, not improvised: Rule 4 adapters read old ledgers; Rule 6 session maps to Session; the mapping discipline of ADR-0101 decision 4), ADR-0101 decision 4 (each mapping lands as an adapter with a conformance test); wayfinder map `issues/0066` close-out (task/result/profile inspect kept as §52 migration targets — the last old-surface disposition); the legacy frozen writer (`scripts/lib/core/task-execution.js`: `persistExecutionArtifacts` writes `ledger.json`/`evidence.json`/`replay.md` under `.amber/executions/<taskId>/` plus `.amber/worktrees/<taskId>/`); user direction 2026-09-24 (「先做2,3,4」)
**Feature:** F075

## Problem Statement

The old surfaces `amber task prepare`, `amber result inspect`, and `amber profile
inspect` are deprecated but were deliberately KEPT (map 0066 constraint 4) until their
§52 migration exists. Today nothing declares how they map onto the harness spine: a
reviewer looking at a legacy task's artifacts under `.amber/executions/<taskId>/` has
no harness-side reading of what those artifacts correspond to (Task? Run? Evidence?
Receipt?), and the profile surface's disposition (no correspondence at all) is
undocumented. ADR-0101's discipline is "declared, not improvised" — the dispositions
must be declared and testable, not left as tribal knowledge.

## Solution

One read-only disposition view — `harness legacy` — that declares each old surface's
mapping onto the unified lifecycle, composed from the frozen on-disk legacy shape:

- **`harness legacy task --task <id>`**: reads the legacy execution artifacts
  (`.amber/executions/<taskId>/{ledger.json,evidence.json,replay.md}` + the
  `.amber/worktrees/<taskId>/` workspace pointer) and projects them into the §52
  vocabulary — Task (`subject.task` correspondence), Run (a *legacy* run projection:
  the old ledger's status mapped to the nine-state vocabulary's nearest neighbor with
  `legacy: true` disclosed — the old surface predates Runs, so this is a view over
  facts, never a Run record), Evidence (the old `evidence.json` cited as the evidence
  bundle), ExecutionContract+ExecutionRun (the old worktree/ledger fields), and
  ValidationReceipt (the old `result` semantics: `replayable` → which receipt axes the
  legacy facts support; `chatHistoryRequired` → disclosed). A declared `mapping` block
  cites each correspondence; a missing/corrupt legacy artifact fails closed.
- **`harness legacy profile`**: the declared disposition — NO harness correspondence
  (the profile concept was superseded by the governance/maintenance surfaces); recorded
  as a deletion candidate pending explicit user decision (never auto-deleted).
- **`harness legacy` (no subaction)**: the disposition table itself — one row per old
  surface (task, result, profile) naming its mapping (or absence) and its status
  (kept / deletion candidate), so the §52 ledger is readable in one view.
- **Everything read-only**: the view writes nothing (the legacy artifacts stay
  untouched; no Run/Receipt records are created); the old commands keep working
  unchanged (compatibility is the gate). Deletion of any old surface remains an
  explicit user decision, never a side effect.

## User Stories

1. As a reviewer, I want `harness legacy task --task <id>` to show what a legacy
   task's artifacts correspond to on the harness spine, so that §52 Rule 4–7
   correspondences are declared and citable, not tribal knowledge.
2. As a maintainer, I want the legacy `result` semantics (replayable /
   chatHistoryRequired) mapped onto the ValidationReceipt vocabulary, so that the old
   "replayable without chat history" question has a successor answer (the H5 gate).
3. As an owner, I want `harness legacy profile` to declare the profile surface's
   disposition (no correspondence; deletion candidate), so that removal is an
   explicit decision with a recorded rationale.
4. As a compatibility owner, I want the view to write nothing and the old commands to
   keep working unchanged, so that the migration declares rather than mutates.

## Implementation Decisions

- **Frozen-fixture conformance**: the legacy writer is deprecated and frozen (its
  persisted shape will not change before removal); conformance uses hand-written
  fixtures that mirror `persistExecutionArtifacts`'s exact on-disk shape
  (`.amber/executions/<taskId>/{ledger.json,evidence.json,replay.md}`), with the
  disclosure recorded in the spec and test comments. Driving the real `task prepare`
  would require a valid plan gate + active session — heavier than the legacy
  reader's contract warrants.
- **Projection, never record**: the legacy run projection carries `legacy: true` and
  cites source paths; it is never written to `.amber/harness/runs/` and never
  participates in the Run state machine.
- **Nearest-neighbor state mapping is closed and disclosed**: the old ledger's status
  values map to the nine-state vocabulary through a closed table in the adapter
  (e.g. prepared → admitted; unknown → `unevaluated`-style disclosure); unmapped
  statuses fail the projection with the raw value shown, never guessed.
- **CLI (expert tier, untyped)**: `harness legacy` joins the existing surface; no new
  flags beyond `--task`; fail-closed reads through the state-dir seam.
- **Naming/seam/guard constraints identical to F065–F074**.

## Testing Decisions

- Conformance over frozen fixtures: a legacy task with all three artifacts projects
  with the full mapping block; a missing artifact (no replay.md / no ledger) fails
  closed with the specific path named; a corrupt ledger.json fails closed; the
  nearest-neighbor state table maps each known status and refuses an unknown one;
  `harness legacy profile` returns the declared disposition; `harness legacy` (no
  subaction) returns the three-row table; the view writes nothing (run-record bytes
  and any harness ledgers unchanged — pinned by bytes).
- CLI smoke through the real dispatcher.

## Out of Scope

- Deleting `amber task`/`amber result`/`amber profile` (an explicit user decision;
  this feature only declares the dispositions); adopting legacy tasks as real Runs
  (a mutation — needs its own decision); §52 Rules 1–3 (the old ledgers/approvals
  continue to work as-is); MCP projection.

## Further Notes

- Design decisions follow the standing user directive (map `issues/0066` close-out
  follow-ups; this session's「先做2,3,4」). The HITL gate for draft → accepted is
  `issues/0122`.
