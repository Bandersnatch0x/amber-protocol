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
- [x] Slice 4: `gate_returned` timeline vocabulary + schema.
  - paths: scripts/lib/session-timeline.js, schemas/timeline-event.schema.json
  - depends-on: 2
  - verify: node --test tests/unit/session-gate-return.test.js
- [x] Slice 5: web gate status rendering (`returned` filter/label/style/i18n)
  and its session-event schema parity.
  - paths: apps/web/server/types/session-events.ts, apps/web/server/lib/types/gate.ts, apps/web/server/lib/gate-reader.ts, apps/web/server/routers/gate.ts, apps/web/src/routes/gates.tsx
  - depends-on: 4
  - verify: npm run test --prefix apps/web
- [x] Slice 6: CLI flag wiring (`--return-to` in FLAG_SPECS and the
  dispatcher) + usage lines.
  - paths: scripts/lib/command-dispatcher.js, scripts/lib/command-registry.js
  - depends-on: 2
  - verify: node --test tests/unit/session-gate-return.test.js
- [x] Slice 7: flag parsing projection (`--return-to` in FLAG_SPECS).
  - paths: scripts/lib/core/cli-output.js
  - depends-on: 6
  - verify: node --test tests/unit/session-gate-return.test.js
- [x] Slice 8: generated docs reference for the new flag.
  - paths: docs/CLI_REFERENCE.md, apps/docs/docs/reference/cli/session.md, apps/docs/docs-manifest.json
  - depends-on: 6
  - verify: node scripts/gen-docs-cli.js --check

## Verification

- `node --test tests/unit/session-gate-return.test.js` — 18 behavior tests:
  cursor truncation and re-extension, the settle→return→re-approve→redo→next
  sequence, target validation, per-ruling convergence, refusal of invalid
  gate ids, guidance-surface pending counts, the legacy manifest path with
  currentStage consistency, completion-check voiding and restoration, timeline
  schema parity.
- Full root suite `npm test` — 4324 passed, 0 failed at head 61883598.
- `npm run test --prefix apps/web` — 812 passed, including the schema-parity
  guard.
- Mutation checks: each fix branch (gate-id charset guard, per-ruling
  convergence, passed-gates fold, currentStage advancement) turned the suite
  red, restoring turned it green.
- Real-CLI confirmation: a poisoned route gate id is refused with the sentinel
  file intact; two returns on the shipped feature-standard route both land in
  the ledger in either order; `resolvePendingGate` and the breadcrumb report
  the returned gate as pending again.

## Acceptance Criteria

- A return ruling (`amber session approve --return-to <stage>`) rewinds the
  session to the gate's owning stage or an earlier one, per the F090 spec
  contract, without aborting the session or editing ledger history.
- A returned gate goes back to pending on every surface: rerun refusal,
  `amber next`, the breadcrumb, `complete-check`, and the web viewer.
- Convergence is per ruling: a replayed identical return appends nothing; a
  different gate's return is always recorded.
- A gate id outside the route charset is refused before any filesystem or
  ledger effect.
- Scope boundaries: session surface only; no route schema change; automatic
  rework on script failure stays out of scope (see Out of scope).
- Guardrails: the whole-repository gates stay green on the merged head
  (`npm test` 4324/0, manifests, doctor, gen:agents:check, validate-wiki,
  docs:gen:check, web vitest 812/0, web lint 0 errors); no new seam bypass —
  schema compilation stays in `schema-contract.js` and git calls in
  `git-exec.js`.

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:

## Resume Checkpoint

- Resume Point: all seven slices complete and merged to master (PR #411,
  mergeCommit 1c2f1ad5); two independent verification rounds recorded
  (FAIL on the pre-fix head, PASS on the merged head).
- Blockers: none.
- Next Action: run `amber accept` to book the feature's acceptance.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  vertical slice; do not regenerate unless the plan file is missing.
