# F074 Plan: Harness H6 — Control Plane (the Aggregated Surface over the Shared Core)

**Feature:** F074
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「继续」, 2026-09-24 — standing directive per map `issues/0066` 执行带入 (`issues/0120`)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20/§26/§35/§44; F063 tier mechanism; F065–F073 as the landed cores
**Wayfinder map:** `issues/0066` (H6 named in fog, now graduated — the last H-phase)

## High Level Design

- Context: every Harness capability existed as its own subverb, but a reader inspecting a run had
  to compose the trail, the policy posture, the admitted tools and the eval pointers by hand. The
  aggregated surface answers those questions from one place without adding a second derivation.
- Proposed approach: five read-only subverbs over the existing cores — `trace`, `events`,
  `policy check`, `capabilities`, `eval`. Each composes the core verbatim; the aggregation is thin
  by design, and the test that proves it is that each view equals what the underlying core
  returns directly.
- Risks: a convenience surface invites a second implementation, so every subverb must call the
  existing core rather than re-derive; `harness eval` must be a governed alias with byte-identical
  output rather than a parallel evaluator; and report-only subverbs must write nothing, including
  no implicit events.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F074-harness-h6-control-plane.md, docs/adr/0101-run-unit-of-auditable-execution.md, docs/adr/0102-harness-event-ledger-via-ledger-family.md, docs/agents/dev-workflow.md
- review: docs/specs/F074-harness-h6-control-plane.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

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

## Resume Checkpoint

- Resume Point: both slices are delivered; the feature carries two evidence entries (the `issues/0120` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F074, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F074-harness-h6-control-plane.md` and the `issues/0119`–`0120` logs; never hand-edit the F074 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- `amber harness trace|events|policy check|capabilities` each return exactly what the underlying core returns directly, proven by same-citation equality.
- `harness eval` is a governed alias whose body is byte-identical to `amber eval run`, and `--run` cites the run's eval-prefixed pointers.
- Every pre-existing subverb passes its existing tests unmodified: their passing unmodified is the compatibility gate.
- Report-only subverbs write nothing, and a corrupt record fails closed rather than rendering a partial view.
- Existing guardrails still pass, and the current phase boundary is unchanged: no new derivation, no reshaping of any existing command, no MCP projection, no charter or homepage change.

## Verification

- Focused: `node --test tests/unit/harness-control-plane.test.js` plus the
  untouched harness suites (their passing unmodified IS the compatibility gate).
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen`.

## Evidence Schema

- Command: `dual-axis review (issues/0119)`
- Result: pass — Spec axis 7 met / 2 partial / 0 contradicts; Standards axis pass-with-findings (2xP2 + 4xP3), all 9 findings adjudicated fixed
- Date: 2026-09-24
- Notes: the acceptance demo is the §44 gate — each view equal to what the underlying cores return directly, `harness eval`'s body byte-identical to `amber eval run`, and every pre-existing subverb passing its existing tests unmodified.

## Non-goals

`harness execution terminate` (settled by F078 as an explicit zero-write refusal: no
cancellable live handle, no fake cancel+release); `harness diff <run-a> <run-b>` (H5
replay lineage, own ticket); MCP
projection; reshaping any existing command; charter/homepage change.
