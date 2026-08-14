# Plan: Remediate v1.5.1 review findings

Feature: F020
Status: accepted
User Confirmation: confirmed

## Goal

MCP submissions, repository reads, route queries, releases, and version metadata preserve their documented safety contracts

## High Level Design

- Context:
  - The v1.5.0...v1.5.1 two-axis review found four Standards violations and two Spec gaps.
  - The failures cross the MCP Action boundary, configured-repository reads, Route dispatch,
    release automation, and version metadata, so each invariant must have one owning module.
- Proposed approach:
  - Keep Action execution as an argv array and render only a shell-specific, quoted display command.
  - Project enforceable parameter constraints into MCP JSON Schema so invalid submissions fail at
    the protocol boundary before an approval request is created.
  - Return canonical paths for existing repository entries and require existing canonical paths for
    Function reads, closing the validated-path versus consumed-path gap.
  - Resolve Route definitions from the selected target repository for every target-bound Route read.
  - Keep stable-tag publication idempotent and synchronize the root, plugin, and dsh package versions
    from one version source; prepare the next SemVer-correct minor version without publishing it.
- Risks:
  - Tightening Action schemas intentionally rejects inputs that were previously accepted and failed
    later or produced invalid approval submissions.
  - Target-bound Route reads remove the implicit package-routes fallback; uninitialized repositories
    will report no target Routes instead of silently showing Amber's own repository Routes.
  - Historical tag v1.5.1 and its missing GitHub Release cannot be rewritten by a source change;
    external release creation remains outside this implementation unless separately authorized.

## Vertical Slices

- [x] Slice 1: add red tests for empty Action parameters and safely represented approval commands,
  then enforce those contracts at the MCP tools/call seam.
- [x] Slice 2: add a symlink-swap regression test, then make existing Function reads consume the
  canonical path that passed containment validation.
- [x] Slice 3: add CLI and MCP target-Route regressions, then route list/inspect/test through the
  selected repository's routes directory.
- [x] Slice 4: lock stable-tag publish idempotency with a workflow contract test and retain the
  already-landed npm existence guard.
- [x] Slice 5: bump the unreleased source line to 1.6.0 and make version synchronization cover the
  dsh package version and its amber-protocol dependency.
- [x] Slice 6: run targeted tests, full repository gates, diff review, and record executed evidence.

## Resume Checkpoint

- Resume Point: implementation, repository verification, dual-axis review, Amber review/gate, and
  portable handoff regeneration/validation are complete.
- Blockers: none.
- Next Action: none. F020 remediations are accepted and the handoff bundle is valid.
- Recovery Instructions: reopen this plan and `.amber/handoff/latest` if a later session needs the
  F020 evidence; regenerate the bundle only if the working tree or evidence changes.

## Acceptance Criteria

- Approval-required MCP outcomes expose an argv-preserving command contract; any display command is
  shell-quoted and no response tells a user to execute unescaped external input.
- Empty or whitespace-only required Action strings fail as JSON-RPC invalid arguments; variant-only
  required parameters are represented in the generated MCP input schema.
- Existing descendant reads return canonical in-repository paths and remain in-repository if the
  originally supplied symlink/junction is replaced after validation.
- `route list`, `route inspect`, and dry-run `route test` read Routes from the selected target; MCP
  `_target` overrides cannot return package-local Route definitions for another repository.
- Re-running a stable-tag workflow when the npm version exists skips publication without preventing
  GitHub Release creation.
- Root package, lockfile, plugin manifests, and dsh package/dependency versions synchronize to 1.6.0;
  the release is not tagged or published by this task.
- Phase boundary guardrails: this remediation does not add live agent dispatch, automatic
  target-repository command execution, or new mutation authority, and it does not create a tag,
  publish a package, or create a GitHub Release.
- `npm test`, manifests, doctor, generated-agent drift, wiki validation, lint, and format checks pass.

## Verification

- Targeted MCP, Route, target-path, version-sync, and release-workflow contract tests.
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node scripts/validate-wiki.js --target .
- npm run lint
- npm run format:check
- node scripts/amber.js review --target . --plan docs/plans/F020-Remediate-v1-5-1-review-findings.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F020-Remediate-v1-5-1-review-findings.md

## Evidence Schema

- Command: `node --test tests/unit/route-loader.test.js tests/unit/mcp-targets.test.js tests/unit/sync-version.test.js tests/unit/release-workflow.test.js tests/integration/action-type-schema.test.js tests/integration/route-commands.test.js tests/integration/amber-mcp.test.js tests/integration/dsh-bundle.test.js tests/next-objective.test.js tests/governance-readiness.test.js`
- Result: 156 passed, 0 failed, 0 skipped
- Date: 2026-08-14
- Notes: Covers MCP schemas and command contracts, canonical Function and Route reads, target-local
  Route consumers including `next` and governance readiness, release idempotency, dsh packaging,
  and version synchronization.
- Artifact or session id: F020 targeted verification
- Remaining risk: Junction/symlink tests skip only on platforms that cannot create the required link.

- Command: `node --test tests/unit/governance-readiness-collectors.test.js tests/integration/session-commands.test.js`
- Result: 14 passed, 0 failed, 0 skipped
- Date: 2026-08-14
- Notes: Closes the final Standards findings by covering canonical target-relative Route reporting
  through a directory link and confirming target-local Session Route fixtures.
- Artifact or session id: F020 final Route readiness regression
- Remaining risk: None observed on the Windows junction path exercised by this run.

- Command: `npm test`
- Result: 1781 total, 1777 passed, 4 skipped, 0 failed
- Date: 2026-08-14
- Notes: Final full repository suite after every target-Route consumer and canonical readiness path
  fix. The dsh pack contract uses npm's provided CLI path and completed without the former fallback
  timeout.
- Artifact or session id: F020 final full-suite run; governed verification Session
  `6b0aa503-6f0d-41cf-b7eb-90a8b4e5e370` remains strict-pass.
- Remaining risk: Four pre-existing tests remain skipped by suite policy.

- Command: `npm run manifests`; `npm run doctor`; `npm run gen:agents:check`; `node scripts/validate-wiki.js --target .`; `npm run lint`; `npm run format:check`; `git diff --check`
- Result: all exit 0; manifest/doctor/wiki errors 0; 15 generated agent files current; ESLint,
  Prettier, and diff whitespace checks clean
- Date: 2026-08-14
- Notes: Repository health, generated surfaces, documentation links, code style, and whitespace
  were checked after the final code and test changes.
- Artifact or session id: F020 repository quality gates
- Remaining risk: None observed.

- Command: `$code-review v1.5.0...v1.5.1` final Standards and Spec re-review against the current
  worktree
- Result: Standards 0 High, 0 Medium, 0 Low; Spec 0 High, 0 Medium, 0 Low
- Date: 2026-08-14
- Notes: Independent reviewers confirmed the canonical target path and Session fixture findings are
  closed, all F020 acceptance criteria are implemented, and no scope creep or smell finding remains.
- Artifact or session id: F020 final dual-axis review
- Remaining risk: None observed.

- Command: `node scripts/amber.js review --target . --plan docs/plans/F020-Remediate-v1-5-1-review-findings.md --json`; `node scripts/amber.js gate --target . --plan docs/plans/F020-Remediate-v1-5-1-review-findings.md`
- Result: review findings 0; releaseReadiness ready; gate errors 0
- Date: 2026-08-14
- Notes: Re-run after the absolute `--plan` containment fix; user confirmation, verification
  evidence, scope boundary, and plan acceptance checks passed.
- Artifact or session id: F020 Amber review/gate
- Remaining risk: None observed.

- Command: `node --test tests/phase-v2-5.test.js tests/next-objective.test.js`; `node scripts/amber.js handoff --target .`; `node scripts/amber.js handoff bundle --target .`; `node scripts/amber.js handoff validate --target .`
- Result: 11 passed, 0 failed; session-handoff.md written; bundle 7 files, readiness 99/100 ready;
  validate errors 0
- Date: 2026-08-14
- Notes: Confirmed gate/review/accept reject absolute plan paths, then regenerated and validated
  the portable continuation bundle.
- Artifact or session id: F020 final handoff
- Remaining risk: Working tree remains dirty with F020 remediations and unrelated `apps/web/**`
  concurrent edits; no commit, tag, or publish was created.
