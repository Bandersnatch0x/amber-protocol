# F078 Plan: Harness Execution Terminate — Explicit Refusal

**Feature:** F078
**Status:** implementation-ready (spec `docs/specs/F078-harness-execution-terminate-refusal.md`, accepted 2026-09-24 via `issues/0128`)
**User Confirmation:** confirmed (`显式拒绝面`, 2026-09-24 — preserve separate Run cancel / runner abort / workspace release semantics)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20; F070 BLOCK posture; ADR-0101 Run lifecycle; F052 runner execution abort; F074 disclosed deferment

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F078-harness-execution-terminate-refusal.md` |
| Explicit refusal adapter | `scripts/lib/harness/harness-commands.js` (`execution terminate`) |
| Honest CLI help | `scripts/lib/command-registry.js` |
| Existing alternatives (unchanged) | `run-core.js` / `run-state-machine.js` (`advance → cancelled`), `core/runner-registry.js` (`abortRunnerExecution`), `execution-adapter.js` (`releaseExecution`) |
| Tests | `tests/unit/harness-execution.test.js` |

## Slices

1. **Explicit refusal**: recognize nested `execution terminate`, return stable
   `AMBER_E_INVALID_ARG`, name three alternatives, perform zero reads/writes.
2. **Help + close-out docs**: help/usage label refusal honestly; F074/F076/F077
   deferred notes point to the F078 disposition; docs regeneration.
3. **Conformance + review**: existing/missing/no-run raw and dispatcher cases; entire
   target tree byte pin over a real prepared execution; focused/full gates; stage-7
   dual-axis review; commit.

## Verification

- Focused: `node --test tests/unit/harness-execution.test.js`.
- Full gates: `npm test` (complete log), manifests, doctor, gen:agents:check, lint,
  format:check, docs:gen.

## Evidence schema

Recorded in `feature_list.json` F078 `evidence[]`. Acceptance demo: a real prepared run
and workspace are snapshotted; `harness execution terminate --run <id>` returns the
specific no-live-handle refusal naming advance/runner abort/release; target tree stays
byte-identical; missing/no-run invocations produce the same capability refusal.

## Non-goals

Live cancellation protocol; process handles/signals; lifecycle/runner/release changes;
composed cancel+abort+release.
