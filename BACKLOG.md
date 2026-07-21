# Amber Protocol Backlog

This backlog tracks implementation status across the roadmap. V1 remains Safe Amber Bootstrap only: `init`, `audit`, `wiki`, `doctor`, and `handoff`; later phases add gated artifact and metadata flows.

## Completed In Current Workflow

- Unified CLI command surface: `init`, `audit`, `wiki`, `doctor`, and `handoff`.
- `wiki` now creates missing Wiki skeleton files, skips existing files, supports `--dry-run`, and validates after creation.
- CLI failure-path tests cover non-zero parseable JSON for `wiki`, `handoff`, and `doctor`.
- Standalone validator wrapper tests cover broken fixture failures.
- Audit now reports existing docs, wiki-like files, and approval-required patch suggestions.
- Local manifest validation now checks `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`, including JSON shape, required fields, Codex interface metadata, and referenced skills paths.
- Audit safety output now includes suggested additions, unknowns, and a next safe read-only command.
- CLI failure behavior is covered: `wiki`, `handoff`, and `doctor` return non-zero on validation errors; failure JSON is parseable; standalone validator wrappers have spawn tests.
- Validator coverage now includes feature-list schema branches, wiki link/path edge cases, and doctor aggregation across V1 guardrails.
- Starter Wiki templates now include `Unknowns / Needs Confirmation` sections for product, architecture, engineering, and feature context pages; Wiki validation warns when those sections are missing.
- Minimum Amber files and optional starter Wiki files are represented by separate constants; `doctor` accepts a minimum Amber setup when optional starter pages are absent and unlinked.
- CLI help is command-specific, scopes `--dry-run` to `init` and `wiki`, and `package.json` exposes the `amber-protocol` bin entry.
- Audit reports tooling evidence from lockfiles and Python project files without inventing commands; invalid `package.json` is recorded as an unknown parse issue.
- V1.5 target classification is implemented; product-repo `doctor` validates product checks without requiring target Amber files at repository root.
- V1.5 sample workflow pack/profile smoke inspection is implemented without executing scripts or workflows.
- V2 planning layer is implemented with `plan` and `gate`; plans are tied to `feature_list.json`, include vertical slices and verification, and require user confirmation before implementation-ready status.
- V2.5 review and accept gates are implemented; review loads static standards and blocks missing confirmation, while accept appends an Amber setup evolution log only after review passes.
- V3 workflow pack design kit is implemented with `pack inspect`, `pack validate`, and `profile inspect`; validation catches missing skills, broken standards, unsafe scripts, and undeclared integrations without executing workflows.
- V4 isolated execution foundation is implemented with `task prepare` and `result inspect`; task artifacts include worktree directory, ledger, evidence pack, and replay file without relying on chat history.
- V4.5 agent orchestration records are implemented with `agent dispatch`, `agent stop`, `agent resume`, and `agent review`; workers cannot self-approve and reviewer evidence is separate from worker output.
- V5 team distribution is implemented with local registry metadata, team presets, rule packs, compatibility matrix, and `team inspect/install/pin/update/rollback`; updates can be previewed and target-project customizations are preserved.
- V5.5 continuous maintenance is implemented with `maintenance inspect` and `maintenance propose`; stale knowledge, upgrade guidance, rule-pack drift, and repeated delivery findings are reported as reviewable evidence.

## Phase B / C / D (beyond the V1–V5.5 governance surface)

- Phase B (routes, sessions, interactive + autonomous execution, checkpoint/continue, migration, daemon, governance) is implemented and covered by the root `tests/` suite. `error-recovery.js` and `health-checker.js` exist (earlier status docs that listed them as missing were stale).
- Phase C (web viewer in `apps/web`) is implemented: sessions, routes, gates, settings, and timeline pages plus SSE real-time updates. Unit tests run under `npm test` in `apps/web`; Playwright e2e specs live in `apps/web/tests/e2e` and run in the CI `web` job (`npm run test:e2e`).
- Phase D (production hardening) is implemented for the local viewer boundary: SSE endpoint auth is enforced via `validateSSEAuthToken` (401 on missing/invalid token), and client errors POST to `POST /api/errors` then fan out server-side via `error-forwarder` (Sentry/webhook env on the Node process — not dead `process.env` in the Vite client). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Gap fixes (audit pass)

- `parseArgs` now recognizes `--priority`, `--fix-markers`, `--all`, `--explain`, and `--strict`; previously these landed in positional args and silently never reached their already-implemented handlers.
- `maintenance wiki-lint --fix-markers` is implemented: it appends a missing `Unknowns / Needs Confirmation` section to starter wiki pages, and is idempotent.
- `governance evidence --all` is wired through the CLI.
- Duplicate `Unknowns / Needs Confirmation` sections in `templates/docs/wiki/**` starter pages were de-duplicated.
- Test hygiene: root `npm test` is scoped to `tests/` so it no longer descends into `.claude/worktrees/` copies; `apps/web` vitest excludes Playwright `*.spec.ts`; the three `tests/client` web tests that never ran (missing `@testing-library/*` deps, JSX-in-`.ts`) now pass under happy-dom.

## P0

## P2

No open V1, V1.5, V2, V2.5, V3, V4, V4.5, V5, or V5.5 implementation items.

## Deferred

- Dynamic workflow execution.
- Live product subagent runner dispatch.
- Automatic task command execution.
- Model/backend routing.
- External marketplace publishing.
- Automatic rewrite of old project files.
- Hosted multi-tenant web deployment beyond the local 127.0.0.1 viewer boundary (auth model, multi-user isolation).
