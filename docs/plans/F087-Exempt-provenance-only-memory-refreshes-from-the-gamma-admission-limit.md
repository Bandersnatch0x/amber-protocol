# Plan: Exempt provenance-only memory refreshes from the gamma admission limit

Feature: F087
Status: implementation-ready
User Confirmation: pending

## Goal

A memory entry that names a real active/needs-re-review predecessor, preserves its claim, knowledgeKind and targetSurface exactly, and actually changes its source binding is admitted without consuming the five-per-168h gamma quota, while unchanged bindings, changed claims, invalid targets and ordinary admissions keep the existing limit and every other admission gate.

## High Level Design

- Context: entry identity hashes the core content *including* `supersedeTarget`, so a refresh is always a new entry plus a supersession; identity change alone is not evidence of a refresh.
- Proposed approach: one registry-backed predicate (`gammaExemptTarget`) decides exemption at admission; the ledger records the charged/exempt partition under a single validator; doctor, status and admission share the same fail-closed semantics.
- Risks: over-broad exemption (no-op resubmissions consuming zero quota); corrupt partitions silently re-read as legacy; readers observing a partially written ACK file.

## Context manifests

- implement: docs/specs/F087-provenance-refresh-gamma-exemption.md, docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md
- review: docs/specs/F087-provenance-refresh-gamma-exemption.md, docs/adr/0018-governed-memory-layer.md

## Vertical Slices

- [x] Slice 1: add the provenance-only refresh predicate and the charged/exempt partition.
  - paths: scripts/lib/core/memory-policy.js, scripts/lib/memory-commands.js, tests/integration/memory-commands.test.js
  - depends-on: none
  - verify: `node --test tests/integration/memory-commands.test.js`
- [x] Slice 2: teach doctor rule 5 and the status projection the partition contract.
  - paths: scripts/lib/core/doctor.js, scripts/lib/core/memory-policy.js, tests/integration/memory-commands.test.js
  - depends-on: Slice 1
  - verify: `node --test tests/integration/memory-commands.test.js tests/unit/memory-dispatch.test.js`
- [x] Slice 3: publish runner ACKs atomically from the real CLI writer.
  - paths: scripts/lib/runner-ack.js, apps/web/server/lib/runner-ack.ts, apps/web/tests/server/runner-ack.test.ts
  - depends-on: none
  - verify: `cd apps/web && npx vitest run tests/server/runner-ack.test.ts`

## Resume Checkpoint

- Resume Point: implementation complete; review follow-up applied (source-binding guard, partition contract, real CLI writer).
- Blockers: none.
- Next Action: coordinator review and integration; the real `MEMORY.md` booking stays a human step.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- A refresh that names a real predecessor, preserves the three core fields and changes its source binding consumes no quota; an unchanged binding stays charged.
- Doctor, `amber memory status` and admission agree on a corrupt partition and fail closed.
- The Web reader never observes a partially written ACK produced by the real CLI writer.

## Verification

- targeted memory policy/command tests green
- npm test full suite green
- amber doctor rule 5 counts charged admissions only
- vitest apps/web suite green

## Evidence Schema

- Command: `node --test tests/integration/memory-commands.test.js tests/unit/memory-dispatch.test.js`
- Result: 48/48 pass
- Date: 2026-11-07
- Notes: full-suite and cross-boundary evidence recorded in the feature list and the implementation report.
