# Plan: prettier pre-commit hook (F048)

Feature: F048
Status: accepted
User Confirmation: confirmed

## Goal

Commits in this repo automatically prettier-format staged files before the commit is created, so formatting drift can never reach CI

## High Level Design

- Context: The user asked for a prettier pre-commit hook, but one already exists — `.githooks/pre-commit` (wired via `git config core.hooksPath .githooks`, installed by `npm run dev:hooks:install`) runs identity validation, root eslint, and `npx lint-staged`, whose package.json config maps `*.{js,mjs,cjs,json,md,yml,yaml}` → `prettier --write`. Yet F047 (9545550) landed an unformatted `apps/web/src/lib/theme-provider.tsx` and CI's format:check step went red (fixed in e40fba5). Root cause: the ROOT `.prettierignore` line 9 ignores `apps/web/` entirely (the web app keeps its own prettier toolchain — `.prettierrc.json` + `format`/`format:check` scripts there), so when lint-staged invokes the ROOT prettier on a staged apps/web file, prettier skips it as ignored and reports success — the hook passes while the drift commits. CI does NOT skip it: root `format:check` runs `prettier --check .` (still ignored) AND `npm --prefix apps/web run format:check`, which checks apps/web sources with the web config. So the gap is precisely: staged apps/web files never get formatted at commit time.
- Proposed approach: extend the existing `.githooks/pre-commit` — after the existing `npx lint-staged` step, add a second lint-staged invocation that runs from apps/web (so its .prettierrc.json + .prettierignore apply) against staged files under apps/web. Concretely: `cd apps/web`-scoped invocation using `npx lint-staged --cwd apps/web`? No — lint-staged operates on the git root; the cleanest correct mechanism is a second staged-file filter in the hook script itself: collect staged files with `git diff --cached --name-only --diff-filter=ACM`, filter to `apps/web/` paths that prettier handles (ts,tsx,js,mjs,cjs,json,css,html), and if non-empty run `npx prettier --config apps/web/.prettierrc.json --ignore-path apps/web/.prettierignore --write` on them from the repo root, then re-stage exactly those files (`git add` them back). This honors the web ignore list (routeTree.gen.ts, dist/ stay untouched) and re-uses the web config. Alternatively (simpler, preferred): add a web-scoped entry to the root package.json lint-staged config — `"apps/web/**/*.{ts,tsx,css,html}"` → `prettier --config apps/web/.prettierrc.json --ignore-path apps/web/.prettierignore --write` — because lint-staged re-stages files its tasks modify automatically. Verify: is `.prettierignore` consulted relative to cwd (repo root) — yes, and `--ignore-path` makes it explicit. The hook script needs no change at all under the preferred option; the existing `npx lint-staged` picks up the new glob. Also keep a guard: files matched by BOTH globs (a .json under apps/web) would run twice — harmless (idempotent) but avoid by excluding apps/web from the root glob: change root entry to `*.{js,mjs,cjs,json,md,yml,yaml}` minus apps/web… lint-staged has no negation, so scope root glob's json/md collision: apps/web .json files would be touched by root prettier (which ignores them — no-op, file stays staged) and by the web entry (formatted). Acceptable; md/yml under apps/web only hit the root entry (no-op due to ignore). Slices: (1) add the web-scoped lint-staged entry; (2) prove the hook: stage a deliberately misformatted apps/web file, run `.githooks/pre-commit`, confirm the file is auto-formatted and re-staged; (3) full verification suite.
- Risks: Windows hook execution — hooksPath already works on this machine (post-commit/pre-push already wired), no change there. lint-staged glob `apps/web/**/*.{ts,tsx,css,html}` with `--ignore-path apps/web/.prettierignore`: prettier applies ignore patterns relative to the ignore file's location, so `src/routeTree.gen.ts` in the web ignore file matches `apps/web/src/routeTree.gen.ts`? No — patterns in an ignore file apply relative to the ignore file's directory, and the staged path IS apps/web/src/routeTree.gen.ts while the ignore file sits at apps/web/.prettierignore, so its `src/routeTree.gen.ts` pattern matches — correct behavior, generated file untouched. Double-formatting of shared-extension files is idempotent. The hook adds ~1-2s per commit when apps/web files are staged — acceptable. Root eslint step already runs on every commit (slower) — out of scope here.

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

- bash .scratch/f048-verify.sh
- npm test (repo root)

## Evidence Schema

- Command: bash .scratch/f048-verify.sh (root format:check + lint + npm test, then cd apps/web && npx vitest run)
- Result: pass — root format:check green, root lint clean, root suite 2672 passed / 0 failed, web vitest 571/571 (recorded via amber session verify, exit 0)
- Date: 2026-08-25
- Notes: Hook proven end-to-end before verification: staged a deliberately misformatted apps/web .tsx, invoked .githooks/pre-commit directly, confirmed the file was auto-formatted and re-staged by lint-staged; routeTree.gen.ts confirmed still ignored via apps/web/.prettierignore. Fix is a single web-scoped lint-staged entry in root package.json (no hook-script change).
