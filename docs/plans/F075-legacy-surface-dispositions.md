# F075 Plan: Harness §52 Legacy Surface Dispositions (task / result / profile inspect)

**Feature:** F075
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (spec `docs/specs/F075-legacy-surface-dispositions.md`, accepted 2026-09-24 via `issues/0122`)
User Confirmation: confirmed
**Confirmation source:** 「先做2,3,4」, 2026-09-24 — standing directive, `issues/0066` close-out follow-ups 按推荐 (`issues/0122`)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20/§52 Rules 4–7; ADR-0101 decision 4 (declared, not improvised); map `issues/0066` close-out (the last old-surface disposition)

## High Level Design

- Context: old task/result/profile artifacts still exist on disk, and §52 requires a declared
  disposition rather than an improvised one. Without a declared mapping, a reader of an old task
  cannot tell which of its facts survive into the Run vocabulary and which do not.
- Proposed approach: one read-only disposition view over the frozen legacy artifacts, using a
  closed nearest-neighbor status map and per-artifact fail-closed reads. The projection is a view
  (`legacy: true`), never a record, so nothing in the new vocabulary is fabricated from an old
  artifact.
- Risks: the legacy writer stays the source of truth for the shape, so the view must read it
  rather than re-derive it; a missing or corrupt artifact must name the path rather than degrade
  to a partial block; and no old surface may be deleted by this slice.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F075-legacy-surface-dispositions.md, docs/adr/0101-run-unit-of-auditable-execution.md, docs/agents/dev-workflow.md
- review: docs/specs/F075-legacy-surface-dispositions.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **The disposition view** (this delivery, one slice): `harness legacy [task --task
   <id> | profile]` + the three-row table; the closed nearest-neighbor status map;
   per-artifact fail-closed reads; the projection is a view (`legacy: true`), never a
   record; two new error codes registered.
2. **Gates + review** (same batch): frozen-fixture conformance, full gates, docs
   lockstep, stage-7 two-axis review, ticket-split commits.

## Resume Checkpoint

- Resume Point: both slices are delivered; the feature carries one evidence entry (the `issues/0122` user direction).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F075, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F075-legacy-surface-dispositions.md` and the `issues/0121`–`0122` logs; never hand-edit the F075 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A legacy task with all three frozen artifacts projects the full mapping block: `legacy: true`, the nearest-neighbor state, the Evidence bundle citation, and the receipt-vocabulary result.
- A missing or corrupt artifact refuses with the path named, rather than degrading to a partial block.
- `profile` declares its absence as a deletion candidate rather than inventing a mapping.
- The projection is a view and never a record: no new Run is fabricated from an old artifact.
- Existing guardrails still pass, and the current phase boundary is unchanged: no old surface is deleted, no legacy task is adopted as a real Run, and §52 Rules 1–3 stay out of scope.

## Verification

- Focused: `node --test tests/unit/harness-legacy.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence Schema

- Command: `user direction (issues/0122)`
- Result: pass — 「先做2,3,4」, standing directive; spec draft -> accepted (F075 §52 legacy surface dispositions)
- Date: 2026-09-24
- Notes: the acceptance demo is a legacy task with all three frozen artifacts projecting the full mapping block, a missing or corrupt artifact refusing with the path named, and `profile` declaring its absence as a deletion candidate.

## Non-goals

Deleting any old surface (explicit user decision); adopting legacy tasks as real
Runs; §52 Rules 1–3; MCP projection.
