# F068 Plan: Harness H2a — Execution Boundary

**Feature:** F068
**Status:** implementation-ready (spec `docs/specs/F068-harness-execution-boundary.md`, accepted 2026-09-22 via `issues/0088`)
**User Confirmation:** confirmed (「按推荐」, 2026-09-22)
**Date:** 2026-09-22
**Decision records:** Harness v2 §13/§24/§31; F065/F066/F067 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0087–0092; H2b named in fog)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F068-harness-execution-boundary.md` |
| Composed seams (read-only / prepare-only) | `scripts/lib/worktree-manager.js` (the one worktree seam), the governed-execution records (observed fold) |
| Foundation | `scripts/lib/harness/` (H0 pattern), F067 tool registry |

## Slices (tracer bullets, blocking order)

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

## Verification per slice

- Focused: `node --test tests/unit/harness-execution.test.js` (6 cases; real temp git repos for
  the worktree adapter) plus the full harness set.
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence schema

Recorded in `feature_list.json` F068 `evidence[]`. The acceptance demo: an admitted contract
prepares a real worktree whose effective report is field-comparable to the declaration, and a
violating observed trail BLOCKs the run with the violation on the event trail.

## Non-goals

H2b (governed-runner consumes adapter-prepared workspaces; per-mutation observation) — its own
ticket behind H2a evidence; sandbox runtimes (Docker/WSL/CI); network enforcement; replay (H5);
scheduler (H7); MCP projection; homepage/charter change.
