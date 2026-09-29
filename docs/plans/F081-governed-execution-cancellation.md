# F081 Plan: Owned Governed-Execution Handles and Truthful Cancellation

Feature: F081
Status: implementation-ready
User Confirmation: confirmed
Plan date: 2026-09-24 (acceptance inputs refreshed 2026-09-29)
Spec: docs/specs/F081-governed-execution-cancellation.md
Decision records: ADR-0103 §2; ADR-0003 (four gates unchanged); F078 (the refusal this replaces); F070 H2b; F080 (the lease/fence pattern this reuses)

## High Level Design

One asynchronous execution seam replaces the blocking `spawnSync` model, and that seam owns
one persisted handle per running governed command.

- `scripts/lib/core/execution-domain-adapter.js` (`executeInPreparedWorkspace`) spawns detached,
  into its own process group, and returns the same result envelope; `governed-runner.js`
  (`executeInWorktree`, `runGovernedCommand`) becomes async and the four consumers
  (`loop-execution.js`, `session-stage-runner.js`, `harness/execution-adapter.js`,
  `evidence-runner.js`) await it. The four gates (policy, approval, isolation, ledger) and every
  ledger record, output digest and returned shape stay byte-identical: this slice is a
  process-model change with behaviour parity, proved by the consumer suites passing unmodified.
- While a command runs, `scripts/lib/core/execution-handles.js` persists exactly one handle
  (`pid`, `leaseId`, `fence`, `workspace`, `deadlineAt`, `target`) carrying a canonical Snapshot
  Hash. The seam writes it immediately after `spawn` returns a pid and clears it on settlement,
  so a missing handle means *no handle* — never "probably not running".
- `harness execution cancel --run <id> --decision <identity>@<revision> --reason <text>` is the
  only surface that may address that handle. It verifies the handle belongs to the requested
  target, consumes its OWN single-use human Decision, observes the pid before signalling,
  writes one immutable cancellation record, and appends one `execution.cancel.requested` +
  `execution.cancelled` pair to the existing Harness ledger. Cancellation never deletes the
  workspace, never rewrites the run's terminal result, and never claims a kill it did not
  observe.
- Settlement is race-safe (one terminal fact per attempt; the loser reports the conflict), and
  restart reconciliation reports `already-exited` for a stale handle instead of fabricating a
  termination receipt.

## Context manifests

- implement: docs/specs/F081-governed-execution-cancellation.md, docs/plans/F081-governed-execution-cancellation.md, schemas/event.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F081-governed-execution-cancellation.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, schemas/event.schema.json, CONTEXT.md

## Vertical Slices

1. **Async seam, parity only** (no new capability): detached `spawn` plus awaited exit, identical
   result envelope, all four consumers awaited, handle written and cleared around the command.
   Evidence: every consumer suite passes unmodified.
2. **Handle view + cancel**: `execution handles` and `execution cancel` with a separate
   single-use Decision, honest observation classification, race-safe settlement, restart
   reconciliation, the two closed `execution.cancel*` events, and the F078 message pointing at
   `cancel`.
3. **Gates + review + docs**: error codes, help and usage, CLI reference regeneration, full
   gates, dual-axis review, commit.

## Resume Checkpoint

- Resume Point: implementation landed in `748e31a`; five independent review rounds found defects that are all fixed in `8a719b4`, `fefe455`, `2678e08`, `89cd36f` and `3425a1c`. Focused verification is `node --test tests/unit/harness-execution-cancel.test.js`; full verification is `npm test`.
- Blockers: none open. The only outstanding item is an independent adversarial review of the current HEAD before acceptance.
- Next Action: re-review the current HEAD, then `amber accept --target . --plan docs/plans/F081-governed-execution-cancellation.md`.
- Recovery Instructions: a record that fails verification reports `AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT` and names `.amber/harness/executions/cancellations/<runId>.json`; an unsettled request is finished by re-running cancel with the SAME Decision (never a different one, never a second signal). Never repair a record in place — the ledger is the settlement authority.

## Acceptance Criteria

- Regression: `node --test tests/unit/harness-execution-cancel.test.js` passes, and the four
  consumer suites pass unmodified (parity evidence).
- Authority: cancellation grants zero launch authority, never deletes the workspace, and never
  rewrites the run's terminal result.
- Truthfulness: the reported outcome is always an observed `terminated` / `already-exited` /
  `unknown`, and a cancellation record is verified (closed field set, recomputed Snapshot Hash,
  binding to this run's request, handle snapshot and Decision) before it is ever cited.
- The existing guardrails are preserved: no new ledger family, no second hash chain, no event
  kind beyond the two closed `execution.cancel*` kinds, the four gates still precede any effect,
  and the current phase boundary is unchanged — this slice neither widens nor relaxes it.
- Full gates: `npm test`, manifests, doctor, `gen:agents:check`, `docs:gen:check`, lint and
  format all green.

## Verification

- Focused: `node --test tests/unit/harness-execution-cancel.test.js`.
- Parity: the untouched consumer suites (governed-runner, session-stage-runner, run-contract,
  route, loop, evidence-runner) keep every assertion unchanged.
- Full gates: `npm test` (run to completion; log read whole), manifests, doctor,
  `gen:agents:check`, `docs:gen:check`, lint, `format:check`.
- CLI smoke: `harness execution handles`, `cancel` with `--run`/`--decision`/`--reason`, and
  truncated flags through the real parseArgs path.

## Evidence Schema

- Command: node --test tests/unit/harness-execution-cancel.test.js; npm test
- Result: pass (17/17 cancellation cases; full suite 3873 pass, 0 fail, 4 skipped)
- Date: 2026-09-29
