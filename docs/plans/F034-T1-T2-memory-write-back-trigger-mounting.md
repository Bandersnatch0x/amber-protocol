# Plan: T1/T2 memory write-back trigger mounting

Feature: F034
Status: accepted
User Confirmation: confirmed

## Goal

Completing a session strictly with handoff evidence nominates a T1 memory write-back contract, and accepting a feature whose booked paths hit a write-back category nominates a T2 contract — each exactly once per trigger event, as a ledger-visible nomination the host agent answers via `amber memory request` or legitimately skips

## High Level Design

- Context:
  - ADR-0018's Governed Memory Layer shipped its verb surface in F033
    (request/ingest/approve/book/abandon/status, doctor rules 1–11); the
    automatic trigger points from spec §5.1 remained unwired.
  - §5.1 defines T1 (session side: after a successful completion transition,
    mechanical condition = strict complete-check ∧ hasHandoffEvidence) and T2
    (feature side: feature accept ∧ deterministic path-category hit, reusing
    the F023 detectWriteBackTriggers criteria at the same site).
  - §5.1-M3: a trigger's product is ONLY a contract artifact plus one
    `memory-request-created` ledger event — γ counts admitted proposals only,
    so nominations consume nothing; the host agent may legitimately never
    answer (the "no-change" outcome).
- Proposed approach:
  1. New module `scripts/lib/core/memory-trigger.js`: `triggerWriteBackRequest`
     writes a nomination-contract record under `.amber/memory/triggers/` and
     appends the `memory-request-created` event (channel t1/t2-writeback,
     `entryIds: []`), with §5.2 exclusivity — an open record with the same
     channel + triggerRef makes re-triggering a no-op.
  2. T1 mounts in `completeSession` AFTER the manifest transition succeeds,
     gated on `hasHandoffEvidence`; failures surface as a warning and never
     block completion (M1: complete-check stays pure).
  3. T2 mounts in `acceptPlan` after the accept succeeds, gated on
     `detectWriteBackTriggers(feature.paths)` category hit; failures surface
     as a warning and never block acceptance.
  4. Tests cover trigger semantics (contract + event + exclusivity + γ
     untouched + MEMORY.md never edited), T1 firing exactly once on strict
     completion, T1 silence on failed completion, T2 firing at accept with a
     category hit, T2 silence otherwise, and re-accept idempotence.
- Spec interpretation (entries[] minItems 1 tension): the memory-request
  schema requires `entries[]` minItems 1, but a mechanical trigger cannot
  invent claims (§5.1 "零语义判定"). The trigger therefore writes its
  nomination contract as a separate artifact class under
  `.amber/memory/triggers/` — `.amber/memory/requests/` stays reserved for
  schema-valid requests created through the `amber memory request` verb, and
  the event carries `entryIds: []` to mark the contract-only shape (§9 fields
  stay within the closed set). The host agent answers later through the verb
  with triggerRef linkage.
- Risks:
  - Trigger records are a new artifact directory; they never enter
    `readRequests()` (which feeds ingest pools), so no γ/pool pollution.
  - Both mounts are fail-open by design: a trigger failure must not block
    session completion or feature acceptance — it degrades to a warning.

## Deviation Table (spec §14-8)

| # | Spec point | Deviation / interpretation | Rationale |
|---|------------|----------------------------|-----------|
| D1 | §5.1-M3 says the trigger product is a "request (contract + event)" and §10.4 stores requests under `.amber/memory/requests/` | The trigger writes a new artifact class under `.amber/memory/triggers/`, never `.amber/memory/requests/`; the `memory-request-created` event carries `entryIds: []` | The `memory-request` schema requires `entries[]` minItems 1, but a mechanical trigger may not invent claims (§5.1 "零语义判定"). A schema-valid request in requests/ would fake an admission. Contract-only shape is marked by `entryIds: []` within the §9 closed field set. |
| D2 | §5.1 locates T2 "与 F023 learningWriteBack 同一触发位点" and mentions "复用 detectWriteBackTriggers 判据与 F023 owner 路由" | T2 mounts inside `acceptPlan` after a successful accept (not inside the lifecycle review step, which is read-only and gated on `acceptLogged`), and consumes only the deterministic `matchedCategories` criteria. Owner routing stays with the F023 `amber learnings --reviewed --owner` flow — the T2 nomination's remedy surfaces `amber memory request (triggerRef <feature-id>)` parallel to it | The lifecycle site never executes during accept; mounting there would fire on inspections, not on the accept event. Reusing the owner-routing write path would entangle the learning-review booking with a system nomination. |

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md
- review: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md

## Vertical Slices

- [x] Slice 1: memory-trigger module — nomination contract record, §5.2
  exclusivity, memory-request-created event with empty entryIds.
- [x] Slice 2: T1 mount in completeSession (post-transition, handoff-evidence
  gated, non-blocking) and T2 mount in acceptPlan (category-hit gated,
  non-blocking).
- [x] Slice 3: integration tests for trigger semantics, T1 positive/negative,
  T2 positive/negative, and idempotent re-trigger/re-accept.

## Resume Checkpoint

- Resume Point: implementation and focused tests complete; full verification
  pending.
- Blockers: none.
- Next Action: run the full gate suite, book evidence, review, accept.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/integration/memory-triggers.test.js
- node --test tests/integration/memory-commands.test.js tests/unit/session-commands.test.js
- npm test

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
