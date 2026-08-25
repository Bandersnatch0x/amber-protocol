# Plan: apps/web eslint 10 + flat config (issue #207 batch 1)

Feature: F043
Status: accepted
User Confirmation: confirmed

## Goal

apps/web lints its TS/React toolchain with eslint 10 (version parity with root) via a flat config; the lint gate runs in CI

## High Level Design

- Context: Issue #207 batch 1 — `apps/web` carries eslint ^8.57.0 (EOL; stopped receiving fixes) as a dangling devDependency: there is no `.eslintrc*`, no `eslint.config.*`, and no lint script, so the dependency is installed but never runs. The root repo already runs eslint 10.9.1 with a flat `eslint.config.mjs` that explicitly ignores `apps/web/` (own TS toolchain). Baselines 2026-08-25: apps/web vitest 571/571 green; root suite 2672/2672 green.
- Proposed approach: (1) bump `eslint` to `^10.9.1` in `apps/web/package.json` and install with the same `--legacy-peer-deps` the web app already uses; (2) add a flat `apps/web/eslint.config.mjs` scoped to the web toolchain — TypeScript (`.ts`/`.tsx`) + config files (`*.mts`, `vite.config.mts`, `vitest.config.ts`, `playwright.config.ts`, `postcss.config.js`, `tailwind.config.js`) — using `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` (the standard Vite TS template stack) plus browser+node globals split (`src`/`index.html` → browser; `server`/`tests` config → node; tests also get jest-like `describe/it/expect` via globals or explicit imports). Generated files (`src/routeTree.gen.ts`, which carries its own `/* eslint-disable */`) are ignored. Keep the rule set conservative on first landing: recommended configs, `no-unused-vars` warn with `argsIgnorePattern: "^_"`, react-hooks rules as errors (they catch real bugs). (3) Add `lint`/`lint:fix` scripts to `apps/web/package.json`; (4) add a `Run web lint` step to the CI web job before build; (5) fix whatever the first real lint run surfaces (expected: a handful of unused imports/vars — mechanical).
- Risks: `--legacy-peer-deps` may or may not still be needed after the bump (issue calls for re-checking; keep it — batch 1 doesn't change the React/tRPC majors that forced it). typescript-eslint version must be compatible with the app's TypeScript 5.9 (it is; 5.x range). Adding lint to CI could go red on the first run — mitigate by running the full lint locally before wiring the CI step, and landing lint + fixes in the same commit. The `preserve-caught-error`/`no-unused-vars` custom rules from the root config do NOT carry over (root scopes itself to CommonJS `scripts/`); the web config starts from the standard TS template baseline instead of inventing parity.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1 (dependency + flat config): bump eslint to ^10.9.1, install (`--legacy-peer-deps`), add `eslint.config.mjs` (typescript-eslint recommended, react-hooks errors, react-refresh warn, browser/node globals split by path, generated-files ignore), add `lint`/`lint:fix` scripts. `npm run lint` runs and reports (any findings become Slice 2 input). Landed with one addition: a `overrides: { "zod-validation-error": "^4.0.2" }` — eslint-plugin-react-hooks 7.1.1 unconditionally requires the `zod-validation-error/v4` subpath but its declared range `^3.5.0 || ^4.0.0` let npm resolve 3.5.4, which lacks that export (peer-compatible with the app's zod 3.25).
- [x] Slice 2 (clean lint + CI gate): fix all lint findings (expected: unused imports/vars); `npm run lint` exits 0; vitest stays 571/571; `npm run build` clean; add the `Run web lint` step to the CI web job; root `npm test` unaffected. Result: 0 errors / 36 warnings. Mechanical fixes: unused GateStatus import (gate-reader.ts), unused `index` arg → `_index` (LiveActivityCard.tsx), ternary-as-statement → if/else (event-broadcaster.ts writeWithTimeout — zero behavior change). Scoped config decisions: tests/** turn off no-explicit-any + no-unsafe-function-type (mocks); src/routes/** turn off react-refresh (TanStack Router loader convention); react-hooks set-state-in-effect + refs set to warn — 6 real production findings (theme/settings hydration, SSE state) deferred to a follow-up batch per issue #207's "tooling only" batch-1 scope.

## Resume Checkpoint

- Resume Point: both slices implemented; lint green (0 errors / 36 warnings); CI lint step wired; final verification (vitest/build/format) in flight.
- Blockers: none.
- Next Action: confirm vitest 571/571 + build clean, run the governance close-out, commit.
- Recovery Instructions: reopen this plan and continue at the governance close-out; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `cd apps/web && npm run lint` exits 0 with eslint 10.9.1.
- `apps/web/eslint.config.mjs` exists (flat) and scopes linting to the web toolchain; generated `routeTree.gen.ts` is ignored.
- CI web job runs the lint step before build.
- apps/web vitest suite green (571/571 baseline) and `npm run build` clean.
- Root `npm test` unaffected; root eslint config's `apps/web/` ignore stays (root and web lint independently).
- Existing Amber guardrails still pass.

## Verification

- cd apps/web && npm run lint
- cd apps/web && npm test
- cd apps/web && npm run build
- npm test (repo root)

## Evidence Schema

- Command: `bash .scratch/f043-verify.sh` (via amber session verify --execute)
- Result: exit 0 — eslint 0 errors/36 warnings, vitest 571/571, build clean
- Date: 2026-08-25
- Notes: eslint 8.57→10.9.1 (EOL fixed, parity with root); flat config with typescript-eslint + react-hooks 7 + react-refresh; overrides zod-validation-error ^4.0.2 (plugin's /v4 subpath require); CI web job lints before build. Deferred: 6 react-hooks production warnings (set-state-in-effect theme/settings/SSE) for a later behavior batch.
