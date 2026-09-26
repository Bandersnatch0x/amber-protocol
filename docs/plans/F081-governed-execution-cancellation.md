# F081 Plan: Owned Governed-Execution Handles and Truthful Cancellation

**Feature:** F081
**Status:** implementation-ready (spec `docs/specs/F081-governed-execution-cancellation.md`, accepted via `issues/0134`)
**User Confirmation:** confirmed (`scope B: 统一改造共享 seam`, 2026-09-24)
**Date:** 2026-09-24
**Decision records:** ADR-0103 §2; ADR-0003 (four gates unchanged); F078 (refusal this replaces); F070 H2b; F080 (lease/fence pattern)

## Context manifests

| Role | Paths |
| --- | --- |
| Spec | `docs/specs/F081-governed-execution-cancellation.md` |
| Spawn seam | `scripts/lib/core/execution-domain-adapter.js` (`executeInPreparedWorkspace`, `executeInWorktree`) |
| Gate owner (becomes async) | `scripts/lib/core/governed-runner.js` (`runGovernedCommand`, `executeInWorktree`) |
| Consumers (await) | `scripts/lib/core/loop-execution.js`, `scripts/lib/session-stage-runner.js`, `scripts/lib/harness/execution-adapter.js`, `scripts/lib/core/evidence-runner.js` |
| New: handle + cancel | `scripts/lib/harness/execution-cancel.js` |
| CLI | `scripts/lib/harness/harness-commands.js`, `scripts/lib/command-registry.js` |
| Events | `scripts/lib/harness/event-ledger.js`, `schemas/event.schema.json` |
| Tests | `tests/unit/harness-execution-cancel.test.js` + untouched consumer suites as parity evidence |

## Slices

1. **Async seam, parity only** (no new capability): detached `spawn` + awaited exit,
   identical result envelope, all four consumers awaited; handle written/removed around the
   command. Evidence: every consumer suite passes unmodified.
2. **Handle view + cancel**: `execution handles`, `execution cancel` with separate
   single-use Decision, honest observation classification, race-safe settlement, restart
   reconciliation, two closed events, and the F078 message pointing at `cancel`.
3. **Gates + review + docs**: error codes, help/usage, CLI reference regen, full gates,
   dual-axis review, commit.

## Verification

- Focused: new cancel suite plus the four consumer suites.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents:check/
  lint/format/docs.

## Non-goals

Workspace deletion on cancel; retry; ungoverned executions; distributed cancellation;
README positioning (F082).
