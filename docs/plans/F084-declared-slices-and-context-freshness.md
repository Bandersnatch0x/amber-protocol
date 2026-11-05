# F084 Plan: Declared Plan Slices and a Deterministic Context Freshness Loop

Feature: F084
Status: implementation-ready
User Confirmation: confirmed
Spec: docs/specs/plan-slice-contract.md, docs/specs/context-freshness-loop.md
Decision records: ADR-0109

## High Level Design

Two seams that already existed as declarations, now checked.

- Scope: scripts/lib/core/planning.js, scripts/lib/core/context-freshness.js,
  scripts/lib/core/context-verify.js, scripts/lib/core/context-refresh.js,
  scripts/lib/core/context-loadout.js, scripts/lib/core/context-assurance.js,
  scripts/lib/core/context-stats.js, scripts/lib/core/classification.js,
  scripts/lib/core/doctor.js, scripts/lib/core/error-catalog.js, scripts/lib/context/,
  scripts/lib/core/cli-output.js, scripts/lib/command-registry.js, tests/unit/,
  tests/integration/, tests/phase-v2.test.js, tests/phase-v2-5.test.js, tests/phase-v4.test.js,
  docs/specs/, docs/adr/, docs/plans/, docs/CLI_REFERENCE.md, apps/docs/.
- Proposed approach: P1 adds a pure parser/validator for `## Vertical Slices` and calls it from
  `validatePlanContent`. P2 moves every freshness answer into one module and rewires the four read
  paths plus a new append-only `knowledge-feedback` event and `context feedback` verb.
- Risks: historical plans fail the gate until curated (intentional, one edit per open plan);
  derived confidence must never be written back onto the page.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/plan-slice-contract.md, docs/specs/context-freshness-loop.md, docs/adr/0109-declarations-carry-gates.md, docs/agents/dev-workflow.md, schemas/context-page.schema.json
- review: docs/specs/plan-slice-contract.md, docs/specs/context-freshness-loop.md, docs/adr/0109-declarations-carry-gates.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [ ] Slice 1: plan slice contract.
  - paths: scripts/lib/core/planning.js, tests/unit/planning.test.js
  - depends-on: none
  - verify: node --test tests/unit/planning.test.js
- [ ] Slice 2: one freshness policy module.
  - paths: scripts/lib/core/context-freshness.js, tests/unit/context-freshness.test.js
  - depends-on: 1
  - verify: node --test tests/unit/context-freshness.test.js
- [ ] Slice 3: verify, refresh, loadout, and assurance read the derived expiry.
  - paths: scripts/lib/core/context-verify.js, scripts/lib/core/context-refresh.js, scripts/lib/core/context-loadout.js, scripts/lib/core/context-assurance.js, scripts/lib/core/context-stats.js
  - depends-on: 2
  - verify: node --test tests/unit/context-verify-refresh-stats.test.js
- [ ] Slice 4: read-path suites pin the new expiry and feedback behaviour.
  - paths: tests/unit/context-verify-refresh-stats.test.js, tests/unit/context-loadout.test.js, tests/unit/context-classification.test.js, tests/unit/context-adapter.test.js
  - depends-on: 3
  - verify: node --test tests/unit/context-verify-refresh-stats.test.js tests/unit/context-loadout.test.js tests/unit/context-classification.test.js tests/unit/context-adapter.test.js
- [ ] Slice 5: the feedback verb wired through the context adapter.
  - paths: scripts/lib/context/action-registry.js, scripts/lib/context/index.js, scripts/lib/context/adapters/command.js, scripts/lib/core/cli-output.js
  - depends-on: 3
  - verify: node --test tests/unit/context-dispatch.test.js
- [ ] Slice 6: verb tests and command help.
  - paths: tests/unit/context-dispatch.test.js, tests/unit/context-action-registry.test.js, scripts/lib/command-registry.js
  - depends-on: 5
  - verify: node --test tests/unit/context-dispatch.test.js tests/unit/context-action-registry.test.js
- [ ] Slice 7: specs, ADR, and CLI reference.
  - paths: docs/specs/plan-slice-contract.md, docs/specs/context-freshness-loop.md, docs/adr/0109-declarations-carry-gates.md, docs/CLI_REFERENCE.md
  - depends-on: 6
  - verify: node scripts/amber.js docs:gen:check

## Resume Checkpoint

- Resume Point: all four slices are implemented in the working tree; focused suites are green.
- Blockers: none. Remaining work is the full gate run and stage-7 review.
- Next Action: run `npm test`, then `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`, `npm run docs:gen:check`, lint and format.
- Recovery Instructions: reopen this plan and continue at the first unchecked slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- A plan whose slices omit `paths`, `depends-on`, or `verify` fails `amber gate --plan`.
- A slice depending on a later or self slice fails; a slice over 5 paths or 2 subsystems fails.
- `amber context verify` reports the derived `expiresAt`, `stale-by-time`, and
  `AMBER_E_CONTEXT_PAGE_TIME_STALE` for an elapsed page, and `amber context load` excludes it as
  `expired`; both derive the same instant.
- `amber context refresh` produces a `ttl-expired` request for an elapsed page with unchanged sources.
- `amber context feedback` appends one event, never rewrites the page, and lowers derived confidence
  one level per contradiction; a re-ingest clears the decay.
- Existing Amber guardrails still pass: no model call, no weighted score, no automatic admission,
  no page rewrite, and no new authority surface.

## Verification

- `node --test tests/unit/planning.test.js tests/unit/context-freshness.test.js`
- `node --test tests/unit/context-verify-refresh-stats.test.js tests/unit/context-loadout.test.js tests/unit/context-classification.test.js tests/unit/context-adapter.test.js tests/unit/context-dispatch.test.js tests/unit/context-action-registry.test.js`
- `npm test`

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
