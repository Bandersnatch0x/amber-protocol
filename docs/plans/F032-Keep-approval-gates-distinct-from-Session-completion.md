# Plan: Keep approval gates distinct from Session completion

Feature: F032
Status: accepted
User Confirmation: confirmed

## Goal

Passing every approval gate records approval but does not mark a Session completed until strict completion evidence passes and session complete is invoked

## High Level Design

- Context:
  - While starting F031, real feature-standard Session
    `b5d284ee-59b7-4cba-b3f7-2063365694e4` recorded its two approval gates and
    immediately changed its manifest to `completed`.
  - The same Session's `complete-check --strict` deterministically fails with
    `Missing: verification`; its timeline shows `session_completed` immediately
    after the second `gate_passed` event.
  - `completeSession()` already owns the correct invariant: it evaluates strict
    completion and refuses the terminal transition when evidence is missing.
    `approveSession()` currently bypasses that interface when all gates pass,
    and an existing unit test has encoded the incorrect auto-completion behavior.
- Proposed approach:
  1. Replace the incorrect approval expectation with a regression test at the
     Session command interface: after every feature-standard gate passes but
     before verification, the manifest remains active, the timeline has no
     `session_completed`, and strict completion still reports missing evidence.
  2. Remove terminal-state ownership from `approveSession()`. It records the
     gate and reports that approvals are complete, but directs the operator to
     verification/complete-check instead of transitioning the state machine.
  3. Preserve `completeSession()` as the only normal completion seam and verify
     it still rejects missing verification and succeeds only after the existing
     evidence contract passes.
- Risks:
  - Callers may have relied on the incorrect approval auto-completion; the CLI
    message and lifecycle documentation must make the explicit completion step
    visible.
  - Moving completion logic into another helper would duplicate
    `completeSession()` and reintroduce two sources of truth; no new completion
    path is allowed.
  - Existing already-corrupt completed Sessions are durable history and will
    not be silently rewritten or migrated by this fix.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/knowledge/session-lifecycle-management/session-lifecycle-management.md, docs/adr/0001-governance-first-artifact-first.md, docs/adr/0003-governance-gated-execution.md
- review: docs/wiki/knowledge/session-lifecycle-management/session-lifecycle-management.md, docs/adr/0001-governance-first-artifact-first.md, docs/adr/0003-governance-gated-execution.md

## Vertical Slices

- [x] Slice 1: reproduce the two-gate/no-verification contradiction through the
  Session command interface and commit the exact failing regression assertion.
- [x] Slice 2: remove implicit terminal transition ownership from
  `approveSession()` while preserving gate files, gate events, and approval
  identity evidence.
- [x] Slice 3: verify explicit `session complete` remains strict, update the
  Session lifecycle contract, and run focused plus full regression checks.

## Resume Checkpoint

- Resume Point: F032 is accepted; all three slices are implemented and
  verified, the governed Session is completed, and the portable handoff is
  valid at 100/100 after final Standards, Spec, Claude Code, and Codex
  validation of the same WIP.
- Blockers: none; the user explicitly requested this defect be repaired before
  resuming F031.
- Next Action: inspect the final accepted diff, commit and push F032, wait for
  remote CI, then start a fresh F031 Session rather than reusing its historically
  auto-completed Session.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Passing the last approval gate does not set the Session manifest to
  `completed` and does not append `session_completed`.
- Approval evidence, gate identity, gate files, and pending/all-passed reporting
  remain correct for one-gate and multi-gate Routes.
- `complete-check --strict` remains the evidence truth and `session complete`
  remains the only normal command that writes the completed terminal state.
- Missing verification still blocks explicit completion; sufficient executed
  verification plus approval still permits it.
- No existing completed Session is silently rewritten and all Amber guardrails
  pass.

## Verification

- node --test tests/unit/session-commands.test.js
- node --test tests/amber-cli.test.js
- node scripts/validate-feature-list.js --target .
- npm test

## Evidence Schema

- Command: `node --test tests/unit/session-commands.test.js tests/amber-cli.test.js`
- Result: 78 passed, 0 failed (exit 0).
- Date: 2026-08-18
- Notes: unit and real CLI regressions prove that passing all approval gates
  leaves an unverified Session active, refreshes manifest `updatedAt`, emits no
  `session_completed`, and still permits explicit completion after executed
  verification. Artifact: this plan. Session:
  `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: `npm test`
- Result: 1968 passed, 4 skipped, 0 failed (1972 total; exit 0).
- Date: 2026-08-18
- Notes: final full repository rerun passed after one earlier unrelated DSH
  `npm pack --dry-run` concurrent `ETIMEDOUT`; that test passed alone and the
  subsequent non-concurrent full rerun was green. Artifact: this plan. Session:
  `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`. The 4 skips are existing
  platform/fixture skips. Remaining risk: remote CI has not rerun because the
  fix is not pushed.

- Command: `npm run lint`, `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `node scripts/validate-wiki.js --target .`,
  `node scripts/validate-feature-list.js --target .`, and `git diff --check`
- Result: all exit 0; doctor/manifests/wiki/feature-list report zero errors and
  15 generated agent files are current.
- Date: 2026-08-18
- Notes: implementation, tests, lifecycle knowledge, and plan remain within
  F032's booked scope. Artifact: this plan. Session:
  `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: Standards / Spec independent final review of the F032 WIP against
  baseline `177dd8f2b9cc59146adf4977293a4bc8426b8141`
- Result: Standards 0 findings; Spec 0 findings.
- Date: 2026-08-18
- Notes: both axes independently confirmed that approval, verification, and
  completion remain separate, the single completion seam is preserved, and
  no requested behavior or repository standard is missing. Artifact: this
  plan. Session: `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`. Remaining risk:
  remote CI has not rerun because the fix is not pushed.

- Command: Orca Run `run_c27401be854e`, Claude Code Task
  `task_85ae07f15443` / Dispatch `ctx_ac1a4ce7fa6d`, and Codex Task
  `task_934b8eb70325` / Dispatch `ctx_a39a585c29e3`
- Result: both workers reported `worker_done: succeeded`; Claude Code 2.1.233
  and Codex CLI 0.147.0 each exercised the native Amber plugin/skill flow,
  passed the 78 focused tests, and passed manifests/doctor/generated-agent
  checks without modifying repository files.
- Date: 2026-08-18
- Notes: Claude resolved `.claude-plugin/plugin.json` into `skills/` and loaded
  `$amber-delivery` through its native Skill tool; Codex loaded the repository
  `.agents/skills/amber` and `.agents/skills/amber-delivery` surfaces. Claude's
  LF-based before/after hash was `4b59307413bb0be44e62f7ae85095232059d1112`;
  the coordinator's fixed CRLF recipe and Codex both confirmed the unchanged
  eight-path fingerprint
  `9fc2aa78bf952879c97ace05a3f0a4ee7c42f619`. Both release attempts correctly
  retained user-taken-over terminals. Artifact: this plan. Session:
  `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`. Remaining risk: remote CI has not
  rerun because the fix is not pushed.

- Command: governed `npm test` verification, `session approve`,
  `session complete-check --strict`, and explicit `session complete` for
  Session `27de0ce6-d53e-48c6-a80d-57461a0bf7b9`
- Result: governed execution passed (exit 0); the repaired timeline is
  `gate_passed` -> `stage_completed` (`executed=true`, `exitCode=0`) ->
  `session_completed`, and strict completion passes.
- Date: 2026-08-18
- Notes: old Session `b5d284ee-59b7-4cba-b3f7-2063365694e4` remains durable
  reproduction history with `gate_passed` -> `gate_passed` ->
  `session_completed` and strict failure `Missing: verification`; it was not
  rewritten. Artifact:
  `.amber/sessions/27de0ce6-d53e-48c6-a80d-57461a0bf7b9/` (ignored runtime
  state). Remaining risk: remote CI has not rerun because the fix is not
  pushed.

- Command: `node scripts/amber.js accept --target . --plan
  docs/plans/F032-Keep-approval-gates-distinct-from-Session-completion.md
  --session 27de0ce6-d53e-48c6-a80d-57461a0bf7b9 --strict`;
  `node scripts/amber.js learnings --target . --feature F032`; `node
  scripts/amber.js handoff --target .`; `node scripts/amber.js handoff bundle
  --target .`; `node scripts/amber.js handoff validate --target . --json`
- Result: strict completion passed and F032 was accepted; no mandatory learning
  review is owed; the portable handoff scored 100/100 ready and validated with
  0 errors and 0 warnings.
- Date: 2026-08-18
- Notes: acceptance and resumable handoff close the governed lifecycle before
  commit. Artifact: `feature_list.json`, this plan, `session-handoff.md`, and
  ignored `.amber/handoff/latest/`. Remaining risk: remote CI has not rerun
  because the fix is not pushed.
