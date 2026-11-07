# Plan: Remove the memory identity gate and the gamma admission limit

Feature: F089
Status: verified
User Confirmation: confirmed

## Goal

Agents can run the memory pipeline without a terminal or `--yes`, and memory intake has no γ quota,
ordering, exemption or partition. The human `approve` gate and every non-γ admission check remain.

## High Level Design

- Context: the identity gate lived in one function called from `request`, `ingest` and `book`. γ lived
  in `memory-policy.js`, `memory-commands.js`, `doctor.js`, two action surfaces and a large test block.
- Proposed approach: delete the gate and γ code paths outright rather than keeping a disabled switch.
  `ingest` writes every eligible candidate, new events drop the γ fields, status drops the `gamma`
  section, and doctor drops rule 5. Historical ledger events with γ fields stay readable.
- Risks: `status --json` loses a public key, and intake loses its only rate limit. Both are deliberate;
  the spec records them and the ADR amendment states the accepted cost.

## Context manifests

- implement: docs/specs/F089-memory-ungated-admission.md, docs/adr/0018-governed-memory-layer.md
- review: docs/specs/F089-memory-ungated-admission.md, docs/specs/2026-08-21-governed-memory-layer.md

## Vertical Slices

- [x] Slice 1: delete the identity gate and every γ path from the policy, command and doctor modules.
  - paths: scripts/lib/core/memory-policy.js, scripts/lib/memory-commands.js, scripts/lib/core/doctor.js, scripts/lib/core/error-catalog.js
  - depends-on: none
  - verify: node --test tests/integration/memory-commands.test.js
- [x] Slice 2: rewrite the memory tests around ungated admission and a two-section projection.
  - paths: tests/integration/memory-commands.test.js, tests/integration/memory-triggers.test.js, tests/unit/memory-dispatch.test.js
  - depends-on: 1
  - verify: node --test tests/integration/memory-commands.test.js tests/integration/memory-triggers.test.js tests/unit/memory-dispatch.test.js
- [x] Slice 3: amend ADR-0018 and the governed memory specs.
  - paths: docs/adr/0018-governed-memory-layer.md, docs/specs/2026-08-21-governed-memory-layer.md, docs/specs/F087-provenance-refresh-gamma-exemption.md
  - depends-on: 1
  - verify: node --test tests/unit/documentation-gates.test.js
- [x] Slice 4: update the operator documentation surface.
  - paths: docs/CLI_REFERENCE.md, docs/wiki/amber-ontology-mcp.md
  - depends-on: 1
  - verify: node scripts/validate-wiki.js --target .
- [x] Slice 5: update the status action type and the memory help text.
  - paths: action-types/memory-status.json, scripts/lib/command-registry.js
  - depends-on: 1
  - verify: node scripts/amber.js memory --help
- [x] Slice 6: register the feature.
  - paths: feature_list.json, CHANGELOG.md
  - depends-on: 1, 2, 3, 4, 5
  - verify: npm run manifests

## Resume Checkpoint

- Resume Point: all slices implemented; focused suites pass.
- Blockers: full root suite, independent review and merge remain.
- Next Action: run the full suite, then the two-axis review and delivery.
- Recovery Instructions: re-open this plan and the F089 spec; do not restore the retired code paths.

## Acceptance Criteria

- A non-TTY chain of `request`, `ingest`, `approve` and `book` succeeds without `--yes`.
- One ingest admits a request with more than five candidates.
- `memory status --json` contains no `gamma` key; doctor reports no γ rule.
- Every non-γ admission gate and the human approve step keep their existing behavior.

## Verification

- Focused memory suites pass.
- Full root suite passes.
- `npm run manifests`, `amber doctor`, generated checks and wiki validation pass.

## Evidence Schema

- Command: focused node tests, full root suite, manifests, doctor, generated checks, wiki validation.
- Result: exit codes and failing-test names recorded before merge.
- Date: 2026-11-07
