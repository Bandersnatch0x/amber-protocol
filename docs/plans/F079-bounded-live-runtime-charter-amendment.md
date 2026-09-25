# F079 Plan: Bounded Live Runtime Charter Amendment

**Feature:** F079
**Status:** implementation-ready (spec `docs/specs/F079-bounded-live-runtime-charter-amendment.md`; accepted via `issues/0130`)
**User Confirmation:** confirmed (「全部按推荐」, 2026-09-24)
**Date:** 2026-09-24
**Decision records:** proposed ADR-0103; Harness v2 §27/§36/§51/§55; Charter §7

## Context manifests

| Role | Paths |
| --- | --- |
| Authority draft | `docs/adr/0103-bounded-live-runtime-and-cancellation-authority.md` |
| Normative spec | `docs/specs/F079-bounded-live-runtime-charter-amendment.md` |
| Effective Charter after acceptance | `docs/TEAM_REPLICATION_CHARTER.md` |
| Boundary docs | `docs/adr/0003-governance-gated-execution.md`, `docs/adr/0005-experimental-execution-removal.md`, `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md`, `docs/product/LOOP.md`, `AGENTS.md` |
| Conformance | new `tests/unit/h7-charter-boundary.test.js` |

## Slices

1. Draft ADR/spec/charter patch and obtain exact HITL approval.
2. Apply accepted amendment across Charter and boundary docs; keep README unchanged.
3. Add cross-document conformance and existing-loop `schedulesJobs:false` census.
4. Full gates + two-axis review + commit. Then F080 H7 starts.

## Verification

- Focused: `node --test tests/unit/h7-charter-boundary.test.js tests/unit/security-governance-packs.test.js`.
- Full gates: test/manifests/doctor/gen:agents:check/lint/format/docs.

## Evidence schema

F079 evidence records the exact HITL boundary, README byte pin, existing workflow-pack
census, focused tests, full gates, and dual-axis review.

## Non-goals

Runtime code, daemon/process management, schedule schema, cancellation signals, or
positioning flip.
