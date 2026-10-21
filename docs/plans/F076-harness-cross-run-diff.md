# F076 Plan: Harness Cross-Run Diff (the H5 Replay Lineage's Comparison Across Two Runs)

**Feature:** F076
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (spec `docs/specs/F076-harness-cross-run-diff.md`, accepted 2026-09-24 via `issues/0124`)
User Confirmation: confirmed
**Confirmation source:** 「先做2,3,4」, 2026-09-24 — standing directive, `issues/0066` close-out follow-ups 按推荐 (`issues/0124`)
**Date:** 2026-09-24
**Decision records:** Harness v2 §7/§20/§43; F073 as the staged foundation (its spec named this ticket explicitly); F072's recursive-canonicalization precedent

## High Level Design

- Context: replay answers "does this run still rest on the same world as its records", but
  comparing two runs had no surface. A reader asking "did anything change between these two
  runs" had to diff two replay reports by hand and decide which differences mattered.
- Proposed approach: one diff fold over two frozen records, reusing `deriveAxes` verbatim so the
  comparison speaks the same six-axis vocabulary replay already reports. Each axis is
  `same|differs|only-a|only-b`; the verdict is `equivalent-world|world-drift|incomparable`, and the
  run outcome never enters it.
- Risks: a second derivation would drift from replay's, so the axis facts must come from the
  exported derivation; one-sided facts must be disclosed rather than guessed into the verdict; and
  comparing runs from unrelated tasks must refuse instead of producing a meaningless diff.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F076-harness-cross-run-diff.md, docs/specs/F073-harness-h5-eval-replay.md, docs/agents/dev-workflow.md
- review: docs/specs/F076-harness-cross-run-diff.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **The diff fold** (this delivery, one slice): `diffRuns` over two frozen records —
   per-axis `same | differs | only-a | only-b`, verdict `equivalent-world |
   world-drift | incomparable`, outcome never in the verdict, response-only,
   same-task discipline.
2. **Gates + review** (same batch): conformance (axis facts equal replay's; the real
   tool-change world-drift; bytes pinned), full gates, docs lockstep, stage-7
   two-axis review, ticket-split commits.

## Resume Checkpoint

- Resume Point: both slices are delivered; the feature carries one evidence entry (the `issues/0124` user direction).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F076, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F076-harness-cross-run-diff.md` and the `issues/0123`–`0124` logs; never hand-edit the F076 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- Two runs under the same fixtures diff as `equivalent-world`.
- A tool admitted between them flips the tools axis to `differs`, and the verdict becomes `world-drift`.
- One-sided facts are disclosed as `only-a`/`only-b` and never guessed into the verdict; the run outcome never enters the verdict.
- Each axis's fact equals what replay reports for that axis, proven by conformance.
- The diff is response-only: nothing is stored as a record.
- Existing guardrails still pass, and the current phase boundary is unchanged: no stored diffs, no cross-task diffs, no MCP projection.

## Verification

- Focused: `node --test tests/unit/harness-diff.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence Schema

- Command: `user direction (issues/0124)`
- Result: pass — 「先做2,3,4」, standing directive; spec draft -> accepted (F076 cross-run diff)
- Date: 2026-09-24
- Notes: the acceptance demo is two same-fixture runs diffing `equivalent-world`, a tool admitted between them flipping the tools axis to `differs` → `world-drift`, and one-sided facts disclosed as `only-a`/`only-b`.

## Non-goals

Storing diffs as records; cross-task diffs (unrelated declared tasks refuse);
execution `terminate` (settled by F078 as an explicit zero-write refusal); MCP
projection.
