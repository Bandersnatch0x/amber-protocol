# F066 Plan: Harness Vertical Slice — One Governed Execution Through the Chain

**Feature:** F066
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「按推荐」, 2026-09-22 (`issues/0076`)
**Date:** 2026-09-22
**Decision records:** ADR-0100 (decision 3), ADR-0101 (decision 4), ADR-0102; F065 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0075–0080)

## High Level Design

- Context: H0 landed three schema-governed objects (contract, run, event ledger) but nothing had
  yet driven one real governed execution through the whole chain. The vertical slice is the
  proof that Contract → Admission → Run → Event composes with the loop machinery that already
  exists, without granting any new execution authority.
- Proposed approach: three tracer bullets in blocking order. First an AdmissionReceipt with six
  closed checks, each citing a real artifact by pointer, so admission witnesses the loop's
  existing gates rather than replacing them. Then a loop ↔ Run adapter that reads the loop's
  unconsumed approval to resolve all six pointers and binds the loop's recorded outcome onto the
  run's terminal transition. Then integration: gates, the three-piece catalog, docs lockstep.
- Risks: the adapter must stay read-only over the loop ledger, or it becomes a second authority;
  a failed execution must leave a failed run rather than a silently completed one; and the
  pre-slice records must stay byte-compatible, so every schema change is additive and optional.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F066-harness-vertical-slice.md, docs/specs/F065-harness-h0-foundation.md, docs/adr/0100-harness-contract.md, docs/adr/0101-run-unit-of-auditable-execution.md, docs/adr/0102-harness-event-ledger-via-ledger-family.md, schemas/run.schema.json, schemas/event.schema.json
- review: docs/specs/F066-harness-vertical-slice.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **AdmissionReceipt** (ticket 0077, done): `run.schema.json` additive `admission` section
   (six closed checks, each `{result: "pass", pointer}`), `AMBER_E_HARNESS_ADMISSION_INCOMPLETE`,
   `amber harness advance --check <name:pointer>` ×6; `event.schema.json` additive optional
   `pointers[]`.
2. **Loop ↔ Run adapter** (tickets 0078–0079, done): `scripts/lib/harness/loop-adapter.js` —
   `startRunFromLoop` (the loop's unconsumed approval in `.amber/loops/<id>/ledger.jsonl`
   resolves all six receipt pointers; refusal without one) and `bindLoopOutcome` (the loop
   ledger's latest `executed` record drives `execution.started/completed/failed` +
   `policy.evaluated` events and the run's terminal transition; a failed execution leaves a
   failed run). CLI: `harness start --from-loop <loopId> [--file <pack>]`, `harness bind`.
3. **Integration** (ticket 0080): full gates, three-piece catalog, docs lockstep, stage-7
   two-axis review.

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0076` confirmation and the 32/32 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F066, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F066-harness-vertical-slice.md` and the `issues/0075`–`0080` logs; never hand-edit the F066 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- An AdmissionReceipt carries all six closed checks, each citing a real artifact, and admission is refused when any is missing (`AMBER_E_HARNESS_ADMISSION_INCOMPLETE`).
- A run started from a loop resolves its six pointers from the loop's unconsumed approval and refuses without one.
- The loop's latest `executed` record binds the run's terminal transition, and a failed execution leaves a failed run.
- The loop's four gates remain the only execution authority: the adapter is read-only over them, and this slice adds no new gate.
- Existing guardrails still pass, and the current phase boundary is unchanged: no replay engine, no scheduler, no MCP projection, no homepage or charter change.

## Verification

- Focused: `node --test tests/unit/harness-admission.test.js tests/unit/harness-loop-adapter.test.js tests/unit/harness-commands.test.js tests/unit/harness-run.test.js tests/unit/harness-events.test.js tests/unit/harness-integration.test.js`
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence Schema

- Command: `node --test tests/unit/harness-*.test.js` (the F066 set)
- Result: pass — 32/32 focused tests green (admission 5, loop adapter 5, commands 9, run 6, events 6, §38 walk 1)
- Date: 2026-09-22
- Notes: the acceptance demo is a loop approval written by the loop's own gate admitting a Harness run whose six checks cite real artifacts, with one real `executed` outcome binding the run to completed/failed.

## Non-goals

No new gate or execution authority (the loop's four gates stay the only authority; the
adapter is read-only over them), no replay engine (H5), no scheduler (H7), no MCP projection,
no homepage/charter change.
