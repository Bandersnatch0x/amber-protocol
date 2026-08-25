# Plan: Publish the sync transport report as a structured schema-governed contract

Feature: F040
Status: accepted
User Confirmation: confirmed

## Goal

sync session push emits a schemaVersioned report whose proposedOps are structured operations (verb + confined paths + commit message), self-validated against schemas/sync-transport-report.schema.json and machine-consumable via --json

## High Level Design

- Context: ADR-0020 (accepted 2026-08-25) adjudication 5 / Option 3: the preparation report becomes a stable, schema-governed, ADR-0012-versioned machine-readable artifact, and `proposedOps` must become structured operations (verb, args, confined paths), not shell strings — parsing strings into execution is an injection-shaped hazard the contract must remove. Today `pushEnvelopes` (scripts/lib/core/sync-session.js:122) returns an unversioned object with `proposedOps: string[]` (`"git add .amber/sync"`, `git commit -m "..."`, `"git push"`), rendered verbatim by sync-commands.js:141 and pinned as strings by three test files.
- Proposed approach: publish `schemas/sync-transport-report.schema.json` (draft-07, `schemaVersion: "1.0.0"` closed enum, `additionalProperties: false`), with `proposedOps` a oneOf of `{verb: "add", paths: string[]}` / `{verb: "commit", message: string}` / `{verb: "push"}` — closed verb set, no shell strings. Add the schema-contract adapter `scripts/lib/core/sync-transport-report-contract.js` (same pattern as sync-envelope-contract.js). `pushEnvelopes` adds `schemaVersion`, emits structured ops, and self-validates its own output against the schema, folding any violation into `errors` (fail-closed). The push handler includes the report in its result body so `--json` yields the machine-readable artifact; text mode renders display strings derived deterministically from the structured ops (never parsed back).
- Risks: three test files pin `proposedOps` as strings (sync-session.test.js, amber-cli-sync-session.test.js, amber-cli-team-hub-tracer.test.js) — updated as the red-first inversion. The team-hub tracer JSON shape grows a `report` field — additive, existing assertions keep passing. Path patterns in the schema stay permissive (plain strings): the state-dir seam (F036) can relocate `.amber/sync`, so a `^\.amber/` regex in the schema would fail-closed on relocated state; confinement is structural (verb + explicit paths field), not regex-based.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/adr/0020-governed-live-git-transport.md, docs/specs/sync-envelope-contract.md, docs/adr/0012-protocol-and-schema-versioning.md
- review: docs/adr/0020-governed-live-git-transport.md, docs/specs/sync-envelope-contract.md

## Vertical Slices

- [x] Slice 1 (contract): red-first schema tests in tests/unit/sync-transport-report-contract.test.js (valid minimal report; bad schemaVersion; op without verb; add without paths; commit without message; unknown verb; additional property; empty valid report with no ops), then schemas/sync-transport-report.schema.json + scripts/lib/core/sync-transport-report-contract.js. [16 tests, 13 green / 3 producer-invariant red at the slice boundary]
- [x] Slice 2 (producer): pushEnvelopes emits `schemaVersion: "1.0.0"` + structured proposedOps, self-validates against the contract (invariant test: every produced report validates); sync-commands.js push handler derives display strings from structured ops and includes `report` in the result body for --json consumers; update the three pinning test files; update the sync help text and docs/specs/sync-envelope-contract.md proposedOps row; note the published contract in ADR-0020. Also updated the schemas-count guard (18 → 19).

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F040-Publish-the-sync-transport-report-as-a-structured-schema-governed-contract.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- schemas/sync-transport-report.schema.json exists, is draft-07 with a closed schemaVersion enum and additionalProperties: false, and proposedOps items are structured oneOf operations with a closed verb set (add/commit/push) — no shell strings anywhere in the contract.
- pushEnvelopes output always validates against the schema (self-check invariant; violations surface as errors, exit 1).
- `amber sync session push --json` surfaces the schema-valid report object; text-mode output still renders the human-readable proposed operations (derived, not parsed).
- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/sync-transport-report-contract.test.js
- npm test

## Evidence Schema

- Command: `npm test` (session verify --execute) and raw `node --test` (baseline comparison)
- Result: npm test → 2626 tests / 2626 pass / 0 fail (exit 0, 121s); raw node --test → 2684 tests / 2626 pass / 58 fail = pre-existing apps/web baseline, +16 new contract tests, zero regressions
- Date: 2026-08-25
- Notes: schema + adapter + producer + renderer + CLI surface + docs (spec table, help text, ADR-0020 adjudication-5 publication note). Session 0e70697a-e449-4ca8-9e4d-5f33434e9c10, handoff 100/100. Stage A (F041) will narrow the add op's paths to `.amber/sync/envelopes/` per ADR-0020 adjudication 4 — a schema-evidenced shape change on top of this contract.
