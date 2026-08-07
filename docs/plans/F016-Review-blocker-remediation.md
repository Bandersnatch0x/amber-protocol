# Plan: Review blocker remediation

Feature: F016
Status: implementation-ready
User Confirmation: confirmed

## Goal

The Context, Loadout, governed execution, routing, migration, workflow assessment, and handoff surfaces introduced after origin/master fail closed at their public boundaries and pass the repository's complete verification gates.

## High Level Design

- Context: review of `origin/master...HEAD` found target escape paths, incomplete request binding, dropped confidence gates, a workflow facade cycle, unwired migrations, target-insensitive routing, cross-session no-progress signals, incomplete Loadout required artifacts, and five failing tests.
- Proposed approach: enforce the fail-closed invariant once at each public interface, keep required governance artifacts separate from Context Pages, and preserve existing public exports while moving layout logic behind a deeper module.
- Risks: lexical checks without real-path checks leave junction escapes; compatibility fallbacks would preserve the unsafe local contract; scaffold changes must keep the no-overwrite guarantee; broad test cleanup must not hide product defects.
- Historical input: `output/adr-architecture-assessment.md` predates `ef57fc5`. It informed investigation but remains unchanged and is excluded from F016 acceptance evidence; `output/adr-architecture-assessment-f016.md` records the reviewed baseline, HEAD, and patch fingerprint.
- Decision record: Q1-Q13 were confirmed as recommended on 2026-08-07 and are recorded in ADR-0015.

## Vertical Slices

- [x] Slice 1: reject lexical and real-path target escapes for Context sources, Pages, requests, payloads, Loadouts, and identifiers; surface corrupt Page errors.
- [x] Slice 2: require request binding before every ingest outcome, enforce request-owned scope, and emit the two explicit missing/mismatch error codes.
- [x] Slice 3: define Loadout `schemaVersion: 1.0.0` with `artifacts.required[]`; install and verify the canonical Operating Manual, Route manifests, and Loadout Definition; fail closed on absence, escape, or hash change.
- [x] Slice 4: preserve and enforce `confidence_gating` before governed command execution so only an execution-permitted tier can reach `spawnSync`.
- [x] Slice 5: extract `core/handoff-layout.js`, remove the workflow facade cycle, and retain existing `handoff-bundle` re-exports.
- [x] Slice 6: wire version backfill into migration, resolve `next --objective` from the target, scope no-progress to the current session, and repair schema-format, generated-skill, and facade boundary regressions.
- [x] Slice 7: update ADR/wiki/CLI/skill surfaces, regenerate platform products, pass every repository gate, perform the final two-axis review, and generate a working-tree-patch-bound architecture assessment.
- [x] Finalization: bind the assessment to implementation commit `c628c763fe76b1b24b3357e16ff9c05ac811fbae` without changing the reviewed product behavior.

## Resume Checkpoint

- Resume Point: Slices 1-7 and commit-SHA finalization are complete; 1613 full tests, all repository gates, and both final review axes pass with no unresolved finding.
- Blockers: none for F016 implementation, verification, or evidence binding.
- Next Action: no F016 action remains; release versioning, tagging, and publication are outside this plan and remain frozen pending a version decision.
- Recovery Instructions: reopen this plan and ADR-0015, inspect `git status`, and continue at the first unchecked vertical slice; preserve user-owned release-readiness, handoff, `.workbuddy`, and historical output changes.

## Acceptance Criteria

- All Context and Loadout file I/O is proven target-local by lexical and real-path tests, including symlink/junction cases.
- Context ingest refuses missing or mismatched requests and cannot self-authorize scope or bypass binding through no-change.
- Every generated Loadout has the three target-local Required Artifacts in `artifacts.required[]` and verifies them fail-closed without treating them as Context Pages.
- Governed execution never spawns a command when confidence policy requires review or refusal.
- Workflow assessment imports only its public facade without a circular dependency; public handoff exports remain compatible.
- Migration, target routing, no-progress, corrupt Page, Ajv format, generated skill, and facade regressions have focused tests.
- `npm test`, manifests, doctor, generated-agent drift, and wiki validation all exit 0.
- The final review has no unresolved findings, and the new architecture assessment names the exact baseline SHA, review HEAD SHA, reviewed patch fingerprint, and implementation commit SHA.
- The commit-SHA binding identifies the implementation commit without requiring the evidence report to self-reference its own containing commit.
- F016 does not modify `docs/quality/release-readiness-1.3.12.md`, `.workbuddy/*`, or the historical assessment as part of acceptance.

## Verification

- node --test tests/unit/context-*.test.js tests/governance-confidence.test.js tests/next-objective.test.js tests/no-progress-detector.test.js tests/schema-versioning.test.js
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node scripts/validate-wiki.js --target .
- npm run lint
- git diff --check origin/master

## Evidence Schema

- Command: `npm test`
- Result: 1613 total, 1609 passed, 4 skipped, 0 failed.
- Date: 2026-08-07
- Notes: Final exact-patch run. Manifests, doctor, generated-agent drift, wiki, ESLint, and `git diff --check origin/master` also exited 0. Final Specification and Standards reviews reported blocker 0, high 0, P2 0, and P3 0.
