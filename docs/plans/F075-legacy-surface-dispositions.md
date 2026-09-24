# F075 Plan: Harness §52 Legacy Surface Dispositions (task / result / profile inspect)

**Feature:** F075
**Status:** implementation-ready (spec `docs/specs/F075-legacy-surface-dispositions.md`, accepted 2026-09-24 via `issues/0122`)
**User Confirmation:** confirmed (「先做2,3,4」, 2026-09-24 — standing directive, 0066 close-out follow-ups 按推荐)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20/§52 Rules 4–7; ADR-0101 decision 4 (declared, not improvised); map `issues/0066` close-out (the last old-surface disposition)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F075-legacy-surface-dispositions.md` |
| Legacy frozen writer (read-only source of truth for the shape) | `scripts/lib/core/task-execution.js` (`persistExecutionArtifacts`) |
| New disposition core + CLI | `scripts/lib/harness/legacy-core.js`, `scripts/lib/harness/harness-commands.js` (`legacy` subverb), `scripts/lib/command-registry.js` |
| Tests | `tests/unit/harness-legacy.test.js` (frozen fixtures, disclosed) |

## Slices

1. **The disposition view** (this delivery, one slice): `harness legacy [task --task
   <id> | profile]` + the three-row table; the closed nearest-neighbor status map;
   per-artifact fail-closed reads; the projection is a view (`legacy: true`), never a
   record; two new error codes registered.
2. **Gates + review** (same batch): frozen-fixture conformance, full gates, docs
   lockstep, stage-7 two-axis review, ticket-split commits.

## Verification

- Focused: `node --test tests/unit/harness-legacy.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence schema

Recorded in `feature_list.json` F075 `evidence[]`. The acceptance demo: a legacy task
with all three frozen artifacts projects the full mapping block (`legacy: true`, the
nearest-neighbor state, the Evidence bundle citation, the receipt-vocabulary result);
a missing or corrupt artifact refuses with the path named; `profile` declares its
absence as a deletion candidate.

## Non-goals

Deleting any old surface (explicit user decision); adopting legacy tasks as real
Runs; §52 Rules 1–3; MCP projection.
