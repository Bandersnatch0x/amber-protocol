# Plan: Clarify learnings output when no mandatory review is owed

Feature: F030
Status: accepted
User Confirmation: confirmed

## Goal

When no mandatory write-back triggers match, amber learnings states that no mandatory review is owed while preserving the review-not-booked warning when triggers do match

## High Level Design

- Context:
  - GitHub issue #123 records that `amber learnings --feature F025` reports
    `review NOT booked` even though the same inspection says no mandatory
    write-back triggers matched.
  - The lifecycle contract correctly omits the learnings step when no trigger
    matches; only the human-readable inspection wording is misleading.
- Proposed approach:
  1. Add a CLI-level regression assertion for an accepted feature with no
     matched triggers, while preserving coverage for the accepted, triggered,
     unbooked case.
  2. Render the no-trigger inspection as "no mandatory review owed" and make
     judgment-based write-back explicitly optional. Keep the existing
     review-not-booked warning and booking remedy when triggers do match, and
     align the learning write-back runtime contract with that distinction.
  3. Run the dedicated learning write-back suite, the real F025 inspection,
     and repository guardrails before review.
- Risks:
  - Broadly suppressing the warning could hide a real mandatory checkpoint for
    schema, contract, or infrastructure changes.
  - Changing machine-readable status fields would expand this wording-only fix
    into an API change.
  - Trigger detection, owner routing, and booking semantics must remain
    unchanged.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-15-learning-writeback.md, docs/wiki/learning-owner-routing.md
- review: docs/specs/2026-08-15-learning-writeback.md, docs/wiki/learning-owner-routing.md

## Vertical Slices

- [x] Slice 1: reproduce the exact no-trigger wording and add a failing CLI
  regression assertion alongside the triggered/unbooked behavior.
- [x] Slice 2: condition the human-readable inspection wording on whether
  mandatory triggers exist, without changing trigger detection, booking, or
  machine-readable status fields; update the runtime contract wording.
- [x] Slice 3: run the targeted suite, real CLI reproduction, repository
  guardrails, independent review, and host-plugin validation.

## Resume Checkpoint

- Resume Point: F030 is accepted; the governed bugfix session is completed,
  learning review is booked to the command-owned contract surface, and the
  portable handoff is validated after final Standards/Spec and supervised
  Claude Code/Codex host-plugin validation of the same staged WIP
  (`4f32862cd5662cb85134bc5ba16e4f2e0cfadfc2`).
- Blockers: none.
- Next Action: run the final staged checks, commit and push, wait for remote CI,
  then refresh and validate the handoff against the pushed commit.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- An accepted feature with zero matched triggers says no mandatory review is
  owed and that judgment-based write-back is optional.
- An accepted feature with matched triggers and no booking still says the
  review is not booked and prints the booking remedy.
- JSON inspection fields, trigger classification, owner routing, and booking
  behavior remain unchanged.
- Existing Amber guardrails still pass; no release, dependency, schema, or
  execution-authority change is part of this feature.

## Verification

- node --test tests/unit/learning-writeback.test.js
- node scripts/amber.js learnings --target . --feature F025
- npm test
- npm run lint
- npm run gen:agents:check

## Evidence Schema

- Command: `node --test --test-name-pattern "degrades visibly|no-trigger inspection" tests/unit/learning-writeback.test.js`
- Result: failed before the fix (0 passed, 2 failed), then passed after the fix
  (2 passed, 0 failed).
- Date: 2026-08-18
- Notes: both core inspection and real CLI assertions caught the exact #123
  wording; no unrelated failure was used as the red signal. Artifact:
  `docs/plans/F030-Clarify-learnings-output-when-no-mandatory-review-is-owed.md`.
  Session: `09988a35-cf61-4739-9fee-4377c2b1b912`. Remaining risk: remote CI
  has not rerun because the fix is not pushed.

- Command: `node --test tests/unit/learning-writeback.test.js`
- Result: 43 passed, 0 failed.
- Date: 2026-08-18
- Notes: trigger classification, lifecycle, booking, owner routing, CLI, and
  handoff behavior remain green; real F025/F009/F021 checks cover booked and
  unbooked no-trigger output plus the triggered/unbooked warning. Artifact:
  this plan. Session:
  `09988a35-cf61-4739-9fee-4377c2b1b912`. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: `npm test`
- Result: 1965 passed, 4 skipped, 0 failed (exit 0, 143374ms).
- Date: 2026-08-18
- Notes: full repository verification after the wording fix and runtime
  contract update. Artifact: this plan. Session:
  `09988a35-cf61-4739-9fee-4377c2b1b912`. The 4 skipped tests are pre-existing
  platform/fixture skips, not F030 failures. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: `npm run lint`, `npm run format:check`, `npm run gen:agents:check`,
  `npm run manifests`, `node scripts/amber.js doctor --target .`, and
  `git diff --check`
- Result: all exit 0; doctor/manifests report zero errors and 15 generated
  agent files are current.
- Date: 2026-08-18
- Notes: changed paths remain confined to F030's booked scope.
  Artifact: this plan. Session: `09988a35-cf61-4739-9fee-4377c2b1b912`.
  Remaining risk: remote CI has not rerun because the fix is not pushed.

- Command: Standards / Spec final independent review of
  `git diff --cached 96a6836b5e69cbf729cf33b587bc6982e551bc0d`
- Result: Standards 0 findings (0 hard violations, 0 judgement smells); Spec 0
  findings (no missing behavior, scope creep, or implementation error).
- Date: 2026-08-18
- Notes: both axes independently confirmed the F025/F009/F021 boundaries and
  unchanged JSON/status semantics after first-review remediation. Artifact:
  this plan. Session: `09988a35-cf61-4739-9fee-4377c2b1b912`. Remaining risk:
  remote CI has not rerun because the fix is not pushed.

- Command: Orca Run `run_bf7b74565de3`, Claude Code Task
  `task_1162e9f712c1` / Dispatch `ctx_b4ef18af3a68`, Codex Task
  `task_c2ec090b0402` / Dispatch `ctx_6e4f0fe08d36`
- Result: both workers reported `worker_done: succeeded`; Claude Code 2.1.233
  and Codex CLI 0.147.0 each completed the native Amber plugin/skill flow,
  verified F025/F009/F021 plus JSON compatibility, and passed 43 tests with 0
  failures and 0 skips. WIP hash before/after was
  `4f32862cd5662cb85134bc5ba16e4f2e0cfadfc2` for both workers.
- Date: 2026-08-18
- Notes: Claude validated `.claude-plugin/plugin.json` -> `skills/`; Codex used
  the repository-native `.agents/skills/amber-delivery/SKILL.md` surface. No
  worker modified repository files. Non-blocking host observations were a
  Claude root-CLAUDE.md warning, no installed Codex marketplace entry, a
  missing global RTK.md reference, an official docs HTTP 403, and one Codex
  Bun mis-invocation that was diagnosed before the exact Node command passed.
  Artifact: this plan. Session:
  `09988a35-cf61-4739-9fee-4377c2b1b912`. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: governed `npm test` verification, `session approve
  --gate user-approval-fix --yes`, and `session complete-check --strict` for
  Session `09988a35-cf61-4739-9fee-4377c2b1b912`
- Result: governed execution exit 0 in 107466ms (1965 passed, 4 pre-existing
  skips, 0 failed); the approval gate passed, the tamper-evident ledger stayed
  intact, the Session completed, and strict completion passed.
- Date: 2026-08-18
- Notes: this is executed Amber evidence rather than a claim-only verification.
  Artifact: `.amber/sessions/09988a35-cf61-4739-9fee-4377c2b1b912/` (ignored
  runtime state). Remaining risk: remote CI has not rerun because the fix is
  not pushed.

- Command: accept F030; `node scripts/amber.js learnings --target . --feature
  F030 --reviewed --owner command --surface
  docs/specs/2026-08-15-learning-writeback.md`; `node scripts/amber.js handoff
  bundle --target .`; `node scripts/amber.js handoff validate --target .`
- Result: feature and plan accepted; contract trigger matched; learning review
  booked to owner `command` and the runtime contract surface; portable handoff
  scored 100/100 ready and validated with 0 errors and 0 warnings.
- Date: 2026-08-18
- Notes: the accepted knowledge write-back and resumable handoff close the
  governed lifecycle before commit. Artifact: `feature_list.json`,
  `docs/specs/2026-08-15-learning-writeback.md`, this plan, and ignored
  `.amber/handoff/latest/`. Remaining risk: remote CI has not rerun because the
  fix is not pushed.
