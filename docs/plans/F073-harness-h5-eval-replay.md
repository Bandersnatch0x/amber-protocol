# F073 Plan: Harness H5 — Eval & Replay (ValidationReceipt, Drift Detection, Regression Proposals)

**Feature:** F073
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入 (`issues/0115`)
**Date:** 2026-09-23
**Decision records:** Harness v2 §7/§16/§17/§26/§34/§43/§46.5/§51C-D; ADR-0101/0102; F054 propose discipline; F065–F072 as the staged spine
**Wayfinder map:** `issues/0066` (H5 named in fog, now graduated — the last H-fog)

## High Level Design

- Context: by H4 a run recorded contract, tools, execution, context, policy and attempts, but
  nothing folded those facts into a verdict, and nothing could ask whether two runs rested on the
  same world. A reader had to reconstruct both answers by hand from the trail.
- Proposed approach: a ValidationReceipt over a closed check set, each check `pass|fail|not-run`
  with a mandatory not-run reason; a replay that re-derives six axes from frozen records alone;
  and a regression proposal that derives only from recorded facts. Nothing re-executes a command,
  and governance files stay byte-identical throughout.
- Risks: `not-run` must never be silently promoted to `pass`, or an unevaluated run reads as
  verified; replay must answer from records rather than by re-running, or it becomes execution
  disguised as verification; and `model-drift` must stay an explicit residual instead of an
  inferred cause.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F073-harness-h5-eval-replay.md, docs/adr/0101-run-unit-of-auditable-execution.md, docs/adr/0102-harness-event-ledger-via-ledger-family.md, schemas/run.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F073-harness-h5-eval-replay.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **ValidationReceipt** (ticket 0116): `validateRun` over the closed check set
   (policy/execution/tools/context/evidence/attempts), `pass|fail|not-run` with
   mandatory not-run reasons, receipt record + first `validation.completed` event,
   additive run `validation` summary, never touches the run state machine.
2. **Replay + regression proposal** (ticket 0117): `replayRun` re-derives the six §7
   axes from frozen records (contract/tools/execution/context/policy/attempts),
   per-axis `equivalent|drift|unevaluated`, closed drift-kind enum with
   `model-drift` as the explicit residual; `proposeRegression` derives only from
   recorded facts (clean passing run refuses); governance-untouched conformance
   assertion.
3. **Integration gates** (ticket 0118): §46.5 replay matrix cases, CLI wiring +
   docs lockstep, `feature_list.json` F073, §43 gate demo, full gates, stage-7
   two-axis review, ticket-split commits.

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0115` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F073, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F073-harness-h5-eval-replay.md` and the `issues/0116`–`0118` logs; never hand-edit the F073 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- `validate` produces a receipt over the closed check set where every check carries `pass`, `fail` or a mandatory `not-run` reason, and the run state machine is untouched.
- `replay` answers from frozen records alone on an untouched target: all axes `equivalent` or `unevaluated`, no chat history, no command re-execution.
- An admitted tool change between two runs makes `replay` report `tool-drift`, and `model-drift` remains the explicit residual rather than an inferred cause.
- `propose-regression` yields a proposal for a failed run and refuses for a clean passing one.
- Policy, rules, contract and grant files stay byte-identical throughout the demo.
- Existing guardrails still pass, and the current phase boundary is unchanged: no command re-execution, no eval-suite integration, no H6/H7 surface, no MCP projection.

## Verification

- Focused: `node --test tests/unit/harness-replay.test.js` (the consolidated H5 suite),
  plus the harness suites.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen`.

## Evidence Schema

- Command: `dual-axis review (issues/0114)`; `node --test tests/unit/harness-replay.test.js`
- Result: pass — Spec axis 9 met / 3 partial / 0 contradicts; Standards axis pass-with-findings (5xP2 + 6xP3), all findings adjudicated fixed
- Date: 2026-09-24
- Notes: the acceptance demo is the §43 gate — one real governed attempt, an accepted receipt, a record-only replay with all axes equivalent or unevaluated, a tool change flipping replay to `tool-drift`, and a proposal for a failed run.

## Non-goals

Command re-execution (replay verifies frozen facts only); `model-drift` detection
beyond the explicit residual; eval-suite integration; H6/H7; MCP projection;
charter/homepage change.
