# Plan: Governance evidence reads resolve state dir (legacy .harness support)

Feature: F009
Status: accepted
User Confirmation: confirmed

## Goal

amber governance audit / evidence read session + execution evidence through the state-dir resolver, so legacy .harness state is visible alongside .amber instead of being silently missed.

## High Level Design

- Context: `scripts/lib/core/governance.js` hardcodes `.amber/` at 5 sites (L26 governanceDocs, L120 exportSessionEvidence, L181 exportExecutionEvidence, L325-326 generateAuditReport). The rest of the codebase resolves the state dir via `state-dir-resolver.resolveStateDirForRead` (which falls back to legacy `.harness/`); `governance-readiness.inspectAuditEvidence` already does so correctly. So on a legacy `.harness/` repo, `amber governance audit` / `governance evidence` miss evidence that `governance readiness` finds (#60).
- Proposed approach: route the 5 hardcoded `.amber` path joins in `governance.js` through `resolveStateDirForRead` (read paths) / `resolveStateDirForCreate` (write path for governanceDocs), mirroring the `getSessionsDir` pattern in `session-commands.js`. Add a regression test: a `.harness/sessions/<id>/timeline.jsonl` fixture is found by `generateAuditReport` and `exportSessionEvidence`. Defer the secondary timeline-counting unification (readSessionEvents vs regex) to a follow-up - it is noted in #60 but out of scope for this slice.
- Risks: (1) `governanceDocs` writes governance docs - it must use `resolveStateDirForCreate` (new entities always under `.amber`), NOT the read resolver, or legacy repos would write governance docs under `.harness`. (2) Behavior change for legacy repos is the intended fix, but existing tests may assert `.amber` paths - update them.

## Vertical Slices

- [ ] Slice 1: route the 5 hardcoded `.amber` path joins in `governance.js` through the state-dir resolver (read resolver for audit/evidence reads; create resolver for governanceDocs write).
- [ ] Slice 2: add a regression test - legacy `.harness/sessions/<id>/timeline.jsonl` fixture is found by `generateAuditReport` and `exportSessionEvidence`.
- [ ] Slice 3: run `npm test`; fix any tests that asserted the old hardcoded `.amber` path.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F009-Governance-evidence-reads-resolve-state-dir-legacy-harness-support.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- node scripts/amber.js governance audit --target <legacy .harness repo> finds sessions/executions
- npm test: governance + audit suites green

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
