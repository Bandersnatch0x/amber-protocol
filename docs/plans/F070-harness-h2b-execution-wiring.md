# F070 Plan: Harness H2b — Governed-Runner Wiring

**Feature:** F070
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入 (`issues/0100`)
**Date:** 2026-09-23
**Decision records:** Harness v2 §13/§24/§31/§40; F068 H2a as the staged foundation; G-9 row 11 seam
**Wayfinder map:** `issues/0066` (H2b named in fog, now graduated)

## High Level Design

- Context: H2a could prepare a workspace and compare declared against effective, but the run did
  not actually execute *inside* that prepared workspace. The observation covered the declaration,
  not the mutations the command made, so the fold could not answer "what did it actually modify".
- Proposed approach: extend the existing execution-domain seam with a prepared-workspace entry
  point so the four governed gates still run and the command executes at the prepared cwd; then
  append per-mutation observations and recompute the §13 fold over the growing trail. Release
  becomes a recorded step rather than an implicit cleanup.
- Risks: the seam must not bypass the four gates or create a second worktree path; growth must be
  append-only with a deduplicated BLOCK posture, or a repeated violation multiplies events; and a
  gate refusal must stay fail-closed while still recording the attempt honestly.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F070-harness-h2b-execution-wiring.md, docs/specs/F068-harness-execution-boundary.md, schemas/execution-contract.schema.json, schemas/run.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F070-harness-h2b-execution-wiring.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

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

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0100` confirmation and the 14/14 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F070, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F070-harness-h2b-execution-wiring.md` and the `issues/0101`–`0103` logs; never hand-edit the F070 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A governed named command executes inside the prepared workspace with all four gates on the ledger, through the existing seam rather than a second worktree path.
- The run's own mutation observation folds into the comparison, and a violating attempt BLOCKs the run with the violation on the event trail.
- The observed trail grows append-only, the fold is recomputed over the full trail, and the BLOCK posture does not duplicate events on re-evaluation.
- A gate refusal stays fail-closed, and a failing command is still observed rather than dropped.
- Release removes the workspace as a recorded step, and `harness execution inspect --run` answers where-did-it-run / what-could-it-access / what-did-it-actually-modify.
- Existing guardrails still pass, and the current phase boundary is unchanged: no sandbox runtimes, no network enforcement, no per-write interception, no replay or scheduler.

## Verification

- Focused: `node --test tests/unit/harness-execution.test.js` plus the governed-runner
  seam tests (real temp git repos).
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen:check`.

## Evidence Schema

- Command: `node --test tests/unit/harness-execution.test.js`
- Result: pass — 14/14 focused tests green (prepared-worktree seam, local bounded root + run/release, §13 fold, idempotent + multi-attempt growth, run observation, own-trail BLOCK, gate-refusal fail-closed, failing-command still observed, raw-CLI flag mapping)
- Date: 2026-09-23
- Notes: the acceptance demo is an admitted contract preparing a real worktree, a governed named command executing inside it with four gates on the ledger, the run's own mutation observation folding into the comparison, and a violating attempt BLOCKing the run.

## Non-goals

Sandbox runtimes; network enforcement; per-write interception; replay (H5); scheduler
(H7); MCP projection; H3b; homepage/charter change.
