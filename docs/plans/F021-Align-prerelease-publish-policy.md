# Plan: Align prerelease publish policy with the lockstep release contract

Feature: F021
Status: accepted
User Confirmation: confirmed

## Goal

Pre-release tags skip GitHub Packages publish the same way they skip npmjs, and release docs name the secrets the workflows actually use

## High Level Design

- Context:
  - F020 landed lockstep npmjs publish for `amber-protocol` and `dsh-amber-protocol`.
  - CONTRIBUTING already says `-rc`/`-beta` tags do not trigger GitHub Packages publish, but
    `publish-github-packages.yml` still matches every `v*` tag.
  - The same page still claims `NPM_TOKEN` is unused for normal releases, while `ci.yml` now
    needs it for the authoritative npmjs job.
  - Governance report is otherwise ready; its only stale-doc finding is
    `docs/wiki/amber-ontology-mcp.md` missing a Last Reviewed marker.
- Proposed approach:
  - Add a job-level skip for `-rc`/`-beta` tags on the GitHub Packages workflow, while keeping
    `workflow_dispatch` for manual testing.
  - Lock that contract with a workflow test next to the existing `ci.yml` release checks.
  - Correct the secrets and prerelease documentation so they describe the executable YAML.
  - Add the missing Last Reviewed marker; do not rewrite the ontology page.
- Risks:
  - A future operator who expected prerelease GitHub Packages artifacts will need to use
    `workflow_dispatch` or a stable tag.
  - This slice does not create a tag, publish a package, or create a GitHub Release.

## Vertical Slices

- [x] Slice 1: add a red workflow contract test for GitHub Packages prerelease exclusion.
- [x] Slice 2: skip `-rc`/`-beta` tags in `publish-github-packages.yml` and keep manual dispatch.
- [x] Slice 3: align CONTRIBUTING secrets/prerelease text and add the wiki Last Reviewed marker.

## Resume Checkpoint

- Resume Point: implementation, targeted tests, Amber review/gate, and acceptance are complete.
- Blockers: none.
- Next Action: none. F021 is accepted; no tag or publish was created.
- Recovery Instructions: reopen this plan and `.amber/handoff/latest` if a later session needs the
  F021 evidence; do not create a tag or publish.

## Acceptance Criteria

- A `vX.Y.Z-rc*` or `vX.Y.Z-beta*` tag push does not run the GitHub Packages publish job.
- `workflow_dispatch` can still run that job.
- CONTRIBUTING names `NPM_TOKEN` for the npmjs lockstep job and `GITHUB_TOKEN` for the mirror.
- `docs/wiki/amber-ontology-mcp.md` has a Last Reviewed marker.
- Phase boundary guardrails: this slice does not add live agent dispatch, automatic
  target-repository command execution, or new mutation authority, and it does not create a tag,
  publish a package, or create a GitHub Release.

## Verification

- node --test tests/unit/release-workflow.test.js
- node scripts/amber.js review --target . --plan docs/plans/F021-Align-prerelease-publish-policy.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F021-Align-prerelease-publish-policy.md

## Evidence Schema

- Command: `node --test tests/unit/release-workflow.test.js`
- Result: 5 passed, 0 failed, 0 skipped
- Date: 2026-08-14
- Notes: Covers npmjs lockstep publish order plus GitHub Packages prerelease skip and
  workflow_dispatch.
- Artifact or session id: F021 workflow contract tests
- Remaining risk: No tag was pushed, so the new job `if` was not exercised by GitHub Actions.

- Command: `node scripts/amber.js review --target . --plan docs/plans/F021-Align-prerelease-publish-policy.md --json`; `node scripts/amber.js gate --target . --plan docs/plans/F021-Align-prerelease-publish-policy.md`
- Result: review findings 0; releaseReadiness ready; gate errors 0
- Date: 2026-08-14
- Notes: Confirmation, verification fields, and phase-boundary guardrails passed.
- Artifact or session id: F021 Amber review/gate
- Remaining risk: None observed.
