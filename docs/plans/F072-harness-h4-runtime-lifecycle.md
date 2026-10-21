# F072 Plan: Harness H4 — Runtime Lifecycle (Attempts, Checkpoints, the Unified Mapping)

**Feature:** F072
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入 (`issues/0110`)
**Date:** 2026-09-23
**Decision records:** Harness v2 §4.4/§6/§14/§33/§42/§49; ADR-0101 (Run state machine, loop↔run adapter); F068/F070 (execution boundary + governed-runner wiring)
**Wayfinder map:** `issues/0066` (H4 named in fog, now graduated)

## High Level Design

- Context: a run recorded its state and events but not its attempts or checkpoints. Retries were
  invisible, no-progress could not be derived from two identical failures, and recovering a run
  meant reading the trail by hand. The four lifecycle surfaces (run, loop, session, task) also
  had no single view that mapped them together.
- Proposed approach: attempt records with per-attempt events, run-scoped checkpoints that cite
  the run and execution digests, and a read-only lifecycle view that renders the mapping from
  admission pointers. Every record is closed and fail-closed on read; recovery verifies the run
  still stands in the captured state and refuses on drift.
- Risks: the run state machine must stay untouched, or H4 reshapes what H0 decided; checkpoint
  capture must not copy the workspace, or the cost explodes; and pre-H4 records must stay
  byte-compatible, which is why the run summaries are additive and optional.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F072-harness-h4-runtime-lifecycle.md, docs/adr/0101-run-unit-of-auditable-execution.md, schemas/run.schema.json, schemas/event.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F072-harness-h4-runtime-lifecycle.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **Attempt records + per-attempt events** (ticket 0111): `attempt-core.js` owns the
   run-scoped attempt record (closed inline shape, fail-closed reads, terminal records);
   `runPreparedExecution` records each attempt (including refusals) and emits
   `execution.started` + `execution.completed|failed`; the run's additive `attempts`
   summary updates on each record.
2. **Checkpoints + summaries** (ticket 0112): run-scoped capture (non-final states only)
   under `.amber/harness/checkpoints/<runId>/` citing run/execution record digests;
   recovery = read + verify the run still stands in the captured state (drift refuses);
   run's additive `checkpoints` summary; CLI `harness checkpoint --run <id>` with
   `capture`/`list`/`verify` subverbs.
3. **Unified lifecycle view + integration gates** (ticket 0113): `amber harness lifecycle
   [--run <id>]` read-only mapping view (run state/history, loop/session/task provenance
   from admission pointers, execution verdict, attempts, checkpoints); conformance tests
   (started/completed/failed/refused emissions, no-progress derivation, checkpoint
   capture/verify/drift-refusal/terminal-refusal, lifecycle view + fail-closed corrupt
   record, pre-H4 byte-compatibility); full gates; docs lockstep; stage-7 two-axis review;
   ticket-split commits.

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries three evidence entries (the `issues/0110` confirmation, the dual-axis review, and the 19/19 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F072, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F072-harness-h4-runtime-lifecycle.md` and the `issues/0111`–`0113` logs; never hand-edit the F072 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- One prepared run executes a governed attempt with `started` and `completed` events and a `completed` attempt record; a failing command records `failed`, and no-progress is derivable from two identical failures.
- A checkpoint is captured and verified, and a drifted run refuses recovery instead of reporting a success it did not observe.
- `amber harness lifecycle --run <id>` renders the unified mapping in one view: run state and history, loop/session/task provenance from admission pointers, execution verdict, attempts, and checkpoints.
- The run state machine is untouched, and pre-H4 records stay byte-compatible.
- Existing guardrails still pass, and the current phase boundary is unchanged: no no-progress enforcement, no workspace copying in checkpoints, no session-machine changes, no replay or scheduler.

## Verification

- Focused: `node --test tests/unit/harness-attempt.test.js` (new),
  `tests/unit/harness-execution.test.js`, `tests/unit/harness-run.test.js`.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`.

## Evidence Schema

- Command: `node --test tests/unit/harness-attempt.test.js tests/unit/harness-checkpoint.test.js`
- Result: pass — 19/19 focused (attempt records incl. 3 real governed-path wiring cases + raw-CLI smoke; checkpoints incl. dispatch-level subverb smoke)
- Date: 2026-09-23
- Notes: the acceptance demo is the §42 gate — one prepared run executing a governed attempt, a second failing attempt with no-progress derivable, a checkpoint captured and verified, and the unified lifecycle view rendering in one pass; a drifted run refuses recovery.

## Non-goals

No-progress enforcement; checkpoint workspace copying; session-machine changes; replay
(H5); scheduler (H7); MCP projection; charter/homepage change.
