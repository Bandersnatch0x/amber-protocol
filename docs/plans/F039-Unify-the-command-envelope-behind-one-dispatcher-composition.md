# Plan: Unify the command envelope behind one dispatcher composition

Feature: F039
Status: accepted
User Confirmation: confirmed

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

- [x] Slice 1 (core + pilot): red-first unit tests for defineCommand (routing, aliases, unknown, envelope shape, exit-code rules, bypassPrint), implement it in subcommand-dispatcher.js or command-helpers.js, migrate hooks-commands.js (2 envelope sites, 5 routing branches — smallest module) as the byte-compatibility pilot. [commit 1cfc86d]
- [x] Slice 2 (batch A): org-audit-commands.js (6), knowledge-commands.js (7), phase-commands.js (6), memory-commands.js (8, delete private ok()/fail() pair). [commit 796a9c6]
- [x] Slice 3 (batch B): projection-commands.js (12), sync-commands.js (15 — byte-identical envelope constraint), knowledge-plan/adapters/command.js (5). [commit fdda9b5]
- [x] Slice 4 (batch C): context/adapters/command.js (27, delete private errResult/unknownAction), feature-commands routing (12), workflow-assessment (4), governance-commands (3). [commit 2b5666e]
- [ ] Slice 5 (router convergence) — DEFERRED with rationale: the 25 remaining `bypassPrint: !args.json` sites all live in command-dispatcher.js itself, the top-level router whose job is envelope shaping; the four-conventions drift across the 11 domain modules (the survey's actual finding) is resolved. knowledge-plan/adapters/command.js stays on its legacy envelope by design: defineCommand always emits bypassPrint on the known path and defaults warnings: [], both pinned by its adapter tests, and its default-action routing (undefined → scaffold) is inexpressible — migrating it would require either dispatcher changes or editing pinned tests.

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

- Slice 1 red-first: `rtk node --test tests/unit/define-command.test.js` → 12/13 fail pre-implementation (only the createSubcommandDispatcher regression passed) → 13/13 after.
- Per-batch differential verification: pre-migration envelope snapshots per module, re-run post-migration, JSON.stringify equality (key-order identity). Batch A: 61 comparisons byte-identical across success/failure/corrupt-ledger/json/identity-gate/chained-flows/unknown. Batch B: 46 scenarios (21 projection + 25 sync), byte-identical except documented CLI-equivalent unknown-path exitCode presence. Batch C: 22 dispatch pinning tests green, suites green.
- Unit sweep after each batch: 1897 → 1913 → 1923 → 1942 tests, 0 fail every time.
- Full suite after batch C: `rtk node --test` → 2668 tests / 2610 pass / 58 fail = baseline (one intermediate run showed 59 — the known apps/web flake, re-run clean).
- Session evidence: `amber session verify --execute` runs `npm test` for real against feature F039.

## Evidence Schema

- Command: `rtk node --test` (full suite)
- Result: 2668 tests / 2610 pass / 58 fail (baseline-identical + 30 new tests across slices)
- Date: 2026-08-25
- Notes: defineCommand in subcommand-dispatcher.js; 11 modules migrated (hooks, org-audit, knowledge, phase, memory, projection, sync, context, feature, workflow-assessment, governance); knowledge-plan stopped on three inexpressible pinned envelopes; Slice 5 (router-internal sites) deferred with rationale above. Commits 1cfc86d, 796a9c6, fdda9b5, 2b5666e.
