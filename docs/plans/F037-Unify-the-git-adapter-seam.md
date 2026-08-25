# Plan: Unify the git adapter seam

Feature: F037
Status: accepted
User Confirmation: confirmed

## Goal

git-exec.js becomes the single git invocation seam; sync-session, identity, and worktree-manager migrate onto it and their private wrappers are deleted

## High Level Design

- Context: architecture survey 2026-08-24 Finding 4 (docs/reviews/architecture-survey-2026-08-24.md). `git-exec.js` is canonical for 4 modules but bypassed by 3, with three incompatible failure shapes in flight: `null` (gitOutput), `""` (identity's gitConfig), `{exitCode: -1}` (sync-session's private git — brand-new F035 code).
- Proposed approach: extend `git-exec.js` with `gitExec(targetRoot, args) -> {ok, status, stdout, stderr}` (superset; sync-session's shape maps exactly) plus thin conveniences `isRepository(targetRoot)` and `configGet(targetRoot, key)` ("" on failure, preserving identity's policy). Migrate sync-session.js, identity.js, worktree-manager.js onto it; delete the three private wrappers.
- Risks: observable-behavior drift during migration (each wrapper has its own trim/empty policies); tests may pin exact envelope shapes. Mitigation: red-first per-module behavior tests before touching each module; full-suite baseline comparison (58 known failures).

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/reviews/architecture-survey-2026-08-24.md
- review: docs/reviews/architecture-survey-2026-08-24.md

## Vertical Slices

- [x] Slice 1: red-first unit tests for `gitExec`/`isRepository`/`configGet` shapes (success, non-zero exit, spawn failure), then implement in git-exec.js (green).
- [x] Slice 2: migrate sync-session.js onto gitExec (delete private git()), identity.js onto configGet (delete gitConfig), worktree-manager.js 4 spawnSync sites onto the adapter; delete private wrappers; add git-seam guard test (no direct `spawnSync("git"` in scripts/lib outside git-exec.js, dev tooling exempt).

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F037-Unify-the-git-adapter-seam.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- git-exec.js is the only module in scripts/lib that spawns git directly (guard test enforces).
- sync-session, identity, worktree-manager behave identically to before (existing suites green; wrapper-specific failure policies preserved: "" for missing config, exitCode-mapped {ok,status} for sync).
- Existing Amber guardrails still pass; full suite matches the 58-known-failure baseline.

## Verification

- Red-first: `rtk node --test tests/unit/git-exec-seam.test.js` → 10/10 fail pre-implementation (exports absent) → 10/10 pass after.
- Guard: `rtk node --test tests/unit/git-seam-guard.test.js` → 1/1 pass after migration (would fail on the pre-migration bypasses).
- Consumer suites: git-state, git-workflow-detector, completion-gate, ledger-seal, artifact-drift, git-exec, sync-session, sync-command, sync-conflicts, sync-project, sync-remote, sync-version, identity-bootstrap, session-approve-identity, validate-git-identity, scaffold-gitignore-advisory, worktree-manager → 219/219 pass (targeted runs) + 167/167 (follow-up run) with zero failures.
- Full suite: `rtk node --test` → 2593 tests / 2535 pass / 58 fail = known baseline (55 apps/web vitest files + week-c6-settings + amber-go-stock + e2e_bugfix_retry) + 11 new tests, zero new failures.
- Session evidence: `amber session verify --execute` ran `npm test` for real (exit 0, 135369ms), recorded against feature F037.

## Evidence Schema

- Command: `rtk node --test` (full suite)
- Result: 2593 tests / 2535 pass / 58 fail (baseline-identical + 11 new tests)
- Date: 2026-08-25
- Notes: implementation via subagent (git-exec seam + 3 migrations + 2 new test files); coordinator-verified diffs, targeted suites, and full suite. Commit 994d6a6.
