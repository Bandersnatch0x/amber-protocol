# Plan: Completed session guidance

Feature: F093
Status: locally-verified
User Confirmation: confirmed
delivery: pending-publish

## Goal

Completed sessions show an explicit completion message without a repeated completion command; the next-action projection preserves the strict check result.

## High Level Design

- Context: F092 real-repository trial reproduced completed Session guidance recommending completion again.
- Proposed approach: project a separate sessionCompleted flag through the existing read-only next-actions fold and display completed guidance only when the strict check passes.
- Risks: preserve evidence failures; do not infer lifecycle from completion-check pass.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/F093-completed-session-guidance.md, docs/adr/0007-web-viewer-role.md
- review: docs/specs/F093-completed-session-guidance.md, docs/adr/0007-web-viewer-role.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [x] Slice 1: make next-actions distinguish completed Sessions without promoting evidence.
  - paths: scripts/lib/web-adapter.js, tests/unit/web-adapter-folds.test.js
  - depends-on: none
  - verify: node --test tests/unit/web-adapter-folds.test.js
- [x] Slice 2: declare the additive lifecycle projection.
  - paths: scripts/lib/web-adapter.d.ts
  - depends-on: 1
  - verify: npm --prefix apps/web run typecheck
- [x] Slice 3: show explicit completed guidance in both languages.
  - paths: apps/web/src/components/session/SessionCompletionWorkbench.tsx, apps/web/src/components/session/SessionCompletionWorkbench.test.ts, apps/web/src/components/session/SessionCompletionWorkbench.render.test.tsx, apps/web/src/lib/i18n.tsx
  - depends-on: 1, 2
  - verify: npm --prefix apps/web test -- src/components/session/SessionCompletionWorkbench.test.ts src/components/session/SessionCompletionWorkbench.render.test.tsx

## Resume Checkpoint

- Resume Point: implementation and reverse-test proof complete; full root suite passed (4302 pass, 27 skipped, 0 failed); final full Web suite passed (840/840), adapter 17/17 and knowledge follow-up 84/84 passed. Typecheck, lint, build, manifests, doctor, generated-skills and wiki checks passed. Real F092 browser checks passed in both languages; all eight original Session files are unchanged.
- Blockers: no implementation or review blocker. Publishing and human acceptance remain pending.
- Next Action: local technical Session d9fcc58e-c38e-44c8-aea9-cedfb0e4c16d is completed; use the refreshed handoff for a separately authorized publishing step. Keep delivery pending-publish and human acceptance pending.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- F093 Contract 1–5 hold with tests and real-page evidence.
- Guardrails: queries remain read-only; no CLI, ledger, approval, acceptance, scheduling, or stage changes.
- Delivery remains pending-publish until the implementation is merged to the default branch.

## Review follow-up

- Booked documentation follow-up: docs/architecture/web-viewer.md describes the completed/unfinished distinction and the existing HandoffCard fallback.
- Spec review requested explicit completed/fail read-only assertions and a component test with a residual closing command. Both are covered without changing production behavior.
- Booked generated follow-up: docs/knowledge-corpus/knowledge-context-manifest.json and docs/knowledge-corpus/knowledge-base.output.json were regenerated through `amber knowledge context-sync` after the architecture update.

## Log

- 2026-11-28: initial full root run failed only the new-document placement guard (4301 pass, 1 fail, 27 skipped). Intent-to-add registration fixed placement; the full root recheck passed (4302 pass, 27 skipped, exit 0).
- 2026-11-28: independent Spec review identified two test-evidence gaps and stale architecture guidance. Added completed/fail file-byte assertions and a residual-command render test; deleting the suppression guard made the latter fail, restoring the original bytes made it pass. Added the retained unfinished closing-command assertion.
- 2026-11-28: the architecture correction initially made full Web checks report stale knowledge sources (18 failures); context-sync regenerated the two tracked corpus files, and the full Web recheck passed 840/840. Knowledge suites passed 84/84. Negative logs remain available locally.
- 2026-11-28: Contract 3 wording now explicitly scopes evidence/lifecycle separation to the next-action projection; existing CLI approval semantics are unchanged and remain outside F093.
- 2026-11-28: handoff live file, portable bundle validation and strict Session complete-check passed. Raw review, test and browser artifacts are local and unversioned under `.scratch/f093/`.
- 2026-11-28: independent Standards review found no hard violations; kept the existing read seam and additive boolean instead of adding an abstraction. Spec review plus independent follow-up closed the test/documentation findings; the final wording-only follow-up was synchronized across spec, plan, feature behavior and type documentation. Five separate contract checks judged 5/5 implemented; existing CLI approval semantics and read-only git probes are outside the next-action presentation change. Reports: `.scratch/f093/review-standards.md`, `.scratch/f093/review-spec.md`, `.scratch/f093/spec-compliance/REPORT.md` (all unversioned).
- 2026-11-28: local Session completed after strict check passed. Its own next-actions query now returns pass, sessionCompleted=true and actions=[]; native final-source assertions confirm exactly 13 scoped changed files and unchanged pre-F093 feature entries. Automatic T1 memory nomination remains for separate human curation; no MEMORY.md change, feature acceptance, commit, push or merge was performed.

## Verification

- node --test tests/unit/web-adapter-folds.test.js
- npm --prefix apps/web test
- npm --prefix apps/web run typecheck
- npm --prefix apps/web run lint
- npm --prefix apps/web run build
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node scripts/validate-wiki.js --target .

## Evidence Schema

- Command: full root and Web tests; targeted adapter, component and knowledge tests; typecheck, lint, build; manifests, doctor, generated-skills and wiki checks.
- Result: passed. Reverting the backend and frontend fixes reproduced regression failures; the original implementation bytes were restored.
- Date: 2026-11-28.
- Notes: detailed logs, negative full-run evidence and browser report are local, unversioned artifacts under `.scratch/f093/`. No human acceptance or default-branch delivery is claimed. The local Session recorded a policy refusal for the targeted node command, then a genuine executed `npm run doctor` receipt; verification policy was not broadened.
