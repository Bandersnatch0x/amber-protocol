# F068 Plan: Harness H2a — Execution Boundary

**Feature:** F068
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「按推荐」, 2026-09-22 (`issues/0088`)
**Date:** 2026-09-22
**Decision records:** Harness v2 §13/§24/§31; F065/F066/F067 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0087–0092; H2b named in fog)

## High Level Design

- Context: a run could name tools but not the boundary it executes inside. Without a declared
  workspace, filesystem, network and mutation posture, "where did it run" and "what could it
  reach" had no recorded answer, and a violation had nothing to be measured against.
- Proposed approach: a closed ExecutionContract artifact (the declaration), an adapter that
  prepares a real workspace from it, and a deterministic three-way comparison of declared vs
  effective vs observed. The comparison never invents `ok`: an uncheckable entry reads
  `unevaluated`, and a violation BLOCKs the run with the finding on the event trail.
- Risks: Amber must not start owning a sandbox — this slice prepares and observes, it does not
  enforce (ADR-0022, `issues/0044`); the worktree must compose the one existing seam rather than
  create a second; and the effective report must stay field-comparable to the declaration, or the
  comparison degrades into guesswork.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F068-harness-execution-boundary.md, docs/adr/0100-harness-contract.md, docs/specs/F067-harness-tool-capability-boundary.md, schemas/execution-contract.schema.json, schemas/run.schema.json
- review: docs/specs/F068-harness-execution-boundary.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **ExecutionContract** (ticket 0089, done): `schemas/execution-contract.schema.json`
   (workspace/filesystem prefixes/network/resources/mutation; repo-relative prefix shape checks
   in core) + `scripts/lib/harness/execution-core.js` (H0 pattern: Snapshot Hash, immutability,
   tombstones) + `amber harness execution admit|list|inspect` + 8 `AMBER_E_HARNESS_EXEC_*`
   codes + schema-count pin 26→27.
2. **ExecutionAdapter + effective report** (ticket 0090, done):
   `scripts/lib/harness/execution-adapter.js` — `prepareExecution` selects the adapter by the
   declared workspace type; GitWorktreeAdapter composes `createWorktree` (one-worktree-seam
   rule, asserted via `listWorktrees`); LocalAdapter prepares the bounded root; the EFFECTIVE
   report mirrors the declared shape (shared defaults) and is stored once per run
   (`.amber/harness/executions/<runId>.json`, closed inline shape — no new schema file).
3. **Three-boundary comparison + Run integration** (ticket 0091, done):
   `compareBoundaries` — the deterministic §13 fold (effective-vs-declared adapter-drift
   check; observed mutations vs deny/write prefixes; timeout budget; refusal/uncheckable
   entries as info); verdicts `ok | violation | unevaluated` (no invented ok);
   `evaluateExecution` stores observed+comparison, integrates them into the run's additive
   `execution` section, and on violation emits the BLOCK-posture `execution.failed` event and
   stops the run (running→blocked; created/admitted→cancelled). One evaluation per execution.
4. **Integration** (ticket 0092): full gates, three-piece catalog, docs lockstep, stage-7
   two-axis review, ticket-split commits.

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries two evidence entries (the `issues/0088` confirmation and the 6/6 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F068, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F068-harness-execution-boundary.md` and the `issues/0087`–`0092` logs; never hand-edit the F068 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- An admitted contract prepares a real worktree whose effective report is field-comparable to the declaration, and the worktree is created through the one existing seam.
- `compareBoundaries` yields only `ok`, `violation` or `unevaluated`; an uncheckable entry never reads `ok`.
- A violating observed trail emits the BLOCK-posture event and stops the run, with the violation on the event trail.
- One evaluation per execution: a second evaluation of the same execution is refused rather than silently appended.
- Existing guardrails still pass, and the current phase boundary is unchanged: Amber prepares and observes but does not own a sandbox, no network enforcement, no sandbox runtimes, no replay, no scheduler.

## Verification

- Focused: `node --test tests/unit/harness-execution.test.js` (6 cases; real temp git repos for
  the worktree adapter) plus the full harness set.
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence Schema

- Command: `node --test tests/unit/harness-execution.test.js`
- Result: pass — 6/6 focused tests green (real temp git repos for the worktree adapter; deterministic fold cases ok/violation/unevaluated)
- Date: 2026-09-22
- Notes: the acceptance demo is an admitted contract preparing a real worktree whose effective report is field-comparable to the declaration, and a violating observed trail BLOCKing the run with the violation on the event trail.

## Non-goals

H2b (governed-runner consumes adapter-prepared workspaces; per-mutation observation) — its own
ticket behind H2a evidence; sandbox runtimes (Docker/WSL/CI); network enforcement; replay (H5);
scheduler (H7); MCP projection; homepage/charter change.
