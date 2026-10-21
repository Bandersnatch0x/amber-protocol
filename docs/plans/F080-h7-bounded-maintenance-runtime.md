# F080 Plan: H7 Bounded Maintenance Runtime

**Feature:** F080
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (spec `docs/specs/F080-h7-bounded-maintenance-runtime.md`; accepted via `issues/0132`)
User Confirmation: confirmed
**Confirmation source:** 「全部按推荐」, 2026-09-24 (`issues/0132`)
**Date:** 2026-09-24
**Decision records:** ADR-0103; Harness v2 §27/§36/§47–§49; F079

## High Level Design

- Context: F079 moved the authority; F080 is the runtime that authority permits. The point is one
  scheduler that only runs closed-registry, deterministic Amber-internal maintenance jobs — not a
  general scheduler that happens to start small.
- Proposed approach: a schedule contract resolved against a human Decision, a single closed job
  (`draft-spec-review`), a deterministic tick with budget and no-progress stops, and a fenced
  daemon whose stale owner is recovered rather than trusted. Every record rides the existing
  Harness ledger as additive event kinds.
- Risks: the registry must stay closed, or the exception widens into a general platform; the
  daemon fence must prevent two owners, or a tick runs twice; and budget/no-progress stops must be
  enforced rather than advisory.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F080-h7-bounded-maintenance-runtime.md, docs/adr/0103-bounded-live-runtime-and-cancellation-authority.md, schemas/event.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F080-h7-bounded-maintenance-runtime.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/product/LOOP.md, CONTEXT.md

## Vertical Slices

1. Schedule contract + human Decision resolution + immutable records + runtime event kinds.
2. Closed `draft-spec-review` job + tick + proposal records + budget/no-progress/revoke.
3. Fenced daemon start/stop/status + stale-owner recovery.
4. CLI/docs/feature lockstep, full gates, dual-axis review, commit.

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries two evidence entries (the `issues/0132` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F080, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F080-h7-bounded-maintenance-runtime.md`, ADR-0103 and the `issues/0131`–`0132` logs; never hand-edit the F080 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A schedule resolves only against a human Decision, and its records are immutable once written.
- The job registry stays closed: `draft-spec-review` is the only schedulable job, and no target command, agent, workflow or external effect becomes schedulable.
- A tick is deterministic, and the budget and no-progress stops actually halt the job rather than merely reporting.
- The daemon is fenced: one owner at a time, and a stale owner is recovered instead of trusted.
- The runtime event kinds are additive to the existing Harness ledger, with no second hash chain.
- Existing guardrails still pass, and the current phase boundary is unchanged: no commands, agents, workflows, effects, document edits or distributed runtime.

## Verification

- Focused: `node --test tests/unit/harness-runtime.test.js` plus the Harness event and schema suites.
- Full gates: `npm test`, `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`, `npm run lint`, `npm run format:check`.

## Evidence Schema

- Command: `dual-axis review (issues/0131)`
- Result: pass — Spec axis 18 met / 0 partial / 0 contradicts; Standards pass-with-findings (1xP2 + 3xP3), all fixed before the final full gate
- Date: 2026-09-24
- Notes: the acceptance demo is a closed `draft-spec-review` job scheduled by a Decision, one deterministic tick producing a proposal record, and a fenced daemon recovering a stale owner.

## Non-goals

Commands, agents, workflows, effects, document edits, distributed runtime, F081 cancel,
F082 positioning.
