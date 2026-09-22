# F066 Plan: Harness Vertical Slice — One Governed Execution Through the Chain

**Feature:** F066
**Status:** implementation-ready (spec `docs/specs/F066-harness-vertical-slice.md`, accepted 2026-09-22 via `issues/0076`)
**User Confirmation:** confirmed (「按推荐」, 2026-09-22)
**Date:** 2026-09-22
**Decision records:** ADR-0100 (decision 3), ADR-0101 (decision 4), ADR-0102; F065 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0075–0080)

## Context manifests

| Role | Paths |
| --- | --- |
| Decision authority | `docs/adr/0100-harness-contract.md`, `docs/adr/0101-run-unit-of-auditable-execution.md`, `docs/adr/0102-harness-event-ledger-via-ledger-family.md` |
| Normative spec | `docs/specs/F066-harness-vertical-slice.md` |
| Foundation | `docs/specs/F065-harness-h0-foundation.md` (accepted), `scripts/lib/harness/` |
| Composed loop surfaces (read-only) | `scripts/lib/core/loop-ledger.js`, the loop ledger at `.amber/loops/<id>/ledger.jsonl` |

## Slices (tracer bullets, blocking order)

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

## Verification per slice

- Focused: `node --test tests/unit/harness-admission.test.js tests/unit/harness-loop-adapter.test.js tests/unit/harness-commands.test.js tests/unit/harness-run.test.js tests/unit/harness-events.test.js tests/unit/harness-integration.test.js`
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence schema

Recorded in `feature_list.json` F066 `evidence[]` (command + result + date). The acceptance
demo: a loop approval (written by the loop's own gate) admits a Harness run whose six checks
cite real artifacts, and one real `executed` outcome binds the run to completed/failed with
its execution event chain.

## Non-goals (unchanged)

No new gate or execution authority (the loop's four gates stay the only authority; the
adapter is read-only over them), no replay engine (H5), no scheduler (H7), no MCP projection,
no homepage/charter change.
