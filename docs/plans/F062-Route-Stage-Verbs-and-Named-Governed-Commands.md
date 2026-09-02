# Plan: Route Stage Verbs and Named Governed Commands

Feature: F062
Status: implementation-ready
User Confirmation: pending

## Goal

A Session can resolve a Route verb stage to one registered F052 capability, run or settle one governed attempt through the existing gates, and advance its single cursor only from a valid recorded result.

## High Level Design

- Context: Routes need verb stages whose execution is governed, not free-form. ADR-0029 closes the gap between Route definitions (data) and the F052 capability registry / F056 external lifecycle (code): a Route supplies a capability pin and can never select its own adapter, and a Session advances at most one verb stage per governed attempt.
- Proposed approach: four vertical slices — (1) `commandId` resolution in `governed-runner` against `.amber/governance/rules.json` (unique allow rule with `match=exact`; caller-supplied command text is never a fallback); (2) Route schema verb-stage targets + route-commands resolution; (3) CLI/MCP wiring (`session run/settle`, action-types `amber.session.run/settle`); (4) the `session-stage-runner` deep module owning lease verification, adapter dispatch, the host-agent pending lifecycle, settlement idempotence, and ledger-owned cursor progression.
- Risks: the adapter table ships empty (ADR-0029 §7) so every verb stage fails closed under `AMBER_E_STAGE_ADAPTER_UNAVAILABLE` until a pin lands by reviewed code change — intended, but early adopters see refusal, not execution. The settle binding contract (attempt id + idempotency key from the pending request, not the caller's claim) is the seam most likely to need follow-up hardening.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/F062-route-stage-verbs-named-commands.md, docs/adr/0029-named-governed-commands-and-stage-verbs.md, docs/specs/F052-controlled-runner-environment-boundaries.md, docs/specs/F056-registered-external-side-effects.md
- review: docs/specs/F062-route-stage-verbs-named-commands.md, docs/adr/0029-named-governed-commands-and-stage-verbs.md, docs/CLI_REFERENCE.md

## Vertical Slices

- [x] Slice 1: `commandId` resolution in governed-runner (unique allow rule, match=exact, no caller-text fallback) with unit tests.
- [x] Slice 2: Route schema verb-stage targets and route-commands capability resolution.
- [x] Slice 3: CLI + MCP wiring — `session run/settle` commands, action-types `amber.session.run/settle`, error-catalog entries.
- [x] Slice 4: `session-stage-runner` deep module — lease verification, closed adapter table, host-agent pending lifecycle, settlement idempotence, ledger-owned cursor.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F062-Route-Stage-Verbs-and-Named-Governed-Commands.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- A verb stage with a registered pin runs exactly one governed attempt behind owner + lease proof, explicit approval, and the session ledger; `host-agent` records a pending request and stops; `external` is refused toward the F056 lifecycle.
- The cursor advances only from a valid recorded settlement (`succeeded`, or `skipped` for an optional stage); duplicate settles are idempotent.
- Existing Amber guardrails still pass: full test suite, manifests, doctor, gen:agents:check.

## Verification

- node --test tests/unit/governed-runner.test.js tests/unit/route-commands.test.js tests/unit/session-stage-runner.test.js
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
