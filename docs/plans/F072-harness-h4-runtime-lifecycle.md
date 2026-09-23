# F072 Plan: Harness H4 — Runtime Lifecycle (Attempts, Checkpoints, the Unified Mapping)

**Feature:** F072
**Status:** implementation-ready (spec `docs/specs/F072-harness-h4-runtime-lifecycle.md`, accepted 2026-09-23 via `issues/0110`)
**User Confirmation:** confirmed (「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入)
**Date:** 2026-09-23
**Decision records:** Harness v2 §4.4/§6/§14/§33/§42/§49; ADR-0101 (Run nine-state machine, loop↔run adapter); F068/F070 (execution boundary + governed-runner wiring)
**Wayfinder map:** `issues/0066` (H4 named in fog, now graduated)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F072-harness-h4-runtime-lifecycle.md` |
| Run spine (untouched verdicts) | `scripts/lib/harness/run-core.js`, `scripts/lib/harness/run-state-machine.js` |
| Attempt wiring (governed attempts, event emissions) | `scripts/lib/harness/execution-adapter.js` (`runPreparedExecution`), new `scripts/lib/harness/attempt-core.js` |
| Checkpoints | new checkpoint capture/verify in the harness layer (state area `.amber/harness/checkpoints/<runId>/`) |
| Unified view + CLI | `scripts/lib/harness/harness-commands.js` (`lifecycle`/`checkpoint` subverbs), `scripts/lib/command-registry.js` help, `scripts/lib/core/cli-output.js` (FLAG_SPECS if a new flag is needed) |
| Schemas | `schemas/run.schema.json` (additive optional `attempts`/`checkpoints` summary sections only) |

## Slices (tracer bullets, blocking order)

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

## Verification per slice

- Focused: `node --test tests/unit/harness-attempt.test.js` (new),
  `tests/unit/harness-execution.test.js`, `tests/unit/harness-run.test.js`.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`.

## Evidence schema

Recorded in `feature_list.json` F072 `evidence[]`. The acceptance demo (§42 gate): one
prepared run executes a governed attempt (started + completed events, attempt record
`completed`), a second attempt with a failing command records `failed` (no-progress
derivable from two identical failures), a checkpoint is captured and verified, and
`amber harness lifecycle --run <id>` renders the unified mapping in one view; a drifted
run refuses checkpoint recovery.

## Non-goals

No-progress enforcement; checkpoint workspace copying; session-machine changes; replay
(H5); scheduler (H7); MCP projection; charter/homepage change.
