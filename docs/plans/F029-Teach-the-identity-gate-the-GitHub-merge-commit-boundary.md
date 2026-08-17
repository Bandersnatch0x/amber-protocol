# Plan: Teach the identity gate the GitHub merge-commit boundary

Feature: F029
Status: accepted
User Confirmation: confirmed

## Goal

GitHub-generated merge commits with the repository noreply author and GitHub committer pass CI while ordinary commits still require the exact repository identity

## High Level Design

- Context:
  - CI run `31985142607` failed in the `Commit identity` job because GitHub's
    merge commit `d8eeff0` uses the repository account's noreply email but the
    account display name `summersong`, while its committer is `GitHub`.
  - The current validator flattens author/committer strings and cannot see
    parent count or the trusted committer relationship, so it treats a
    platform-generated merge author like an ordinary local commit author.
- Proposed approach:
  1. Preserve the strict exact name+email rule for local pre-commit and ordinary
     CI commits.
  2. Carry parent and committer metadata through range/commit inspection.
  3. In CI modes, allow a non-canonical author name only when the commit is a
     merge (at least two parents), the author uses the repository's exact
     GitHub noreply email, and the committer is the exact GitHub automation
     identity. Keep the exception unavailable to current/pre-commit mode.
  4. Add regression tests for the real merge shape, near misses, and the existing
     human-only behavior; document the boundary in `CONTRIBUTING.md`.
- Risks:
  - A broad name allow-list would weaken the identity gate; the exception must
    be structural and pair-bound, not a second human identity.
  - Git metadata is convention-based and forgeable, so the exception remains
    limited to protected CI validation and does not claim cryptographic proof.
  - Existing callers/tests of `commitIdentities` must retain their public shape
    and deterministic injected-git seam.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/adr/0004-evidence-grade-verification.md
- review: docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/adr/0004-evidence-grade-verification.md

## Vertical Slices

- [x] Slice 1: add a failing regression test for the observed GitHub merge
  metadata and for near-miss identities that must remain rejected.
- [x] Slice 2: implement commit-context parsing and the narrowly scoped CI-only
  merge-author exception; update the contributor contract.
- [x] Slice 3: run the targeted suite, reproduce the original range locally, and
  run the repository guardrails before review.

## Resume Checkpoint

- Resume Point: F029 accepted; governed verification complete and learning
  review booked with owner `ci` on `CONTRIBUTING.md`. Recovery session
  `3825e4df-0115-43f8-a1e3-f903d5e9f6f5` passes strict completion.
- Blockers: none.
- Next Action: commit/push the accepted fix and confirm the new master CI run;
  the post-review public-shape remediation is verified locally.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Review Remediation (2026-08-17)

- Finding: the first implementation exposed an enumerable `commit` field from
  `commitIdentities()`, contrary to the public-shape compatibility constraint.
- Resolution: return parent and committer metadata as an explicit context map
  beside the identity records, keep `commitIdentities()` as the compatible
  public-shape wrapper, and remove the unused commit hash.
- Result: the public-shape and cloned-object regressions are red before their
  fixes and green after them; merge, one-parent, unrelated-committer, and
  local-mode boundaries remain covered.

## Acceptance Criteria

- The observed GitHub merge commit shape passes range/commit CI validation, while
  ordinary commits with a non-canonical name, a one-parent commit, or an
  unrelated committer remain rejected.
- Local `npm run identity:check` remains human-only and rejects platform/bot
  identities as before.
- The contributor guide describes both the exact human identity and the
  structural GitHub merge exception without implying a general name allow-list.
- Existing Amber guardrails still pass; no release, push, or history rewrite is
  part of this feature slice.
- Phase-boundary acknowledgment: this bugfix changes only the identity checker,
  its tests, and the contributor contract; it does not add execution authority,
  relax approval/isolation/ledger rules, or alter unrelated release behavior.

## Verification

- node --test tests/unit/validate-git-identity.test.js
- node scripts/validate-git-identity.js --range 03702dd6c18d6fbce051462734f46c2daab17aef..d8eeff041f67986fb2a33b8078abb447783c7507
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check

## Evidence Schema

- Command: `node scripts/validate-git-identity.js --range 03702dd6c18d6fbce051462734f46c2daab17aef..d8eeff041f67986fb2a33b8078abb447783c7507`
- Result: passed (exit 0); the previously failing master range now passes and
  the 15-case unit suite keeps one-parent, wrong-committer, and current-mode
  near misses rejected.
- Date: 2026-08-17
- Notes: CI run `31985142607`, job `95258724487` is the negative baseline; the
  existing merge commit was not rewritten. Artifact: `feature_list.json` F029.
  Remaining risk: GitHub-hosted CI has not rerun because the fix is not pushed.

- Command: `npm test`
- Result: 1959 passed, 4 skipped, 0 failed; governed execution also passed
  (exit 0, 102991ms).
- Date: 2026-08-17
- Notes: executed evidence is in session
  `3825e4df-0115-43f8-a1e3-f903d5e9f6f5`; its ledger verifies intact and strict
  complete-check passes. Earlier session
  `1a23b96f-a25a-4bef-b837-cd5f21e3969d` remains negative evidence for the
  attempted approval-before-verification order. Remaining risk: GitHub-hosted
  CI has not rerun because the fix is not pushed.

- Command: `npm run lint && npm run manifests && npm run doctor && npm run gen:agents:check`
- Result: all exit 0; manifest/doctor errors 0 and 15 generated agent files current.
- Date: 2026-08-17
- Notes: `git diff --check`, Prettier check, and feature-list validation also
  pass. Artifact: `feature_list.json` F029. Remaining risk: GitHub-hosted CI has
  not rerun because the fix is not pushed.

- Command: `node --test tests/unit/validate-git-identity.test.js`
- Result: 15 passed, 0 failed (including public-shape and explicit-context regressions).
- Date: 2026-08-17
- Notes: both regressions were confirmed red before their fixes and green after
  explicit context replaced object-identity state. Artifact: `feature_list.json`
  F029. Remaining risk: GitHub-hosted CI has not rerun because the fix is not pushed.

- Command: `npm test`
- Result: 1961 passed, 4 skipped, 0 failed (exit 0, 127306ms).
- Date: 2026-08-17
- Notes: this is the final post-cleanup full-suite run; the earlier 1959-pass
  record above remains the pre-remediation baseline. Artifact: `feature_list.json`
  F029. Remaining risk: GitHub-hosted CI has not rerun because the fix is not pushed.

- Command: `cd apps/web && npm test`
- Result: 392 passed across 54 test files, 0 failed (exit 0).
- Date: 2026-08-17
- Notes: web-viewer guardrail passed; the remediation does not alter web code.
  Artifact: `feature_list.json` F029. Remaining risk: GitHub-hosted CI has not
  rerun because the fix is not pushed.
