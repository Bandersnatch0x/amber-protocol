# Refactor Plan — Split harness-core.js Into Domain Modules

**Created:** 2026-06-11
**Status:** ✅ Completed 2026-06-11 on branch `refactor/split-harness-core`
**Type:** Pure-move refactor (no behavior change)
**Outcome:** 6,360 → 289-line facade + 21 modules under `scripts/lib/core/` (largest 734 lines). Final verification: 180/180 moved blocks byte-identical to baseline `0a4f79a` (single reviewed diff: REPO_ROOT path depth in constants.js). 435 tests green after every commit; structural guard added in `tests/harness-core-structure.test.js` (no duplicate definitions, no facade requires from core/, 800-line ceiling, facade stays logic-free).

**Execution notes (deviations from the plan below):**
- A first attempt extracted modules by COPY instead of MOVE, leaving duplicate drifting definitions and reverse `require("../harness-core")` calls in core modules. It was rolled back (`backup/split-attempt-1` preserves it) and redone as a true move.
- Extraction was automated with a one-off script (function-block cut + dependency-scan + topological-order guard) instead of manual edits; the script caught one real ordering violation (`scaffoldWiki → validateWiki`) and was itself fixed twice (paren-counting in regex literals; multi-line signatures with `options = {}` parameters).
- `isLocalMarkdownLink` no longer existed at baseline (deleted with the dead `extractMarkdownLinks` in commit 2), so text-utils shipped 12 symbols instead of 13.
- `REQUIRED_HARNESS_FILES` turned out to be an alias of `MINIMUM_HARNESS_FILES`, defusing the suspected audit behavior change from attempt 1.

## Problem Statement

`scripts/lib/harness-core.js` is 6,382 lines and 168 functions in a single file. It violates the project's own coding standard (files under 800 lines), and the size has already produced a real defect: `extractMarkdownLinks` is declared twice (line 2022, an adoption-specific variant that filters to local links; line 4255, a wiki-generic variant). Function hoisting means the second declaration silently wins everywhere, so the adoption variant is dead code and `validateAdoptionReports` runs a different link extractor than its source suggests.

Both maintainability reviews (Round 1 and Round 2) flagged the file. Navigation, review, and safe modification of any single domain (adoption, team, planning, …) currently require loading a file that holds all ten domains.

## Solution

Split `harness-core.js` into ~21 single-domain modules under a new `scripts/lib/core/` directory, mirroring the V1–V5.5 phase boundaries the code already follows internally. `harness-core.js` remains permanently as a pure re-export facade, so all 14 dependents (8 scripts, 6 test files) keep their existing `require("./lib/harness-core")` destructuring unchanged.

Every function body moves byte-for-byte. The exported symbol set does not change. All 557 existing tests pass unchanged after every commit.

## Target Module Layout

```
scripts/lib/
├── core/                      ← new (V1–V5.5 mainline)
│   ├── constants.js           (~80 ln)  REPO_ROOT, TEMPLATE_ROOT, MINIMUM_HARNESS_FILES, …
│   ├── fs-utils.js            (~110 ln) resolveTarget, readJson, walkFiles, walkProjectFiles, …
│   ├── text-utils.js          (~160 ln) slugify, formatList, timestampForFileName,
│   │                                    extractMarkdownLinks (single surviving variant),
│   │                                    isLocalMarkdownLink, getSectionBody, …
│   ├── scaffold.js            (~70 ln)  listTemplateFiles, copyTemplateFiles, scaffoldHarness, scaffoldWiki
│   ├── validators.js          (~270 ln) validateFeatureListData/File, validateContinuousImprovementStateFile, validateWiki
│   ├── audit.js               (~360 ln) auditProject + detection helpers + validateHandoff
│   ├── manifests.js           (~180 ln) validateManifests + manifest helpers + classifyTarget
│   ├── planning.js            (~310 ln) scaffoldPlan, validatePlanGate, reviewPlan, acceptPlan (V2/V2.5)
│   ├── task-execution.js      (~205 ln) prepareTaskExecution, inspectTaskResult (V4)
│   ├── agent-orchestration.js (~220 ln) dispatchAgentTask, setAgentDispatchStatus, recordAgentReview (V4.5)
│   ├── team.js                (~480 ln) registry load/validate, install/pin/update/rollback (V5)
│   ├── maintenance.js         (~350 ln) inspectMaintenance, proposeMaintenance + drift/stale helpers (V5.5)
│   ├── adoption-reports.js    (~700 ln) generateAdoptionReport, list/index/validate/compare
│   ├── adoption-gate.js       (~310 ln) gateAdoptionReport, statusAdoptionReports
│   ├── adoption-bundle.js     (~510 ln) bundleAdoptionArtifacts, writeAdoptionNextActions
│   ├── adoption-proposals.js  (~650 ln) decision-record, apply-plan, selected-files writers
│   ├── workflow-packs.js      (~490 ln) pack validate/inspect/readiness + loop-contract validation (V3)
│   ├── loops.js               (~135 ln) loop inspect/dry-run/record/ledger commands
│   ├── profiles.js            (~85 ln)  validateProjectProfileData, inspectProjectProfile
│   ├── doctor.js              (~125 ln) doctor, doctorProductRepo, hasPluginManifestDirectory
│   └── cli-output.js          (~610 ln) parseArgs, printResult, printAuditSummary
└── harness-core.js            (~60 ln)  pure re-export facade — public entry point, kept forever
```

Dependency rule: `core/*` modules may require `constants`, `fs-utils`, `text-utils`, and already-extracted sibling domain modules. A `core/*` module must NEVER require the `harness-core.js` facade (CommonJS circular-require would observe a partially-built exports object).

## Commits

Each commit leaves the repository green: `npm test` (full suite), `npm run manifests`, `npm run doctor`, and `node scripts/harness.js --help` all pass. Each module-extraction commit is mechanical: cut the listed functions out of `harness-core.js`, paste them unchanged into the new file, add the new file's `require`s, re-export through the facade, run the verification commands.

1. **Add export-surface safety net test.** New file `tests/harness-core-exports.test.js` asserting that `require("scripts/lib/harness-core")` exposes exactly the current 61 symbols (55 functions + 6 constants), each with its current `typeof`. This is the only new test; it guards the entire refactor and stays afterward.
2. **Delete the dead `extractMarkdownLinks` (line 2022).** Hoisting already makes the line-4255 variant win at runtime, so deletion is provably behavior-neutral. From here on every commit is a pure move. (Record the "was the adoption-filtering intent correct?" question in BACKLOG.md as a separate investigation item — see Out of Scope.)
3. **Confirm the move order with a call map.** Mechanical pass: for each planned module, grep its function names against the other regions to list cross-domain calls. Adjust the order of commits 4–24 so that callees always move before callers (no code change; update this plan file in the same commit if the order shifts).
4. **Extract `core/constants.js`.** Move the 14 top-level constants. Facade requires it and re-exports the 6 public ones. (All later modules require constants directly.)
5. **Extract `core/fs-utils.js`.** Pure fs/path helpers; depends only on node builtins + constants.
6. **Extract `core/text-utils.js`.** Pure string/markdown helpers including the single surviving `extractMarkdownLinks`. No fs access.
7. **Extract `core/scaffold.js`.**
8. **Extract `core/validators.js`.** (`validateWiki` is needed by audit/adoption/doctor later, so it moves early.)
9. **Extract `core/audit.js`.** (`auditProject`, handoff validation.)
10. **Extract `core/manifests.js`.** (incl. `classifyTarget`.)
11. **Extract `core/planning.js`.**
12. **Extract `core/task-execution.js`.**
13. **Extract `core/agent-orchestration.js`.**
14. **Extract `core/team.js`.**
15. **Extract `core/maintenance.js`.**
16. **Extract `core/workflow-packs.js`.**
17. **Extract `core/loops.js`.**
18. **Extract `core/profiles.js`.**
19. **Extract `core/adoption-reports.js`.** (May call audit/scaffold/validators/doctor — all already extracted; if `generateAdoptionReport` calls `doctor`, swap this commit after commit 20.)
20. **Extract `core/doctor.js`.**
21. **Extract `core/adoption-gate.js`.**
22. **Extract `core/adoption-bundle.js`.**
23. **Extract `core/adoption-proposals.js`.**
24. **Extract `core/cli-output.js`; reduce facade to pure re-exports.** After this commit `harness-core.js` contains only `require`/`module.exports` wiring (~60 lines). Update README architecture diagram and BACKLOG.md in the same commit.

If any extraction reveals a hidden cross-dependency that would force a `core/* → facade` require, stop, move the shared helper down into `fs-utils`/`text-utils` in its own micro-commit, then resume.

## Decision Document

- **Facade is permanent.** `harness-core.js` stays as the single public entry point. Dependents are never migrated to deep imports. Rationale: 14 call sites stay untouched, the V1–V5.5 mainline is a stable completed track, and the export-surface test pins the contract.
- **Module boundaries follow the phase structure** (V1 bootstrap, V2 planning, V2.5 review, V3 packs, V4 execution, V4.5 orchestration, V5 team, V5.5 maintenance, plus adoption and shared utils). The code's internal region ordering already matches these boundaries; the split makes them physical.
- **Duplicate `extractMarkdownLinks` resolves to current runtime behavior** (the wiki-generic variant). The adoption-filtering variant is deleted as dead code. Whether `validateAdoptionReports` *should* filter to local links is recorded as a separate investigation, not decided here.
- **Layering rule:** constants/fs-utils/text-utils at the bottom; domain modules above; domain→domain requires allowed only toward already-extracted modules; facade requires everything; nothing requires the facade.
- **Callee-before-caller move order**, verified by an explicit call-map pass (commit 3) before any domain module moves.
- **New directory `scripts/lib/core/`** keeps the V1–V5.5 mainline physically separate from the 27 flat Phase B modules already in `scripts/lib/`.

## Testing Decisions

- **No existing test changes.** The 557-test suite covers the refactor surface from three angles: direct function-level tests (`tests/phase-v*.test.js`, `tests/validate-*.test.js`, `tests/scaffold-harness.test.js` require `harness-core` exports), CLI process-level tests (`tests/harness-cli.test.js` spawns `scripts/harness.js`), and standalone wrapper spawn tests. Because all of them exercise the facade or the CLI — never internal file layout — they are exactly the right kind of behavioral tests for a pure move.
- **One new test** (commit 1): the export-surface snapshot. It tests external contract (which symbols exist and their types), not implementation details, in the same `node:test` style as `tests/validate-manifests.test.js`.
- **Per-commit verification:** `npm test` && `npm run manifests` && `npm run doctor` && `node scripts/harness.js --help`. The known-flaky `tests/load/timeline-throughput.test.js` failure is pre-existing and unrelated (Phase B file); if it fires, rerun in isolation to confirm, do not "fix" it inside this refactor.
- **Smoke check per extraction:** `node -e "require('./scripts/lib/core/<new-module>')"` to catch circular-require problems immediately.

## Out of Scope

- The `date-utils` / `readManifest` / `findRoute` / shared `run()` extractions suggested by maintainability review Round 2 (they touch Phase B files; separate follow-up).
- Splitting `session-commands.js` or any Phase B module.
- Any function signature, behavior, error-message, or output change.
- Deciding whether `validateAdoptionReports` should use a local-link-filtering extractor (investigation item recorded in BACKLOG.md by commit 2).
- Migrating callers to deep imports; deleting the facade.
- The duplicated copies under `tests/fixtures/non-git/.harness/worktrees/test-session-123/` — that is leftover test pollution tracked separately; do not touch it here, and exclude it from greps.

## Further Notes

- Function counts and line estimates derive from the 2026-06-11 audit of `harness-core.js` (6,382 lines, 168 function declarations, single `module.exports` block at line 6324). Sizes are estimates; the 800-line ceiling is the hard constraint, and the largest planned module (`adoption-reports.js`, ~700 lines) stays under it.
- No git remote is configured for this repository, so this plan lives here instead of a GitHub issue. If a remote is added later, this document can be filed verbatim as the issue body.
- Suggested branch name: `refactor/split-harness-core`. Work on a branch off `master`; merge only after all 24 commits are green.
