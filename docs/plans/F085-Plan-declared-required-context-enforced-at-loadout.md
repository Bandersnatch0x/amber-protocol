# Plan: Plan-declared required context enforced at loadout

Feature: F085
Status: accepted
User Confirmation: confirmed

## Goal

A plan can declare required Context Pages per implement/review role with an explicit freshness floor. A loadout built for that plan and role either places every requirement in the required tier or fails closed with a stable code when a requirement is missing, unhealthy, superseded, time-expired, or older than the declared floor.

## High Level Design

- Context: `## Context manifests` already lists knowledge surfaces per role and `amber gate --plan` checks each path exists. Nothing connects the declaration to `amber context load`, so a Loadout can omit the contract its plan names. See `docs/specs/plan-required-context.md` and `docs/adr/0110-required-context-is-loadout-enforced.md`.
- Proposed approach: every declared surface becomes a required-tier requirement. One new pure module (`scripts/lib/core/context-requirements.js`) resolves surface → covering page and returns either pageIds or a closed refusal reason. `context-loadout.js` unions the resolved pageIds into `requiredPins` before tier selection, so the existing required-tier and budget machinery does the rest. A role may add one sibling bullet `- freshness: <date|instant>` inside its role block; the floor compares against `revisionInstantFor(page, activity)` from `context-freshness.js`.
- Risks: a plan with a freshness floor starts failing once its pages age past the floor (intended, and the surface is named). Required pages count against the word budget, so a wide declaration can hit `AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW` — that is the pre-existing fail-closed path, not a new one.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/plan-required-context.md, docs/adr/0110-required-context-is-loadout-enforced.md, docs/specs/context-freshness-loop.md, docs/adr/0010-context-loadout.md
  - freshness: 2026-10-01
- review: docs/specs/plan-required-context.md, docs/adr/0110-required-context-is-loadout-enforced.md
  - freshness: 2026-10-01

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [x] Slice 1: parse the optional `freshness:` sibling bullet per role; a malformed or orphaned floor is a gate error, and the rule binds only while `sliceContractApplies(content)`.
  - paths: scripts/lib/core/planning.js, tests/unit/planning.test.js
  - depends-on: none
  - verify: node --test tests/unit/planning.test.js

- [x] Slice 2: add `scripts/lib/core/context-requirements.js` — a pure `resolveRequiredContext({ pageEntries, requiredPaths, freshnessFloor, now })` returning `{ pageIds, findings }`, where each surface resolves to exactly one current page or the closed reason `missing | ambiguous | unhealthy | superseded | time-expired | stale-floor`.
  - paths: scripts/lib/core/context-requirements.js, tests/unit/context-requirements.test.js
  - depends-on: 1
  - verify: node --test tests/unit/context-requirements.test.js

- [x] Slice 3: `previewLoadout` accepts `plan` + `role`, reads the plan's manifest, resolves requirements, unions pageIds into `requiredPins`, and returns `AMBER_E_CONTEXT_LOADOUT_REQUIRED` with the surface, role, and reason on any finding — before any file is written.
  - paths: scripts/lib/core/context-loadout.js, tests/unit/context-loadout.test.js
  - depends-on: 2
  - verify: node --test tests/unit/context-loadout.test.js

- [x] Slice 4: `context load` and `context preview` pass `--plan`/`--role` through; a missing pair or unknown role is a usage error, and `--page` pins still union.
  - paths: scripts/lib/context/adapters/command.js, tests/unit/context-dispatch.test.js
  - depends-on: 3
  - verify: node --test tests/unit/context-dispatch.test.js

- [x] Slice 5: document the flags in the `context` help text and CLI reference; the help lines name the two flags, the role values, and the refusal code.
  - paths: scripts/lib/command-registry.js, docs/CLI_REFERENCE.md
  - depends-on: 4
  - verify: node --test tests/unit/command-registry-parity.test.js

- [x] Slice 6: record the contract in the spec and ADR, then re-run this plan's gate.
  - paths: docs/specs/plan-required-context.md, docs/adr/0110-required-context-is-loadout-enforced.md, docs/plans/F085-Plan-declared-required-context-enforced-at-loadout.md
  - depends-on: 5
  - verify: amber gate --target . --plan docs/plans/F085-Plan-declared-required-context-enforced-at-loadout.md

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F085-Plan-declared-required-context-enforced-at-loadout.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied: `amber context load --plan <plan> --role implement` either writes a Loadout whose required tier contains every declared surface or exits non-zero with `AMBER_E_CONTEXT_LOADOUT_REQUIRED` naming the surface, the role, and one of the six closed reasons, and writes no file.
- A plan with no `freshness:` bullet behaves exactly as before; only declared surfaces change, and only for the role that declared them.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/planning.test.js tests/unit/context-loadout.test.js tests/unit/context-freshness.test.js
- node --test tests/unit/context-requirements.test.js tests/unit/context-dispatch.test.js
- node --test tests/unit/command-registry-parity.test.js tests/unit/context-verify-refresh-stats.test.js
- npm test

## Evidence Schema

- Command: `node --test tests/unit/planning.test.js tests/unit/context-loadout.test.js tests/unit/context-freshness.test.js`; `node --test tests/unit/context-requirements.test.js tests/unit/context-dispatch.test.js`; `node --test tests/unit/command-registry-parity.test.js tests/unit/context-verify-refresh-stats.test.js`; `npm test`; `node scripts/amber.js gate --plan`; `node scripts/verify-public-docs.js`; `amber context load --plan --role` on a disposable target.
- Result: 186 + 24 + 28 focused tests pass; `npm test` 4291 tests, 0 failed, 0 skipped, exit 0; gate 0 errors; public documentation seam passes. On a disposable target the uncovered surface refuses with `AMBER_E_CONTEXT_LOADOUT_REQUIRED` naming surface, role, and `missing`, and writes no file; a covering page lands in the required tier; a half-declared `--plan`/`--role` pair is `AMBER_E_INVALID_ARG`.
- Date: 2026-11-06
- Notes: Test runs recorded above were retaken after `npm run docs:gen` refreshed the generated CLI reference and the working tree was committed (the F063 N4 invariant asserts no untracked roots).
