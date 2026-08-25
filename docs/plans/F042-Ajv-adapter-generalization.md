# Plan: Ajv adapter generalization

Feature: F042
Status: accepted
User Confirmation: confirmed

## Goal

One schema-contract seam (`scripts/lib/core/schema-contract.js`) owns every JSON-schema compile and validation: cached compiled validators, `ajv-formats` + the hand-registered `date-time` format registered once, and the generalized `formatErrors`. No module outside the seam instantiates Ajv; the 13 private adapters collapse to one-line specializations or direct calls.

## High Level Design

- Context: Architecture survey Finding 3 (docs/reviews/architecture-survey-2026-08-24.md) — 13 `new Ajv` constructions in 12 files, each with its own schema-path join, lazy-compile dance, and error mapper. Drift already shipped: `session-manifest.js` and `validate-route.js` use `new Ajv()` WITHOUT `allErrors: true` (first-error-only surfaces), format registration is inconsistent (8 files addFormats, `sync-envelope-contract.js` hand-registers `date-time`, the rest register nothing), and the error-shaping mapper is re-typed at ~14 sites. This is the same move `jsonl.js` made for ledgers (architecture review #4) and the seam-adoption ritual this repo already knows (MEMORY.md): one adapter module, red-first shape tests, a guard test against bypasses, per-consumer differential snapshots.
- Proposed approach: new `scripts/lib/core/schema-contract.js` exporting `validate(schemaName, data, options) -> {valid, errors}` (schemaName resolved against `schemas/`), `compileSchema(schemaName)` (cache access), and `formatErrors(ajvErrors, label)` generalized from sync-envelope-contract (the `label` defaults to the schema name's noun). One shared Ajv instance, `allErrors: true` always, `ajv-formats` registered plus the strict RFC 3339 `date-time` format (ajv-formats' `date-time` is full RFC 3339; the hand-rolled one in sync-envelope-contract stays as a registered override to keep byte-identical behavior for the envelope contract — or if identical in behavior, formats alone suffices; tests decide). Migration per consumer: delete the local Ajv/lazy-compile/format plumbing, call `validate(...)`; error-string prefixes tests may pin are normalized per the survey's "only design work" note — each consumer keeps its public error strings byte-identical where tests pin them, by passing its existing label/prefix to `formatErrors`. Consumers: context-benchmark, context-ingest, context-loadout, context-request, context-source-adapter, sync-envelope-contract, sync-transport-report-contract, knowledge-plan/internal/validate, mcp-invocation-coordinator, mcp-registry-loader, memory-commands, session-manifest, validate-route. Special cases: `session-manifest.js` and `validate-route.js` currently compile eagerly at module load and THROW on schema-load failure (fail-fast startup); they migrate to the shared cache with the same throw-on-load semantics preserved via an eager `compileSchema` call at module scope. `mcp-registry-loader.js` validates dynamically-provided schemas (not files under schemas/) — it takes a `compileInline(schema)` export rather than schemaName.
- Risks: behavior deltas are the point (allErrors everywhere, formats everywhere) but each one must be intentional and test-pinned — a consumer whose tests pinned first-error-only output would surface immediately; differential snapshots before migration capture current error strings per consumer and the migrated output is compared, with deliberate deltas (more errors now reported) documented in the plan evidence. `session-manifest`'s eager-throw startup contract must not become lazy. Ajv instance sharing is safe (validators are stateless after compile) but the seam must never re-register formats (idempotence test). Guard test: repo-wide scan asserting no `new Ajv` / `require("ajv")` outside schema-contract.js (and its own test file).

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/reviews/architecture-survey-2026-08-24.md
- review: docs/reviews/architecture-survey-2026-08-24.md

## Vertical Slices

- [x] Slice 1 (seam + shape tests): red-first `tests/unit/schema-contract.test.js` — validate() resolves schemaName against schemas/, caches compiled validators (second call hits cache), returns {valid, errors[]}; formatErrors(ajvErrors, label) generalizes sync-envelope-contract's mapper (all keyword branches); format registration is idempotent; allErrors surfaces multiple violations; unknown schemaName fails closed with a typed error. Implement `scripts/lib/core/schema-contract.js`.
- [x] Slice 2 (exemplar migration + guard): migrate `sync-envelope-contract.js` and `sync-transport-report-contract.js` to one-line specializations over the seam (public functions and error strings byte-identical — their tests must pass unmodified); add the guard test scanning scripts/ for `new Ajv`|`require("ajv")` outside the seam.
- [x] Slice 3 (context family migration): migrate context-request, context-ingest, context-loadout, context-benchmark, context-source-adapter — delete local Ajv/format plumbing; pinned error strings preserved by passing each consumer's existing label to formatErrors (or by keeping its prefix mapper at the call site where the shape differs materially); differential check: each consumer's existing tests pass unmodified.
- [x] Slice 4 (remaining adapters): migrate memory-commands, knowledge-plan/internal/validate, mcp-invocation-coordinator, mcp-registry-loader (compileInline export), session-manifest + validate-route (eager compileSchema at module scope preserving throw-on-load). All existing tests pass.
- [x] Slice 5 (guard extension + docs): extend the guard to fail on any new `new Ajv` outside the seam; restate the rule in CONTRIBUTING/CLAUDE.md (one line, next to the existing single-source conventions) and the survey doc's Finding 3 with the shipped note; npm test full-suite.

## Resume Checkpoint

- Resume Point: all five slices implemented and verified (guard, seam tests, consumer suites, docs); full npm test green.
- Blockers: none — awaiting governance close-out (session verify/complete, feature accept).
- Next Action: run the governance close-out for session fcfe769a, then set this plan's Status to accepted.
- Recovery Instructions: reopen this plan and continue at the governance close-out; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `grep -r "new Ajv" scripts/` matches only scripts/lib/core/schema-contract.js.
- Every schema validation surface reports all errors (allErrors) with the shared formatErrors mapper; format keywords validate everywhere formats/ajv-formats covers plus the strict date-time.
- sync-envelope-contract and sync-transport-report-contract tests pass byte-identically (public contracts unchanged).
- session-manifest and validate-route keep eager fail-fast startup on schema-load failure.
- mcp-registry-loader can still compile dynamically-provided schemas without a schemas/ file.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/schema-contract.test.js
- npm test

## Evidence Schema

- Command: `node scripts/amber.js session verify --session fcfe769a-b525-42ca-9b51-40f766c7d8d2 --execute --command "npm test" --target . --yes`
- Result: exit 0 — npm test 2672/2672 pass (full suite)
- Date: 2026-08-25
- Notes: schema-contract seam shipped; all 12 adapter files migrated (sync-envelope-contract and sync-transport-report-contract as one-line specializations with byte-identical error strings; context family keeps pinned prefix mappers; session-manifest/validate-route keep eager throw-on-load; mcp-registry-loader uses compileInline for dynamic schemas); guard test fails on any new Ajv site outside the seam; rule restated in CLAUDE.md and CONTRIBUTING.md; survey Finding 3 marked shipped.
