# Plan: Fix dogfood friction batch

Feature: F024
Status: accepted
User Confirmation: confirmed

## Goal

Evidence reflux stamps the local calendar day (not UTC); resolvePendingGate no longer reports a next gate when zero gates are pending; a new `amber feature paths` subcommand books feature paths at completion (append-only, deduped), unblocking the F023 learnings trigger detection without hand-edited JSON

## High Level Design

- Context:
  - Three frictions logged during the F022/F023 dogfood runs, all in the just-shipped path:
  - #121 — the F023 learnings checkpoint detects triggers from `feature.paths`, but nothing
    books paths at completion except hand-editing feature_list.json (the dogfood needed a
    one-off node script).
  - #118 — `recordFeatureEvidence` stamps `new Date().toISOString().slice(0,10)` (UTC day), so
    evidence recorded in a UTC+8 evening lands on yesterday's date.
  - #119 — `resolvePendingGate` falls back to `gates[0].id` when zero gates are pending, so
    advice surfaces ("Pending gates: 0 (next: X)", approve remedies) can advertise an
    already-approved gate.
- Proposed approach:
  1. #121: new `recordFeaturePaths(target, options)` in scripts/lib/feature-commands.js
     following recordFeatureEvidence's conventions (require --feature/--id, accept one or more
     --path values plus comma-splitting like the learnings --surface precedent, append with
     dedupe, save via saveFeatures so output stays Prettier-clean); wire as `amber feature
     paths` in runFeatureAction + command help/usage + registry examples; read-only inspection
     when --path is omitted (list current paths).
  2. #118: extract a shared `localIsoDate()` helper (local calendar day as YYYY-MM-DD) into
     scripts/lib/core/text-utils.js; use it in recordFeatureEvidence AND in
     learning-writeback.js's booking date (which already computes local date privately —
     consolidate); do not rewrite historical evidence entries.
  3. #119: in scripts/lib/core/lifecycle.js resolvePendingGate, drop the `gates[0]` fallback
     so pendingGateId is null when nothing is pending; sweep the two consumers (lifecycle's
     own approve-step remedy already renders a `<gate-id>` placeholder when null — verify;
     hooks-command.js breadcrumb renderer's pendingCount>0 suppression becomes redundant —
     restore the simpler unconditional `(next: <id|none>)` line and update its comment); update
     the parity-walk comment that documented the old behavior if it asserts the "0 (next: X)"
     shape.
  - Non-goals: no #120 (error-stream policy) here — it is a broader printer-policy change kept
    for its own slice; no changes to evidence reflux semantics beyond the date; no new
    lifecycle step.
- Risks:
  - #119 changes a value other code may assume non-null (grep-verified consumers: lifecycle
    internal + hooks-command renderer + tests).
  - #121 writes feature_list.json so it inherits the Prettier-format contract
    (writeJsonPrettier) with a real-prettier spawn test.
- Scope:
  - Touches `scripts/lib/feature-commands.js` (recordFeaturePaths + FEATURE_ACTIONS/
    runFeatureAction wiring + localIsoDate in recordFeatureEvidence),
    `scripts/lib/core/text-utils.js` (shared localIsoDate helper),
    `scripts/lib/core/learning-writeback.js` (consolidate its private localDate onto the
    shared helper), `scripts/lib/core/lifecycle.js` (resolvePendingGate null-when-none),
    `scripts/lib/hooks-command.js` (breadcrumb gate line simplification + comment update),
    `scripts/lib/command-registry.js` (feature command help/usage + paths examples),
    `tests/unit/feature-commands.test.js` (new paths/local-date tests),
    `tests/unit/workflow-state-breadcrumb-parity.test.js` (comment + line-shape updates),
    plus docs wiring (CLI_REFERENCE, README, CLAUDE.md if apt).
  - Non-goals: no #120 (error-stream policy), no changes to evidence reflux semantics beyond
    the date, no new lifecycle step, and no rewriting of historical evidence entries.

## Vertical Slices

- [ ] Slice 1: `amber feature paths` (book + inspect) — `recordFeaturePaths(target, options)`
  following recordFeatureEvidence's conventions (--feature/--id required, one or more --path
  values plus comma-splitting, append with dedupe, save via saveFeatures so output stays
  Prettier-clean); FEATURE_ACTIONS/runFeatureAction wiring, command help/usage + registry
  examples; read-only inspection when --path is omitted (list current paths). Red tests first
  in tests/unit/feature-commands.test.js (append/dedupe/inspect/validator-clean/
  prettier-clean/spawn guard).
- [ ] Slice 2: local-date stamping — shared `localIsoDate()` (local calendar day as
  YYYY-MM-DD) in scripts/lib/core/text-utils.js; recordFeatureEvidence uses it;
  learning-writeback.js's booking date consolidates onto it; historical evidence entries are
  not rewritten. Tests inject or regex a local-day match and assert it is not the UTC slice.
- [ ] Slice 3: resolvePendingGate null-when-none + consumers — drop the `gates[0]` fallback in
  scripts/lib/core/lifecycle.js; verify the approve-step remedy's `<gate-id>` placeholder
  already handles null; restore the simpler unconditional `(next: <id|none>)` breadcrumb line
  in hooks-command.js and update its comment; update the parity-walk comment that documented
  the old gates[0]-as-next behavior.
- [ ] Slice 4: docs wiring + verification battery — CLI_REFERENCE/README/CLAUDE.md if apt;
  full npm test; amber review/gate on this plan; live dogfood books F024's own paths with the
  new command.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F024-Fix-dogfood-friction-batch.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `amber feature paths --target <t> --feature <id> --path <p> [--path <p2>,...]` books paths
  append-only with dedupe onto the feature entry; the write survives
  `node scripts/validate-feature-list.js --target .` clean (Errors: 0) and stays
  Prettier-clean; with --path omitted it is a read-only inspection listing current paths.
- Evidence reflux stamps the local calendar day: `recordFeatureEvidence` (and the learning
  booking date, via the shared localIsoDate helper in scripts/lib/core/text-utils.js) records
  the local YYYY-MM-DD, not the UTC slice, so evidence recorded in a UTC+8 evening lands on
  the local day; historical evidence entries are untouched.
- `resolvePendingGate` reports pendingGateId null when zero gates are pending; `amber next`
  renders no pending-gate hint when all route gates are approved; the breadcrumb renders the
  unconditional `Pending gates: <n> (next: <id|none>)` line shape.
- The three frictions (#118/#119/#121) are verified fixed live with the exact commands from
  the issues.
- No behavior regression in gate advice for sessions with pending gates: the first pending
  gate is still named, and approve remedies are unchanged for the pending case.
- `npm test` green (0 failed); existing Amber guardrails still pass.

## Verification

- node --test tests/unit/feature-commands.test.js
- node --test tests/unit/workflow-state-breadcrumb-parity.test.js
- amber feature paths --target <tmp> --feature <id> --path <p> books paths that survive validate-feature-list and stay Prettier-clean
- amber next --feature <id> renders no pending-gate hint when all route gates are approved
- node scripts/amber.js review --target . --plan docs/plans/F024-Fix-dogfood-friction-batch.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F024-Fix-dogfood-friction-batch.md

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/feature-commands.test.js
- Result: required — paths booking tests pass (append/dedupe/inspect/validator-clean/
  prettier-clean/spawn guard) and local-date stamping passes (inject or regex a local-day
  match, assert not the UTC slice)
- Date: record at verification
- Notes: covers recordFeaturePaths and the shared localIsoDate consolidation across
  recordFeatureEvidence and learning-writeback booking

- Command: node --test tests/unit/workflow-state-breadcrumb-parity.test.js
- Result: required — parity walk green with resolvePendingGate null-when-none, breadcrumb line
  shape (unconditional `(next: <id|none>)`), and the approve-remedy `<gate-id>` placeholder
  covered; the step-8 comment no longer documents the gates[0] fallback
- Date: record at verification
- Notes: updating the walk's comment in the same change as the resolver keeps this guard
  honest

- Command: amber feature paths --target . --feature F024 --path <p>
- Result: required — live dogfood books F024's own paths with the new command; booked paths
  survive validate-feature-list (Errors: 0) and stay Prettier-clean
- Date: record at verification
- Notes: unblocks the F023 learnings trigger detection without hand-edited JSON

- Command: amber next --feature <id> (all route gates approved)
- Result: required — no pending-gate hint when zero gates are pending; no advertisement of an
  already-approved gate
- Date: record at verification
- Notes: verify alongside a pending-gate session to confirm no advice regression

- Command: npm test
- Result: required — full repository suite green (0 failed)
- Date: record at verification
- Notes: final gate before review/gate
