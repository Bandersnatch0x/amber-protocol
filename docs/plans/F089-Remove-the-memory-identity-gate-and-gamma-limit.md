# Plan: Remove the memory identity gate and the gamma admission limit

Feature: F089
Status: accepted
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

- Resume Point: implemented and delivered in PR #404, merged as `adb375e9`; both review axes passed and the learning review is booked.
- Blockers: none.
- Next Action: none. The T2 nomination was closed as skipped without `--yes`, which also demonstrates the retired gate.
- Recovery Instructions: verify `adb375e9` is an ancestor of `origin/master`; do not restore the retired code paths.

## Acceptance Criteria

- A non-TTY chain of `request`, `ingest`, `approve` and `book` succeeds without `--yes`.
- One ingest admits a request with more than five candidates.
- `memory status --json` contains no `gamma` key; doctor reports no γ rule.
- Every non-γ admission gate and the human approve step keep their existing behavior.
- Existing Amber guardrails and the phase boundary remain intact: Amber still never writes
  `MEMORY.md`, never dispatches agents, and never executes target-repo code.

## Verification

- Focused memory suites pass.
- Full root suite passes.
- `npm run manifests`, `amber doctor`, generated checks and wiki validation pass.

## Evidence Schema

- Command: focused node tests, full root suite, manifests, doctor, generated checks, wiki validation.
- Result: exit codes and failing-test names recorded before merge.
- Date: 2026-11-07

## Closeout Log

- Delivery: PR #404, merged as `adb375e997b15d2821a585820c3215f6dac8828c` on `master`; every applicable CI check passed. Reviewed head: `49f4d08d`.
- Independent Standards and Spec: PASS. The first round required two changes: a six-entry admission regression (the retained test sat exactly at the retired five-entry limit) and documentation corrections. Both were applied and re-reviewed.
- Verification: full root suite 4297 tests (4293 passed, 4 skipped because `sh` is unavailable, 0 failed); focused memory suites 44 passed; manifests, doctor, generated checks, wiki validation, documentation gates and the public-docs seam exited 0.
- The knowledge corpus was re-synced after the ADR amendment, and the generated public CLI reference was regenerated, so the projection and public docs match the new surface.
- The memory layer now has no non-TTY gate on `request`/`ingest`/`book` and no γ quota, ordering, exemption or partition. The entry-level human `approve` and the typed approve/abandon `--yes` gate remain.
