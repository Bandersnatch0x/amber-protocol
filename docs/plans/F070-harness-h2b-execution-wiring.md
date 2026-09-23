# F070 Plan: Harness H2b — Governed-Runner Wiring

**Feature:** F070
**Status:** implementation-ready (spec `docs/specs/F070-harness-h2b-execution-wiring.md`, accepted 2026-09-23 via `issues/0100`)
**User Confirmation:** confirmed (「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入)
**Date:** 2026-09-23
**Decision records:** Harness v2 §13/§24/§31/§40; F068 H2a as the staged foundation; G-9 row 11 seam
**Wayfinder map:** `issues/0066` (H2b named in fog, now graduated)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F070-harness-h2b-execution-wiring.md` |
| Composed seams (read-only / delegated) | `scripts/lib/core/execution-domain-adapter.js` (the row-11 seam), `scripts/lib/core/governed-runner.js` (four gates, Core), `scripts/lib/worktree-manager.js` (the ONE worktree seam) |
| Foundation | `scripts/lib/harness/execution-adapter.js` (H2a prepare/compare/evaluate), `scripts/lib/harness/run-core.js` (run state machine) |

## Slices (tracer bullets, blocking order)

1. **Prepared-workspace execution seam** (ticket 0101):
   `executeInPreparedWorkspace` on the execution-domain-adapter (cwd = prepared path; no
   createWorktree, no auto-remove); `runGovernedCommand` grows additive optional
   `preparedWorkspacePath` delegating through the same seam; `prepareExecution` gives a
   `local`-type workspace a bounded scratch root instead of the repo root. Focused tests
   at both seam levels.
2. **Per-mutation observation + growing fold** (ticket 0102): harness caller
   `runPreparedExecution` (four gates via `runGovernedCommand` → execute in prepared
   workspace → dirty-path observation → append observed entry → recompute fold);
   `evaluateExecution` accepts growth (append-only trail, recompute over full trail, BLOCK
   posture dedup); `amber harness execution run|release` subverbs + `releasedAt`;
   error-code registration.
3. **Integration gates** (ticket 0103): the §40 gate demo — one real prepared run answers
   where-did-it-run / what-could-it-access / what-did-it-actually-modify through
   `harness execution inspect --run`; full gates, three-piece catalog lockstep
   (CLI reference regen), stage-7 two-axis review, ticket-split commits.

## Verification per slice

- Focused: `node --test tests/unit/harness-execution.test.js` plus the governed-runner
  seam tests (real temp git repos).
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen:check`.

## Evidence schema

Recorded in `feature_list.json` F070 `evidence[]`. The acceptance demo: an admitted
contract prepares a real worktree for a run; a governed named command executes inside it
(four gates on the ledger); the run's own mutation observation folds into the comparison;
a violating attempt BLOCKs the run with the violation on the event trail; release removes
the workspace as a recorded step.

## Non-goals

Sandbox runtimes; network enforcement; per-write interception; replay (H5); scheduler
(H7); MCP projection; H3b; homepage/charter change.
