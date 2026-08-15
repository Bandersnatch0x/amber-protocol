# Plan: Finish-time dirty-path classification and scope-discipline review checks

Feature: F026
Status: implementation-ready
User Confirmation: confirmed

## Goal

`amber handoff` classifies dirty worktree paths into Amber-managed churn, the focus feature's uncommitted work (bail back: commit before finishing), and outside-scope files (reported once, left alone); `amber review` flags booked feature paths absent from the plan's declared scope and prints a four-question scope-discipline checklist

## High Level Design

- Context:
  - At finish time the worktree is often dirty with a mix of Amber-managed churn (.amber/
    session state), the session's own uncommitted work, and unrelated parallel edits; handoff
    says nothing today (Repo State renders only `dirty (tracked and/or untracked changes)`),
    so uncommitted feature work ships silently or gets mixed into parallel work (P2-2).
  - Review has no scope-discipline surface: files booked onto a feature that the plan's Scope
    never mentioned — classic scope creep (out-of-task tidying, speculative abstraction,
    caller-side workarounds) — pass unnoticed (P2-3).
  - Verified against code: `getRepoSnapshot` (scripts/lib/core/git-state.js) already runs
    `git status --porcelain` but discards the paths — it returns only `dirty` /
    `dirtyUntrackedOnly` booleans, so exposing per-file status is a required (not optional)
    small extension. Porcelain edge-case parsing (rename `orig -> path`, quoted paths) already
    exists in completion-check's `hasWorkEvidence` and is the precedent to reuse.
- Proposed approach:
  1. New read-only module scripts/lib/core/dirty-paths.js:
     `classifyDirtyPaths(targetRoot, { featurePaths })` — input the dirty/changed path list
     (from the extended snapshot), output three buckets with deterministic rules:
     `managed` (path under `.amber/` or legacy `.harness/`, or carrying the `.amber-backup`
     suffix hooks-command already uses — expected churn), `focusWork` (path equals or lives
     under one of the focus feature's booked `feature.paths` — the session's own work,
     bail-back message: commit before finishing), `outsideScope` (the rest — reported once as
     possibly-parallel/unbooked, never touched). Pure classification: no git writes, no
     interactivity, no lifecycle state.
  2. git-state extension (required): `getRepoSnapshot` gains `dirtyPaths` — the parsed
     porcelain entries (reusing hasWorkEvidence's parsing rules), degrading to `[]` on any git
     failure exactly like the existing fields (the degrade-to-null/false contract stays).
     Existing consumers of `dirty`/`dirtyUntrackedOnly` are unchanged.
  3. Handoff wiring: a conditional "Dirty worktree" section in renderHandoff
     (scripts/lib/handoff-command.js), following the learningWriteBackLines pattern (helper
     returns null when quiet, section appended only then). Rendered when any non-managed
     bucket is non-empty: focusWork lists paths plus the bail-back line; outsideScope lists
     paths plus one FYI line; managed churn is summarized as a count only (noise reduction).
     The focus feature's booked paths come from feature_list.json via the ctx.focus id
     (buildContext already carries it) — a feature with no booked paths simply leaves
     focusWork empty (conservative). The new section is NOT added to
     REQUIRED_HANDOFF_SECTIONS in scripts/lib/core/constants.js: it is conditional, and
     validateHandoff would otherwise fail every clean-tree handoff.
  4. Review scope-discipline (P2-3): in reviewPlan, resolve the plan's Feature id
     (readPlanField), load its booked paths (findFeatureById), extract the plan's declared
     Scope (the `- Scope:` bullet under High Level Design — the F024/F025 shape), and diff:
     booked-but-unmentioned paths (verbatim mention or directory prefix) become
     scope-discipline advisories. Code-verified constraint: every entry in a review's
     findings array is severity "error" and unconditionally blocks (errors mapping,
     requiredUserAction, releaseReadiness in buildReviewResult) — so advisories ride the
     existing non-blocking warnings channel (plus a structured `scopeDiscipline` block on the
     review result for tests), never the findings array; the blocking computation is
     untouched. PLUS a four-question scope-discipline checklist rendered in review output as
     advisory lines (original wording: uninvited tidying outside the task; abstraction added
     beyond what the change needs; files the acceptance criteria never named; a workaround
     patched into the caller instead of the cause).
  5. Non-goals: no git mutations, no interactivity ("ask once" becomes "surface once"), no
     new lifecycle step, no new top-level command, no changes to complete-check gating or the
     evidence-required acceptance gate (advisory only).
- Risks:
  - getRepoSnapshot's extension must keep the degrades-to-null contract — dirtyPaths is `[]`
    (not an error) on non-git dirs and git failures, so handoff on a non-git target renders
    no section (verified: gitInfo already handles the non-git shape).
  - Plan Scope sections are prose — matching must be conservative (exact path or directory
    prefix mention; when in doubt, no finding), otherwise review nags on every
    loosely-written plan.
  - Porcelain parsing edge cases (renames, quoted paths) — reuse the exact rules from
    completion-check's hasWorkEvidence rather than inventing a second parser.
  - validateHandoff scrapes required sections — adding "Dirty worktree" to
    REQUIRED_HANDOFF_SECTIONS would break clean-tree handoffs; it must stay conditional.
- Scope:
  - Touches `scripts/lib/core/dirty-paths.js` (new read-only classification module),
    `scripts/lib/core/git-state.js` (dirtyPaths extension), `scripts/lib/handoff-command.js`
    (conditional Dirty worktree section via the learningWriteBackLines pattern),
    `scripts/lib/core/planning.js` (scope-discipline diff in the review assembly + advisory
    channel), `scripts/lib/core/cli-output.js` (checklist rendering in review output),
    `tests/unit/dirty-paths.test.js` (new suite), `tests/unit/git-state.test.js`
    (dirtyPaths + section rendering cases, including the temp-git-repo end-to-end —
    `tests/unit/planning.test.js` (scope-discipline cases), plus docs wiring
    (docs/CLI_REFERENCE.md handoff/review notes if apt). Reuses `findFeatureById` and
    `readPlanField` from existing modules as imports.
  - Non-goals: no git mutations (classification reads, it never stages/commits/asks), no
    interactivity, no new lifecycle step (the breadcrumb parity walk stays untouched), no new
    top-level command, and no changes to complete-check gating or the evidence-required
    acceptance gate — the scope finding is advisory and never blocks.

## Vertical Slices

- [ ] Slice 1: classification core + snapshot extension — scripts/lib/core/dirty-paths.js
  (`classifyDirtyPaths(targetRoot, { featurePaths })` → managed/focusWork/outsideScope with
  prefix matching) and the required `dirtyPaths` field on getRepoSnapshot (parsed porcelain,
  `[]` on failure, existing booleans untouched, hasWorkEvidence's rename/quote rules); red
  tests first in tests/unit/dirty-paths.test.js + tests/unit/git-state.test.js.
- [ ] Slice 2: handoff wiring — conditional "Dirty worktree" section in renderHandoff via the
  learningWriteBackLines pattern (focusWork + bail-back line, outsideScope + one FYI line,
  managed as a count; null → no section when only managed churn or clean tree); focus paths
  resolved from ctx.focus's feature entry; REQUIRED_HANDOFF_SECTIONS deliberately untouched;
  end-to-end case on a temp git repo with a dirty tree (all in tests/unit/dirty-paths.test.js).
- [ ] Slice 3: review scope-discipline — resolve the plan's Feature id, load booked paths,
  extract the `- Scope:` bullet, diff with conservative matching (exact path or directory
  prefix; ambiguity → no finding); advisories ride the warnings channel + a structured
  scopeDiscipline block (never the blocking findings array — buildReviewResult's
  errors/requiredUserAction/releaseReadiness stay untouched); the four-question checklist
  renders as advisory lines in review output; red tests first in tests/unit/planning.test.js
  (flagged-when-unmentioned, silent-when-mentioned, conservative-when-ambiguous, checklist
  rendered).
- [ ] Slice 4: docs wiring + verification battery — CLI_REFERENCE notes for the handoff
  section and review checklist if apt; full npm test; amber review/gate on this plan; live
  dogfood: run handoff against this repo's own dirty tree during the slice.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F026-Finish-time-dirty-path-classification-and-scope-discipline-review-checks.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Classification is deterministic and read-only: `classifyDirtyPaths` routes `.amber/`,
  legacy `.harness/`, and `*.amber-backup` paths to `managed`; paths equal to or under a
  booked feature path to `focusWork`; everything else to `outsideScope`; it performs no git
  writes and asks nothing.
- `getRepoSnapshot` exposes `dirtyPaths` (parsed porcelain including rename/quoted-path
  handling) that is `[]` on a clean tree and `null` on non-git dirs / git failures; existing
  `dirty`/`dirtyUntrackedOnly` consumers behave exactly as before.
- `amber handoff` renders the "Dirty worktree" section only when a non-managed bucket is
  non-empty: focusWork paths + the bail-back line (commit before finishing), outsideScope
  paths + one FYI line (reported once, left alone), managed churn as a count; clean trees
  and managed-only trees render no section, and validateHandoff stays green on both.
- `amber review` flags a booked path missing from the plan's declared Scope as an advisory on
  the non-blocking warnings channel (with a structured scopeDiscipline block) — it never
  enters the findings array, never blocks the gate, and stays silent when the path is
  mentioned or the Scope prose is ambiguous.
- The four-question scope-discipline checklist renders in review output as advisory lines
  (uninvited tidying outside the task; abstraction added beyond what the change needs; files
  the acceptance criteria never named; a workaround patched into the caller instead of the
  cause).
- No git mutations, no interactivity, no new lifecycle step, no new top-level command, and
  no changes to complete-check gating or the evidence-required acceptance gate; the
  breadcrumb parity walk stays untouched. Existing Amber guardrails still pass.
- `npm test` green (0 failed); feature_list.json survives
  `node scripts/validate-feature-list.js --target .` clean (Errors: 0) and stays
  Prettier-clean.

## Verification

- node --test tests/unit/dirty-paths.test.js
- node --test tests/unit/planning.test.js (scope-discipline cases)
- node --test tests/unit/git-state.test.js
- node --test tests/unit/dirty-paths.test.js (includes the handoff section-rendering cases)
- amber handoff --target <tmp-with-dirty-tree> renders the three-bucket classification read-only
- amber review --target <tmp> --plan <p> flags a booked path missing from the plan scope
- node scripts/amber.js review --target . --plan docs/plans/F026-Finish-time-dirty-path-classification-and-scope-discipline-review-checks.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F026-Finish-time-dirty-path-classification-and-scope-discipline-review-checks.md

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/dirty-paths.test.js
- Result: required — three-bucket classification (managed incl. `.amber/`, `.harness/`,
  `*.amber-backup`; focusWork with prefix matching; outsideScope), empty/clean tree → no
  section data, non-git target → empty buckets
- Date: record at verification
- Notes: new suite for the scripts/lib/core/dirty-paths.js pure functions plus the
  getRepoSnapshot dirtyPaths extension cases (degrade contract, rename/quoted paths)

- Command: node --test tests/unit/planning.test.js
- Result: required — scope-discipline cases: flagged when a booked path is unmentioned,
  silent when mentioned (exact or directory prefix), conservative when Scope prose is
  ambiguous; advisories ride warnings/scopeDiscipline, never the blocking findings array;
  checklist lines render in review output
- Date: record at verification
- Notes: buildReviewResult is the pure core — the diff runs on injected booked paths + scope
  body, no disk hits inside the pure function

- Command: amber handoff --target <tmp-with-dirty-tree>
- Result: required — end-to-end on a temp git repo with a dirty tree: the conditional Dirty
  worktree section renders the three buckets (managed as a count, focusWork with bail-back
  line, outsideScope with one FYI line); clean tree renders no section; handoff stays
  read-only (no git mutations)
- Date: record at verification
- Notes: focus feature's booked paths come from feature_list.json via ctx.focus — a feature
  without booked paths leaves focusWork empty (conservative)

- Command: npm test
- Result: required — full repository suite green (0 failed)
- Date: record at verification
- Notes: final gate before review/gate; parity walk untouched (no lifecycle step)
