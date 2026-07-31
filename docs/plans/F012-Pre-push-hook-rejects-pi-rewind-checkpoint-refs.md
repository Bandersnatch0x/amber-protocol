# Plan: Pre-push hook rejects pi-rewind checkpoint refs

Feature: F012
Status: accepted
User Confirmation: confirmed

## Goal

git push --mirror or a direct push of refs/pi-checkpoints/* is blocked by .githooks/pre-push with a clear error; normal branch/tag pushes are unaffected

## High Level Design

- Context: pi-rewind (npm:pi-rewind extension) stores per-turn undo snapshots under refs/pi-checkpoints/* — full working-tree snapshots that must stay local (they can capture untracked files such as session dumps). Commit ded8d3b added .githooks/pre-push to refuse pushes whose local refs include refs/pi-checkpoints/*; that guard currently has no automated test coverage. This plan adds a unit suite that spawns the hook with stdin fixtures and asserts exit codes, so a future regression cannot silently reopen the --mirror leak.
- Proposed approach: add tests/unit/pre-push-hook.test.js using node:test + child_process.spawnSync("sh", [HOOK, ...]) with fixture stdin lines (pi-checkpoint ref → exit 1 with error message; master ref → exit 0; mixed/mirror → exit 1; empty stdin → exit 0). Guard the suite with a sh-availability check so environments without sh skip rather than fail (matches the git-availability guard pattern in tests/unit/git-workflow-detector.test.js). No changes to the hook itself are expected.
- Risks: low. Hook behavior is already implemented and manually verified; the suite only locks it in. On Windows without git-bash sh on PATH the suite skips, which is the same tradeoff the repo already accepts for git-dependent tests.

## Vertical Slices

- [x] Slice 1: add the pre-push hook unit suite (spawn with stdin fixtures, sh-guarded).
- [x] Slice 2: run the focused suite and confirm existing guard behavior (4 cases) passes.

## Acceptance Criteria

- tests/unit/pre-push-hook.test.js exists and passes: pi-checkpoint ref → exit 1; master ref → exit 0; mixed refs → exit 1; empty stdin → exit 0.
- The hook file is unchanged by this plan (guard behavior preserved).
- Existing Amber guardrails still pass: eslint + full npm test.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F012-Pre-push-hook-rejects-pi-rewind-checkpoint-refs.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- npm test

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
