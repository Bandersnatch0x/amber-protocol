# Plan: Durable owner routing for recurring friction

Feature: F028
Status: accepted
User Confirmation: confirmed

## Goal

amber learnings requires one explicit durable Amber owner when booking a new review, records and explains the owner through a centralized taxonomy, and keeps legacy ownerless bookings complete without migration

## High Level Design

- Context:
  - F023 detects knowledge write-back triggers and records reviewed surfaces, but the booking
    does not say which durable Amber surface owns the learned behavior. The result can be a
    document with no accountable command, guard, instruction, or repeated-work contract.
  - F025 already owns root-cause analysis and prevention-mechanism selection. F028 must not
    duplicate that taxonomy: a prevention mechanism says how recurrence is prevented; an
    owner route says which Amber surface carries that behavior after the review.
  - The source analysis suggested a general ownership-routing mechanism. Per ADR-0008, this
    implementation uses Amber's own product vocabulary and boundaries only. It remains local,
    offline, deterministic, and metadata-only.
- Proposed approach:
  1. Add one core taxonomy module as the single source of truth for eight durable owner ids:
     `skill`, `hook`, `command`, `standard`, `script`, `workflow-pack`, `loop-contract`, and
     `ci`. Each route has one short decision question and one responsibility statement.
     CLI help and learning inspection render directly from this module; the wiki taxonomy is
     parity-tested against it.
  2. Require exactly one explicit `--owner <id>` for every new or replacement
     `learnings --reviewed` booking. Validate the selection before loading or mutating feature
     state, reject missing, repeated, or unknown selections, and leave `feature_list.json`
     byte-for-byte unchanged on failure. Successful bookings write
     `learningWriteBack = { reviewed: true, date, surfaces, owner }`.
  3. Extend read-only inspection with the complete owner catalog, the current owner, the
     selected route's decision question, and an accurate booking command containing
     `--owner <id>`. An ownerless reviewed record is reported as a legacy booking that remains
     complete.
  4. Validate `learningWriteBack.owner` against the taxonomy when the field is present. Do
     not require it on existing records and do not change the lifecycle completion invariant:
     `learningWriteBack.reviewed === true` remains sufficient.
  5. Document the taxonomy and its boundaries. In particular, `workflow-pack` owns a
     declarative bundle, `loop-contract` owns repeated-work trigger/cadence/state/stop/review
     semantics, and `ci` owns checks that actually run on protected repository events. None
     implies live scheduling or autonomous execution by Amber.
- Risks:
  - Several routes can appear plausible for one friction. The decision questions and
    smallest-real-owner rule make the choice explicit; Amber validates the chosen id but does
    not infer it from paths or free text.
  - Requiring owner metadata retroactively would reopen F023-F027 and create a migration.
    Compatibility tests pin the existing `reviewed === true` behavior and optional-owner
    validation.
  - `--owner` is a global parser flag. Parser and CLI tests must pin one value as success and
    repeated values as a visible no-write error.
  - Existing user changes in `.claude/settings.json`, `scripts/lib/hooks-command.js`, and
    `tests/unit/hooks-command.test.js` are outside this feature and must remain untouched.
- Scope:
  - In scope: the owner taxonomy core, learning booking/inspection, CLI parsing/help,
    feature-list compatibility validation, focused tests, the learning-writeback contract,
    the stable owner-routing wiki, the operating manual, and CLI reference.
  - Out of scope: F025 root-cause or prevention-mechanism changes; automatic owner inference;
    target-project execution; agent dispatch; live scheduling; P2 instruction lint,
    pre-commit test mapping, or Stop-hook findings; ADR-0008 P3 work; release, commit, or push.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only - docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-15-learning-writeback.md, CONTEXT.md, docs/adr/0008-workflow-effectiveness-vs-governance-readiness.md
- review: docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/specs/2026-08-15-learning-writeback.md, docs/wiki/amber-ontology-mcp.md

## Vertical Slices

- [x] Slice 1: red tests - pin the eight-route taxonomy and distinctions, require exactly one
  valid owner before booking, prove missing/unknown/repeated owner failures preserve
  `feature_list.json` bytes, and pin legacy ownerless lifecycle/inspection compatibility.
- [x] Slice 2: implementation - add the taxonomy SSOT; wire parser, dispatcher, booking,
  inspection, help, and optional-owner feature validation; update existing booking tests to
  supply an owner and make the focused suites green.
- [x] Slice 3: documentation - add the stable taxonomy wiki with mechanism, invariant, drift
  symptoms, and test anchors; parity-check its route ids/questions against the core catalog;
  update the F023 contract, operating manual, and CLI reference.
- [x] Slice 4: governed verification and dogfood - run targeted checks, feature/wiki
  validators, the full repository guardrails, review the diff, then complete and accept the
  session. Book F028's own learning review with owner `command` after acceptance.

## Resume Checkpoint

- Resume Point: feature accepted; slices 1-4 complete; learning review booked (owner command).
- Blockers: none.
- Next Action: commit and close (user-run).
- Recovery Instructions: feature is accepted; any follow-up opens a new plan/session.

## Acceptance Criteria

- One frozen core catalog defines exactly these owner ids in stable order: `skill`, `hook`,
  `command`, `standard`, `script`, `workflow-pack`, `loop-contract`, `ci`. Help, inspection,
  validation, and wiki parity consume that catalog rather than maintaining independent enums.
- Every booking through `amber learnings --reviewed` requires exactly one explicit valid
  `--owner <id>`. Missing, unknown, comma-combined, or repeated owners fail visibly before
  mutation and leave `feature_list.json` byte-for-byte unchanged.
- A successful booking records `{ reviewed: true, date, surfaces, owner }`; re-booking also
  requires and replaces the owner. Amber never guesses an owner from paths or free text.
- Read-only inspection returns and renders the owner catalog, current owner, selected route
  question, and the exact `--owner <id>` remedy when unbooked. Existing ownerless reviewed
  records are identified as legacy and remain complete without migration.
- `validateFeatureListData` accepts ownerless legacy bookings and valid present owners, but
  rejects a present owner outside the core catalog. Lifecycle completion remains based on
  `reviewed === true` only.
- The taxonomy documentation distinguishes owner routes from F025 prevention mechanisms and
  preserves Amber's no-execution boundary: packs/contracts are declarative and live
  scheduling remains unsupported.
- Existing user-owned hook changes remain untouched. P2/P3 follow-ups are not included.
- All targeted tests, feature/wiki validators, `npm test`, `npm run manifests`,
  `npm run doctor`, and `npm run gen:agents:check` pass.
- Existing Amber guardrails and phase boundaries still hold: no new top-level
  command or lifecycle step beyond the `learnings` surface, no automatic owner
  inference from paths or free text, no target-project execution, no live
  scheduling, no P2/P3 scope creep; PUBLIC_COMMAND_ORDER and the breadcrumb
  parity walk stay untouched. Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/learning-writeback.test.js
- node --test tests/unit/validators.test.js
- node --test tests/unit/command-registry-parity.test.js
- node scripts/validate-feature-list.js --target .
- node scripts/validate-wiki.js --target .
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check

## Evidence Schema

- Command: node --test tests/unit/learning-writeback.test.js
- Result: required - taxonomy, no-write booking failures, CLI wiring, inspection output,
  successful metadata, re-booking, and legacy lifecycle compatibility pass
- Date: record at verification
- Notes: red first; direct and spawned-CLI coverage must exercise the same core catalog

- Command: node --test tests/unit/validators.test.js
- Result: required - ownerless legacy and valid-owner records pass; an unknown present owner
  fails with the valid owner ids in the error
- Date: record at verification
- Notes: do not make owner mandatory for historical reviewed records

- Command: node --test tests/unit/command-registry-parity.test.js
- Result: required - public command help/parity remains green and learnings help renders the
  core owner choices
- Date: record at verification
- Notes: generated platform skills are out of scope because no skill source changes

- Command: node scripts/validate-feature-list.js --target . && node scripts/validate-wiki.js --target .
- Result: required - Errors: 0 for feature state and wiki structure
- Date: record at verification
- Notes: F028 paths and stable taxonomy page are booked before validation

- Command: npm test && npm run manifests && npm run doctor && npm run gen:agents:check
- Result: required - all repository guardrails pass with zero failures or drift
- Date: record at verification
- Notes: final evidence is recorded through `session verify --execute`, not self-reported
