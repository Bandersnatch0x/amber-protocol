# Final Report

## Accepted

- Packet A: Create `BACKLOG.md` with prioritized P0/P1/P2 V1 work.
- Packet A: Treat `wiki` create-or-validate as a P0 implementation slice.
- Packet A: Keep manifest validation as remaining P0 work because it is still part of V1 acceptance.
- Packet A: Keep audit safety categories as remaining P0 work; this workflow improved audit output but did not finish all categories.
- Packet B: Add CLI failure-path tests with parseable `--json`.
- Packet B: Add standalone validator wrapper spawn tests.
- Packet B: Expand validator coverage for feature-list schema branches, wiki link/path edge cases, and doctor aggregation across V1 guardrails.
- Packet B: Add starter Wiki unknown-marker coverage for product, architecture, engineering, and feature context pages.
- Packet B: Clarify minimum Harness files versus optional starter Wiki pages.
- Packet B: Polish CLI help/package entrypoints and make audit command detection conservative.

## Rejected

- No product Dynamic Workflow execution in V1.
- No product subagent orchestration in V1.
- No automatic rewrite or merge of old project files.

## Decisions

- Workflow/subagent usage in this run is an engineering method only. It does not change the V1 product boundary.
- `wiki` now creates missing Wiki skeleton files from templates and validates afterward.
- `wiki --dry-run` reports missing files without writing and does not fail merely because the target lacks a Wiki.
- Audit output now includes docs, wiki-like files, and approval-required patch suggestions.
- `doctor` now requires `PROGRESS.md` to include a real `## Next Action` or `## Next Actions` section with non-placeholder content.
- Starter Wiki context pages now use `## Unknowns / Needs Confirmation`; `validateWiki()` warns when those sections are missing.
- `doctor` validates the minimum Harness surface; optional starter Wiki pages may be absent when remaining pages do not link to them.
- CLI help scopes `--dry-run` to `init` and `wiki`.
- Audit reports lockfiles and Python project files as tooling evidence, not invented commands.

## Final Changes

- Added `BACKLOG.md`.
- Added workflow artifacts under `.workflow/2026-06-08-v1-backlog-and-cli-hardening/`.
- Added `scaffoldWiki()` and shared template-copy helper in `scripts/lib/harness-core.js`.
- Updated `scripts/harness.js` so `wiki` creates or validates.
- Expanded audit reporting in `scripts/lib/harness-core.js`.
- Updated README for `wiki` create-or-validate behavior.
- Added CLI failure-path and wrapper tests.
- Expanded CLI tests for `wiki` creation and dry-run.
- Expanded doctor guardrail coverage and tightened next-action validation.
- Added unknown-marker sections to product, architecture, engineering, and feature Wiki templates.
- Added Wiki validation warnings for missing unknown-marker sections on starter context pages.
- Added `MINIMUM_HARNESS_FILES` and `OPTIONAL_STARTER_WIKI_FILES` constants, plus coverage for a minimum Harness without optional starter pages.
- Updated README to explain minimum files versus starter files.
- Added a `coding-harness` package bin entry.
- Added command-specific help and CLI tests for dry-run scoping.
- Added audit tooling evidence and invalid `package.json` parse issue coverage.

## Verification

- `npm test`: 42 passed, 0 failed.
- `npm run manifests`: Errors 0.
- Codex plugin validation: passed.
- CLI smoke: `wiki` on empty target returned 0; `init` then `doctor` returned 0 with `Errors: 0`.
- Root safety check: no target Harness template instances were written to repository root.
- V1 boundary scan: clean.

## Remaining Risks

- No open non-deferred V1 backlog items remain pending verification.
