# F080 Plan: H7 Bounded Maintenance Runtime

**Feature:** F080
**Status:** implementation-ready (accepted via `issues/0132`, 「全部按推荐」)
**Date:** 2026-09-24
**Decision records:** ADR-0103; Harness v2 §27/§36/§47–§49; F079

## Context manifests

| Role | Paths |
| --- | --- |
| Spec | `docs/specs/F080-h7-bounded-maintenance-runtime.md` |
| Runtime core | new `scripts/lib/harness/runtime-core.js` |
| Daemon worker | new `scripts/amber-runtime.js` |
| Existing ledger | `scripts/lib/harness/event-ledger.js`, `schemas/event.schema.json` |
| CLI | `scripts/lib/harness/harness-commands.js`, `scripts/lib/command-registry.js`, shared flags |
| Tests | new `tests/unit/harness-runtime.test.js`; seam coverage |

## Slices

1. Schedule contract + human Decision resolution + immutable records + runtime event kinds.
2. Closed `draft-spec-review` job + tick + proposal records + budget/no-progress/revoke.
3. Fenced daemon start/stop/status + stale-owner recovery.
4. CLI/docs/feature lockstep, full gates, dual-axis review, commit.

## Verification

Focused H7 suite plus Harness event/schema tests; full repository gates.

## Non-goals

Commands, agents, workflows, effects, document edits, distributed runtime, F081 cancel,
F082 positioning.
