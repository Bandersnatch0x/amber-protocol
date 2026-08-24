# Plan: Adopt the state-dir path seam and fix the legacy .harness sessions bug

Feature: F036
Status: implementation-ready
User Confirmation: confirmed

## Goal

On a legacy `.harness` repository, every Amber surface that reads state finds the
same state directory: `amber audit` counts the same sessions as
`amber session list` (today it counts zero). Going forward, no module decides
state-dir policy for itself — all `.amber` path construction routes through
`state-dir-resolver`, so a future policy change (rename, env override) touches
one module instead of 38 files.

Source: `docs/reviews/architecture-survey-2026-08-24.md` Finding 2 (61 hardcoded
`path.join(..., ".amber", ...)` sites across 38 files, bypassing the resolver;
live audit-vs-session-list contradiction on legacy `.harness` repos at
`scripts/lib/core/audit.js:502`).

## High Level Design

- Context: `state-dir-resolver.js` already implements the correct policy —
  `resolveStateDirForRead` (prefer `.amber`, fall back to legacy `.harness` with
  warn-once) and `resolveStateDirForCreate` (always `.amber`). 28 files use it;
  61 join sites bypass it. The bypass is user-visible today: `audit.js:502`
  reads `path.join(targetRoot, ".amber", "sessions")` directly, so on a legacy
  repo `amber audit` reports 0 sessions while `amber session list` (which goes
  through `resolveStateDirForRead` in `session-commands.js:32`) reports them
  correctly.
- Proposed approach: two slices.
  - **S1 (bug fix)** — route the three sessions surfaces
    (`audit.js:502`, `lifecycle.js:127`, `context-request.js:119`) through
    `resolveStateDirForRead`, with a legacy-fixture regression test that pins
    `amber audit` and `amber session list` agreeing on a `.harness` repo.
  - **S2 (seam adoption)** — add path-building verbs to `state-dir-resolver`:
    `statePath(root, ...segments)` (read policy) and `statePathForCreate(root,
    ...segments)` (create policy). Migrate the remaining hardcoded joins to the
    verbs. Read-vs-create policy at each site follows the call's semantics:
    reading existing state → `statePath`; creating/writing new state →
    `statePathForCreate`. Sites whose artifact never existed under `.harness`
    (knowledge, context, memory, org-audit ledgers) still migrate — the win is
    single-point policy, not just legacy correctness.
- Risks: S2 is wide (~58 mechanical edits). Each site needs a read-vs-create
  decision; a wrong choice writes new state into `.harness` on legacy repos
  (violating the create policy). Mitigation: grep the call context per site,
  and S1's legacy-fixture tests guard the sessions surfaces. The warn-once
  latches in the resolver are process-global; tests must call `resetWarnings`.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/reviews/architecture-survey-2026-08-24.md
- review: docs/reviews/architecture-survey-2026-08-24.md

## Vertical Slices

- [x] Slice 1: fix the live bug — the three sessions surfaces route through
  `resolveStateDirForRead`; legacy-fixture test pins audit/session-list
  agreement on a `.harness` repo (red first). Done: commit 5b0db8e, issue #205
  (lifecycle.js's identical path was an unreachable fallback and was deleted
  rather than fixed).
- [x] Slice 2: add `statePath`/`statePathForCreate` verbs to
  `state-dir-resolver` (commit cbcce64) and migrate the remaining hardcoded
  `.amber` joins (commit 5daffb1, lint follow-up 4ed2c2a); full suite
  baseline-identical; guard test pins zero literal joins. Issue #206 closed.

## Resume Checkpoint

- Resume Point: both slices complete and committed; issues #205/#206 closed
  with evidence; verification evidence recorded on the feature.
- Blockers: none.
- Next Action: review closeout (session complete-check → complete → handoff →
  accept).
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- On a legacy `.harness` fixture, `amber audit` session count equals
  `amber session list` count (the live contradiction is gone).
- No module outside `state-dir-resolver.js` concatenates the state dir by
  literal `.amber` (production code; tests and the resolver itself excepted).
- New state is still always created under `.amber` (create policy unchanged).
- Existing Amber guardrails still pass (doctor, pre-commit, full test suite).

## Verification

- `rtk node --test tests/unit/state-dir-resolver.test.js tests/unit/audit.test.js`
- `rtk node --test` (full suite)
- Legacy-fixture regression test added in S1 runs green in both suites.

## Evidence Schema

- Command: `rtk node --test tests/unit/legacy-sessions-state-dir.test.js`
- Result: 2/2 pass (both red before the S1 fix: audit sessionCount 0 on a
  `.harness` fixture; bundleSources found no legacy ledger)
- Date: 2026-08-25
- Notes: red-first evidence for the live bug; the new test file joins the
  legacy-references allowlist.

## Evidence Schema (closeout)

- Command: `rtk node --test` (full suite)
- Result: 2580 tests, 2522 pass, 58 failures — byte-identical to the
  pre-change baseline set (55 apps/web .ts files requiring vitest +
  e2e_bugfix_retry, amber-go-stock, week-c6-settings validators); zero new
  failures. Guard suite (state-dir-seam-guard) green.
- Date: 2026-08-25
- Notes: guardrails (doctor errors=0, pre-commit lint/prettier) pass; commits
  5b0db8e, cbcce64, 5daffb1, 4ed2c2a; issues #205/#206 closed with evidence.
