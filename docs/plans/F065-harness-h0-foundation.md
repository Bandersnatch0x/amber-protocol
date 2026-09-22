# F065 Plan: Harness H0 Foundation — Contract, Run, Event

**Feature:** F065
**Status:** implementation-ready (spec `docs/specs/F065-harness-h0-foundation.md`; user confirmation pending in `issues/0069`)
**User Confirmation:** pending (HITL gate `issues/0069`)
**Date:** 2026-09-22
**Decision records:** ADR-0100, ADR-0101, ADR-0102
**Wayfinder map:** `issues/0066` (tickets 0071–0074)

## Context manifests

| Role | Paths |
| --- | --- |
| Decision authority | `docs/adr/0100-harness-contract.md`, `docs/adr/0101-run-unit-of-auditable-execution.md`, `docs/adr/0102-harness-event-ledger-via-ledger-family.md` |
| Normative spec | `docs/specs/F065-harness-h0-foundation.md` |
| Blast radius | `issues/0067-schema-blast-radius-research.md` (closed) |
| Vocabularies | `CONTEXT.md` (Harness Contract, Run, Run State, Harness Event, Harness Event Ledger, Snapshot Hash, Harness Admission) |
| Composed seams | `scripts/lib/core/schema-contract.js` (compileSchema), `scripts/lib/core/ledger-family.js` (defineLedgerFamily), `scripts/lib/state-dir-resolver.js`, `scripts/lib/subcommand-dispatcher.js` (defineCommand) |

## Slices (tracer bullets, blocking order)

1. **Contract** (ticket 0071, done): `schemas/harness-contract.schema.json` +
   `scripts/lib/harness/contract-core.js` (admit/inspect/list; Snapshot Hash identity;
   immutability; fail-closed reads) + registry four-piece + `harness/admit`, `harness/inspect`.
2. **Run** (ticket 0072, done): `schemas/run.schema.json` + `run-state-machine.js` (closed
   nine states; session machine untouched) + `run-core.js` (create/transition/get/list;
   terminal immutability) + `harness/start|advance|status`.
3. **Event ledger** (ticket 0073, done): `schemas/event.schema.json` + `event-ledger.js`
   (`harness` family via `defineLedgerFamily`; closed type enum; run-scoped; chain-walked
   fail-closed reads) + run lifecycle emits its trail + `harness inspect --run` chain view.
4. **Integration** (ticket 0074): §38 gate walk (`tests/unit/harness-integration.test.js`),
   docs lockstep (`docs:gen`, CLI_REFERENCE harness section), plan + feature entry, full gates,
   stage-7 two-axis review.

## Verification per slice

- Focused suites: `node --test tests/unit/harness-commands.test.js tests/unit/harness-run.test.js tests/unit/harness-events.test.js tests/unit/harness-integration.test.js tests/unit/command-registry-parity.test.js tests/unit/distributed-governance-schemas.test.js`
- Full gates (stage 6 exit): `npm test` (log to file, read whole), `npm run manifests`,
  `npm run doctor`, `npm run gen:agents:check`, `npm run lint`, `npm run format:check`,
  `npm run docs:gen:check`, `npm run docs:verify`.
- Naming/seam guards: `tests/legacy-references.test.js`, `tests/unit/no-facade-reintroduction.test.js`,
  `tests/unit/state-dir-seam-guard.test.js`, `tests/unit/schema-contract-guard.test.js`,
  `tests/unit/f063-placement-invariants.test.js` (all ride the full suite).

## Evidence schema

Delivered evidence is recorded in `feature_list.json` F065 `evidence[]` as command + result +
date; the §38 gate walk is the acceptance demo (`amber harness inspect --run` shows
Agent → Contract → Run → Events). No executed agent, no live dispatch, no new authority.

## Non-goals (unchanged)

No H1+ capability registry, no replay, no scheduler (H7 frozen), no homepage/charter change,
no MCP projection of `harness` (untyped CLI-only), `agent`/`team`/`adoption` deletion handled
by ticket 0068 separately.
