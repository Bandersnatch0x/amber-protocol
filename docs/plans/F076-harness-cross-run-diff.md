# F076 Plan: Harness Cross-Run Diff (the H5 Replay Lineage's Comparison Across Two Runs)

**Feature:** F076
**Status:** implementation-ready (spec `docs/specs/F076-harness-cross-run-diff.md`, accepted 2026-09-24 via `issues/0124`)
**User Confirmation:** confirmed (「先做2,3,4」, 2026-09-24 — standing directive, 0066 close-out follow-ups 按推荐)
**Date:** 2026-09-24
**Decision records:** Harness v2 §7/§20/§43; F073 as the staged foundation (its spec named this ticket explicitly); F072's recursive-canonicalization precedent

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F076-harness-cross-run-diff.md` |
| Composed seam (the one derivation) | `scripts/lib/harness/replay-core.js` (`deriveAxes` — composed verbatim, exported for the diff) |
| CLI | `scripts/lib/harness/harness-commands.js` (`diff` subverb), `scripts/lib/core/cli-output.js` (`--from` flag), `scripts/lib/command-registry.js` |
| Tests | `tests/unit/harness-diff.test.js` (real two-run fixtures incl. the F052 tool-change case) |

## Slices

1. **The diff fold** (this delivery, one slice): `diffRuns` over two frozen records —
   per-axis `same | differs | only-a | only-b`, verdict `equivalent-world |
   world-drift | incomparable`, outcome never in the verdict, response-only,
   same-task discipline.
2. **Gates + review** (same batch): conformance (axis facts equal replay's; the real
   tool-change world-drift; bytes pinned), full gates, docs lockstep, stage-7
   two-axis review, ticket-split commits.

## Verification

- Focused: `node --test tests/unit/harness-diff.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence schema

Recorded in `feature_list.json` F076 `evidence[]`. The acceptance demo: two runs under
the same fixtures diff `equivalent-world`; a tool admitted between them (the F052
fixture chain) flips the tools axis to `differs` → `world-drift`; one-sided facts are
disclosed as `only-a`/`only-b`, never guessed into the verdict.

## Non-goals

Storing diffs as records; cross-task diffs (unrelated declared tasks refuse);
execution `terminate` (still deferred with disclosure); MCP projection.
