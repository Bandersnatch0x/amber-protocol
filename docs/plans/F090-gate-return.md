# Plan: Gate return — a gate ruling can send work back to a stage

Feature: F090
Status: accepted
User Confirmation: confirmed

## Goal

A reviewer at a Route Gate can send work back to the gate's own stage or an
earlier one as a recorded ruling, without aborting the session or editing the
ledger.

## High Level Design

- Context: the session cursor lives in two places — verb sessions derive it
  from the append-only ledger (`cursorFromLedger`), legacy sessions keep it in
  `manifest.completedStages`. Gates resolve through `resolveCurrentStage`,
  which only looked one stage back.
- Proposed approach: make the cursor a derivation over a new `gate_returned`
  ledger record instead of storing a rewind. One record kind carries the whole
  feature: truncation falls out of derivation, the gate re-arms because the
  newest ruling wins, and replay after a crash converges.
- Risks: a stale `gate_passed` recorded before the return would otherwise
  unblock the rerun; the derivation checks the newest ruling per gate, and
  `complete-check` mirrors that rule. The gate at the cursor blocks only when
  its owning stage already ran, so first executions stay ungated.

## Context manifests

- implement: docs/specs/F090-gate-return.md, docs/adr/0111-gate-return-rewinds-the-session.md
- review: docs/specs/F090-gate-return.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md

## Vertical Slices

- [x] Slice 1: ledger cursor truncation + gate re-arm in the stage runner.
  - paths: scripts/lib/session-stage-runner.js
  - depends-on: none
  - verify: node --test tests/unit/session-gate-return.test.js tests/unit/session-stage-runner.test.js
- [x] Slice 2: `approveSession --return-to` with target validation, ledger +
  timeline records, decision-file clear, projection rebuild.
  - paths: scripts/lib/session-commands.js
  - depends-on: 1
  - verify: node --test tests/unit/session-gate-return.test.js
- [x] Slice 3: completion-check voids approval evidence for returned gates.
  - paths: scripts/lib/completion-check.js
  - depends-on: 1
  - verify: node --test tests/unit/session-gate-return.test.js tests/unit/session-commands.test.js
- [x] Slice 4: `gate_returned` timeline vocabulary + schema, web gate status.
  - paths: scripts/lib/session-timeline.js, schemas/timeline-event.schema.json, apps/web/server/types/session-events.ts, apps/web/server/lib/types/gate.ts, apps/web/server/lib/gate-reader.ts, apps/web/server/routers/gate.ts, apps/web/src/routes/gates.tsx, apps/web/src/lib/i18n.tsx, apps/web/src/features/gates/gate-feedback.ts
  - depends-on: 2
  - verify: npm run test --prefix apps/web
- [x] Slice 5: CLI flag wiring (`--return-to` in FLAG_SPECS, dispatcher,
  usage lines) + generated reference.
  - paths: scripts/lib/core/cli-output.js, scripts/lib/command-dispatcher.js, scripts/lib/command-registry.js, docs/CLI_REFERENCE.md, apps/docs/docs/reference/cli/session.md, apps/docs/docs-manifest.json
  - depends-on: 2
  - verify: node scripts/gen-docs-cli.js --check

## Out of scope

Automatic rework when a script/verification stage fails (pre-declared
rework-on-failure edges). If wanted, it is a separate feature over the same
`gate_returned` record.
