# F074 Plan: Harness H6 — Control Plane (the Aggregated Surface over the Shared Core)

**Feature:** F074
**Status:** implementation-ready (spec `docs/specs/F074-harness-h6-control-plane.md`, accepted 2026-09-24 via `issues/0120`)
**User Confirmation:** confirmed (「继续」, 2026-09-24 — standing directive per map `issues/0066` 执行带入)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20/§26/§35/§44; F063 tier mechanism; F065–F073 as the landed cores
**Wayfinder map:** `issues/0066` (H6 named in fog, now graduated — the last H-phase)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F074-harness-h6-control-plane.md` |
| Aggregated cores (composed verbatim) | `run-core.js`, `event-ledger.js`, `tool-core.js`, `eval-commands.js` (the F058 surface) |
| CLI adapter | `scripts/lib/harness/harness-commands.js` (five new subverbs), `scripts/lib/command-registry.js` (help + usage) |
| Tests | `tests/unit/harness-control-plane.test.js` |

## Slices (tracer bullets)

1. **The five subverbs** (this delivery, one slice — the aggregation is thin by
   design): `trace` (run record + history + admission + ordered trail),
   `events` (run-scoped or whole verified ledger), `policy check` (trail posture,
   report-only), `capabilities` (admitted tools + registry snapshot), `eval`
   (the F058 alias through the same dispatch path; `--run` cites the run's eval
   pointers).
2. **Integration gates** (same batch): conformance (same-citation equality for
   trace/events/capabilities, the eval alias byte-identity, corrupt fail-closed,
   report-only writes-nothing), full gates, docs lockstep, stage-7 two-axis
   review, ticket-split commits.

## Verification per slice

- Focused: `node --test tests/unit/harness-control-plane.test.js` plus the
  untouched harness suites (their passing unmodified IS the compatibility gate).
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen`.

## Evidence schema

Recorded in `feature_list.json` F074 `evidence[]`. The acceptance demo (§44 gate):
`amber harness trace|events|policy check|capabilities|eval` against a real target —
each view equals what the underlying cores return directly, `harness eval`'s body is
byte-identical to `amber eval run`'s, and every pre-existing subverb passes its
existing tests unmodified.

## Non-goals

`harness execution terminate` (crosses the settled F070 BLOCK posture — needs its own
spec decision); `harness diff <run-a> <run-b>` (H5 replay lineage, own ticket); MCP
projection; reshaping any existing command; charter/homepage change.
