# Plan: prettier pre-commit hook (F048)

Feature: F048
Status: accepted
User Confirmation: confirmed

## Goal

Commits in this repo automatically prettier-format staged files before the commit is created, so formatting drift can never reach CI

## High Level Design

- Context: The user asked for a prettier pre-commit hook, but one already exists — `.githooks/pre-commit` (wired via `git config core.hooksPath .githooks`, installed by `npm run dev:hooks:install`) runs identity validation, root eslint, and `npx lint-staged`, whose package.json config maps `*.{js,mjs,cjs,json,md,yml,yaml}` → `prettier --write`. Yet F047 (9545550) landed an unformatted `apps/web/src/lib/theme-provider.tsx` and CI's format:check step went red (fixed in e40fba5). Root cause: the ROOT `.prettierignore` line 9 ignores `apps/web/` entirely (the web app keeps its own prettier toolchain — `.prettierrc.json` + `format`/`format:check` scripts there), so when lint-staged invokes the ROOT prettier on a staged apps/web file, prettier skips it as ignored and reports success — the hook passes while the drift commits. CI does NOT skip it: root `format:check` runs `prettier --check .` (still ignored) AND `npm --prefix apps/web run format:check`, which checks apps/web sources with the web config. So the gap is precisely: staged apps/web files never get formatted at commit time.
- Proposed approach: a web-scoped entry in the root package.json lint-staged config, so the existing `npx lint-staged` hook step formats every staged apps/web file: `"apps/web/**"` → `prettier --config apps/web/.prettierrc.json --ignore-path apps/web/.prettierignore --write`. The glob is deliberately a catch-all — an extension list (the initial `*.{ts,tsx,css,html}` version) re-opens the F047 gap for any extension it omits (.mjs/.mts/.js/.json all fell through). lint-staged re-stages files its tasks modify, so the hook script needs no change. apps/web files that also match the root glob (js/mjs/cjs/json) are no-ops for the root prettier — the root .prettierignore ignores apps/web/ wholesale, and prettier exits 0 on an explicitly passed ignored file (verified empirically: exit 0, zero modification) — while the web task formats them. Prettier anchors `--ignore-path` patterns at the ignore file's directory, so web-ignored paths (routeTree.gen.ts, dist/) stay untouched. Slices: (1) add the web-scoped lint-staged entry; (2) prove the hook: stage a deliberately misformatted apps/web file, run `.githooks/pre-commit`, confirm the file is auto-formatted and re-staged; (3) full verification suite.
- Risks: Windows hook execution — hooksPath already works on this machine (post-commit/pre-push already wired), no change there. The web ignore file at apps/web/.prettierignore anchors its patterns (src/routeTree.gen.ts, dist/, package-lock.json) at apps/web/, so the staged path apps/web/src/routeTree.gen.ts matches — generated files stay untouched. Double-matched files (apps/web js/mjs/cjs/json) run through both tasks: root prettier no-ops (ignored, exit 0), web prettier formats — verified empirically, not just idempotence. The hook adds ~1-2s per commit when apps/web files are staged — acceptable. Root eslint step already runs on every commit (slower) — out of scope here.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1: add a web-scoped entry to the root lint-staged config (`apps/web/**/*.{ts,tsx,css,html}` → web-config prettier with explicit --config/--ignore-path), so staged apps/web sources are formatted at commit time by the existing `npx lint-staged` hook step.
- [x] Slice 2: prove the hook end-to-end — stage a deliberately misformatted apps/web file, invoke `.githooks/pre-commit` directly, confirm auto-format + re-stage; then `git checkout` the scratch change.
- [x] Slice 3: full verification (root + web suites, format:check both sides, lint) and governance close-out.

## Resume Checkpoint

- Resume Point: feature accepted; all three slices delivered and verified.
- Blockers: none. The lint-staged entry lives in root package.json, which is a user-owned file excluded from feature commits — the user must commit that change themselves (or explicitly authorize including it).
- Next Action: user commits root package.json (lint-staged apps/web entry) and pushes; nothing else outstanding.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- A commit that stages a misformatted apps/web source file cannot be created with the drift intact — the hook formats and re-stages it (proven in Slice 2 with a live hook invocation).
- Root-side staged files keep the existing behavior (lint-staged → root prettier).
- apps/web generated files (routeTree.gen.ts, dist/) are never formatted by the hook.
- `npm run format:check` (root + web) green; root lint green; root suite 2672/0; web vitest 571/571 untouched.
- Existing Amber guardrails still pass.

## Verification

- bash .scratch/f048-verify.sh — the script runs, in order: `npm run format:check` (root prettier --check . + web format:check), `npm run lint` (root eslint), `npm test` (root suite), then `cd apps/web && npx vitest run` (web suite)
- npm test (repo root)

## Evidence Schema

- Command: bash .scratch/f048-verify.sh (root format:check + lint + npm test, then cd apps/web && npx vitest run)
- Result: pass — root format:check green, root lint clean, root suite 2672 passed / 0 failed, web vitest 571/571 (recorded via amber session verify, exit 0, ledger verification_passed 2026-08-25T17:32:23Z)
- Date: 2026-08-26 (amber feature-verify local date; the ledger records the run itself at 2026-08-25T17:32:23Z UTC = 2026-08-26 01:32 local)
- Notes: Hook proven end-to-end before verification: staged a deliberately misformatted apps/web .tsx, invoked .githooks/pre-commit directly, confirmed the file was auto-formatted and re-staged by lint-staged; routeTree.gen.ts confirmed still ignored via apps/web/.prettierignore. Fix is a single web-scoped lint-staged entry in root package.json (no hook-script change). Root-side behavior (AC2) preserved: the root glob is untouched, and the live hook runs on commits d92966a/b7bfd52 show the root task still processing staged root files (e.g. `*.{js,mjs,cjs,json,md,yml,yaml} — 3 files COMPLETED` in d92966a's hook output).

## Review Fixes (2026-08-26)

Two-axis review of e40fba5..f1818c1 flagged: (1) feature_list.json metadata claimed a husky hook and booked a nonexistent .husky/pre-commit path — corrected to the real mechanism (lint-staged entry in package.json); (2) the extension-list glob left web .mjs/.mts/.js/.json files uncovered (goal over-claimed "drift never reaches CI") — the glob is now the catch-all `apps/web/**`, proven by a live hook run on a misformatted vite.config.mts; (3) no automated test guarded the coverage — added tests/unit/lint-staged-web-coverage.test.js (4 tests, runs in the root suite); (4) evidence date mismatch and missing AC2 evidence line — reconciled above against the session ledger.
