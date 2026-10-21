# F079 Plan: Bounded Live Runtime Charter Amendment

**Feature:** F079
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「全部按推荐」, 2026-09-24 (`issues/0130`)
**Date:** 2026-09-24
**Decision records:** ADR-0103; Harness v2 §27/§36/§51/§55; Charter §7

## High Level Design

- Context: the Charter's standing rule kept every scheduler forbidden, but the H7 maintenance
  runtime needed one narrow exception to exist at all. Authority has to move before runtime code
  is written, or the code ships with no basis.
- Proposed approach: draft ADR-0103, the spec and the Charter patch together, obtain an exact
  HITL approval, then apply the accepted amendment across the Charter and every boundary document
  that states the old rule. README stays byte-identical until the separate §55 gate.
- Risks: a bounded exception written loosely widens by accident, so the amendment fixes the
  authority tuple (`executesAnything=false`, `schedulesJobs=true`, `dispatchesAgents=false`,
  `writesExternalSystems=false`) and keeps existing Loop/Workflow contracts unscheduled; and any
  boundary document left unpatched would contradict the Charter.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/adr/0103-bounded-live-runtime-and-cancellation-authority.md, docs/specs/F079-bounded-live-runtime-charter-amendment.md, docs/TEAM_REPLICATION_CHARTER.md, docs/adr/0003-governance-gated-execution.md, docs/adr/0005-experimental-execution-removal.md
- review: docs/specs/F079-bounded-live-runtime-charter-amendment.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/product/LOOP.md, CONTEXT.md

## Vertical Slices

1. Draft ADR/spec/charter patch and obtain exact HITL approval.
2. Apply accepted amendment across Charter and boundary docs; keep README unchanged.
3. Add cross-document conformance and existing-loop `schedulesJobs:false` census.
4. Full gates + two-axis review + commit. Then F080 H7 starts.

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries two evidence entries (the `issues/0130` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F079, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F079-bounded-live-runtime-charter-amendment.md`, ADR-0103 and the `issues/0129`–`0130` logs; never hand-edit the F079 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- ADR-0103 is accepted and states the bounded exception with the exact authority tuple.
- The Charter and every boundary document that stated the old rule are patched consistently, and the cross-document conformance test asserts it.
- Existing Loop and Workflow contracts remain unscheduled: the census shows `schedulesJobs: false` for every existing pack.
- README stays byte-identical, because the positioning flip is a separate §55 gate.
- Existing guardrails still pass, and the current phase boundary is unchanged: no runtime code, no daemon or process management, no schedule schema, no cancellation signals.

## Verification

- Focused: `node --test tests/unit/h7-charter-boundary.test.js tests/unit/security-governance-packs.test.js`.
- Full gates: test/manifests/doctor/gen:agents:check/lint/format/docs.

## Evidence Schema

- Command: `dual-axis review (issues/0129)`
- Result: pass — Spec axis 14 met / 0 partial / 0 contradicts; Standards pass-with-findings (2xP3), both fixed before the final full gate
- Date: 2026-09-24
- Notes: the evidence also records the exact HITL boundary, the README byte pin, the existing workflow-pack census, the focused tests and the full gates.

## Non-goals

Runtime code, daemon/process management, schedule schema, cancellation signals, or
positioning flip.
