# Plan: Unify the command envelope behind one dispatcher composition

Feature: F039
Status: implementation-ready
User Confirmation: pending

## Goal

defineCommand (createSubcommandDispatcher + shapeResult composed) owns routing, aliasing, envelopes, and exit-code derivation; the 11 command modules migrate to handler tables and the four competing envelope conventions collapse into one

## High Level Design

- Context: survey Finding 1 (docs/reviews/architecture-survey-2026-08-24.md). `shapeResult` (command-helpers.js:27, 7 dispatcher call sites) and `createSubcommandDispatcher` (subcommand-dispatcher.js:23, 1 adapter) exist but ~113 envelope sites across 11 command modules hand-roll the envelope in four competing conventions, with ~64 hand-rolled routing branches and per-module exit-code derivation (`result.ok ? 0 : 1`, `errors.length ? 1 : 0`, hardcoded literals).
- Proposed approach: one composition, `defineCommand({ command, actions, aliases, handlers, unknown })`, where each handler returns only a body `{text|data, errors, warnings, code?, exitCode?}` and the dispatcher owns routing, alias resolution, the envelope (target from args, errors/warnings defaulted), and exit-code derivation in one place (explicit body.exitCode > body.ok === false > errors present > 0). Migrate modules in batches, smallest-first, each batch green before the next.
- Risks: envelope byte-compatibility is pinned by tests everywhere; some sites deliberately set `bypassPrint: false` for JSON mode or hardcode exit codes; command-dispatcher.js:280-290 duplicates payload text into errors. Mitigation: pilot on the smallest module first to prove byte-compatibility; per-batch suite runs; full-suite baseline comparison after each batch.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/reviews/architecture-survey-2026-08-24.md
- review: docs/reviews/architecture-survey-2026-08-24.md

## Vertical Slices

- [ ] Slice 1 (core + pilot): red-first unit tests for defineCommand (routing, aliases, unknown, envelope shape, exit-code rules, bypassPrint), implement it in subcommand-dispatcher.js or command-helpers.js, migrate hooks-commands.js (2 envelope sites, 5 routing branches — smallest module) as the byte-compatibility pilot.
- [ ] Slice 2 (batch A): org-audit-commands.js (6), knowledge-commands.js (7), phase-commands.js (6), memory-commands.js (8, delete private ok()/fail() pair).
- [ ] Slice 3 (batch B): projection-commands.js (12), sync-commands.js (15 — byte-identical envelope constraint), knowledge-plan/adapters/command.js (5).
- [ ] Slice 4 (batch C): context/adapters/command.js (27, delete private errResult/unknownAction), feature-commands routing (12), workflow-assessment (4), governance-commands (3).
- [ ] Slice 5 (router convergence): command-dispatcher.js itself (21 sites) onto the same shaper; delete the maintenance adapter's bespoke envelope if subsumed.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F039-Unify-the-command-envelope-behind-one-dispatcher-composition.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- One envelope convention: grep finds no hand-rolled `{ result: { target: args.target, ... }, exitCode, bypassPrint: !args.json }` literals in the migrated command modules.
- The four conventions (shapeResult-only, inline literals, memory's ok()/fail(), context's errResult/unknownAction) collapse to defineCommand bodies.
- Every migrated module's existing suites stay green per batch (envelope byte-compatibility); full suite matches the 58-known-failure baseline after each slice.

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- rtk node --test on defineCommand unit tests and every migrated module's suite after each batch
- rtk node --test full suite matches the 58-known-failure baseline after each batch

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
