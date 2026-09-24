# F073 Plan: Harness H5 — Eval & Replay (ValidationReceipt, Drift Detection, Regression Proposals)

**Feature:** F073
**Status:** implementation-ready (spec `docs/specs/F073-harness-h5-eval-replay.md`, accepted 2026-09-23 via `issues/0115`)
**User Confirmation:** confirmed (「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入)
**Date:** 2026-09-23
**Decision records:** Harness v2 §7/§16/§17/§26/§34/§43/§46.5/§51C-D; ADR-0101/0102; F054 propose discipline; F065–F072 as the staged spine
**Wayfinder map:** `issues/0066` (H5 named in fog, now graduated — the last H-fog)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F073-harness-h5-eval-replay.md` |
| Frozen run facts | `scripts/lib/harness/run-core.js`, `tool-core.js` (`toolsSnapshot`), `execution-adapter.js` (prepared records), `event-ledger.js` (fold), `attempt-core.js` (fold) |
| New: validation | `scripts/lib/harness/validation-core.js` |
| New: replay + proposal | `scripts/lib/harness/replay-core.js` |
| CLI | `scripts/lib/harness/harness-commands.js` (`validate`/`replay`/`propose-regression`), `scripts/lib/command-registry.js` help+usage |
| Schemas | `schemas/run.schema.json` (additive optional `validation`/`replay` summaries only) |

## Slices (tracer bullets, blocking order)

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

## Verification per slice

- Focused: `node --test tests/unit/harness-replay.test.js` (the consolidated H5 suite),
  plus the harness suites.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen`.

## Evidence schema

Recorded in `feature_list.json` F073 `evidence[]`. The acceptance demo (§43 gate):
one real run (attempt executed through the governed path), `validate` produces an
accepted receipt, `replay` answers from records alone on the untouched target
(all axes equivalent/unevaluated, no chat history), then an admitted tool change
makes `replay` report `tool-drift`, and `propose-regression` yields a proposal for a
failed run — with policy/rules/contract/grant files byte-identical throughout.

## Non-goals

Command re-execution (replay verifies frozen facts only); `model-drift` detection
beyond the explicit residual; eval-suite integration; H6/H7; MCP projection;
charter/homepage change.
