# Plan: apps/web build chain (issue #207 batch 4)

Feature: F046
Status: accepted
User Confirmation: confirmed

## Goal

apps/web runs vite 8 + vitest 4 + typescript 7 + tailwind 4 + zod 4 + react-markdown 10 + @types/node 26; suite, lint, typecheck, and build stay green

## High Level Design

- Context: Issue #207 batch 4, the final and heaviest batch ("budget extra time"). Current → target: vite 5.4.21 → 8.2.2, @vitejs/plugin-react 4.7 → 6.1.0, vitest 1.6.1 → 4.1.11, typescript 5.9.3 → 7.0.2, tailwindcss 3.4.19 → 4.3.3 (config-system rewrite), zod 3.25.76 → 4.4.3, react-markdown 9.1.0 → 10.1.0, @types/node 20.19.43 → 26.3.0. Breakage survey (2026-08-25): (a) build/test chain pairs — plugin-react 6.1.0 requires vite ^8.0.0 exactly, vitest 4.1.11 accepts vite ^6||^7||^8, @tanstack/router-plugin 1.168.18 already admits vite >=8; vite.config.mts uses only stable surface (plugins, aliases, server.proxy, build.target/minify/sourcemap/manualChunks) and vitest.config.ts uses stable test options (environment node, globals, exclude) — vitest 4 also peers @types/node ^20||^22||>=24; (b) typescript 7 is the wildcard — typescript-eslint 8.68.0 (the latest published) supports TS <6.1.0 only, so the lint stack is officially unsupported on TS 7; typescript-estree emits an unsupported-version warning but historically continues — this must be gated empirically (tsc + lint + suite), with a documented fallback (pin TS at latest 5.x, defer TS 7 to an issue comment) if lint actually breaks; (c) tailwind 4 — the app uses a JS config (custom surface/ink/accent/success/warning/error colors, Inter/JetBrains Mono fonts, 2xs size, fadeIn/slideUp keyframes, darkMode 'class', content globs, no plugins) + postcss.config.js (tailwindcss + autoprefixer) + index.css (@tailwind base/components/utilities + @layer base CSS vars); v4 path of least risk keeps the JS config via the `@config` directive, swaps the postcss plugin to @tailwindcss/postcss, drops autoprefixer (v4 prefixes internally), and replaces the three @tailwind directives with `@import "tailwindcss"`; no tests import tailwind/postcss directly — coverage is build output + render tests asserting class tokens; (d) zod 4 — usage across 10 server files is all stable core API (string/literal/object/number/enum/infer/unknown/union/boolean/discriminatedUnion) except exactly two single-argument `z.record(z.unknown())` call sites (server/types/session-events.ts:24 and :177) which need the v4 two-argument form; no .email()/.uuid()/.datetime()/required_error/invalid_type_error usage anywhere; (e) react-markdown 10 — single consumer (src/components/code/MarkdownMessage.tsx) using remarkPlugins=[remarkGfm] + a components map; remark-gfm ^4.0.0 already installed is compatible, react >=18 peer satisfied on React 19 — expected drop-in; (f) @types/node 26 — devDep bump only, types do not affect the CI node-20 runtime. Baselines after F044/F045: vitest 571/571, lint 0 errors/36 warnings, tsc clean, build clean, root suite 2672/0.
- Proposed approach: four slices in dependency order, each leaving lint/typecheck/suite/build green. Slice 1 (build/test chain): install vite@8.2.2 + @vitejs/plugin-react@6.1.0 + vitest@4.1.11 together; fix any config drift the new vitest/vite surface; verify vitest + build. Slice 2 (typescript 7): install typescript@7.0.2; run tsc (tsconfig uses standard options — project references, bundler resolution, noEmit); run lint and the suite; decision gate — if the typescript-eslint unsupported-version condition produces actual errors, pin TS to the latest 5.x instead and record the TS 7 blocker in the issue. Slice 3 (tailwind 4): install tailwindcss@4.3.3 + @tailwindcss/postcss@4.3.3, remove autoprefixer; rewrite postcss.config.js to the @tailwindcss/postcss plugin; rewrite index.css head to `@import "tailwindcss";` + `@config "../tailwind.config.js";` keeping @layer base vars; verify build (CSS bundle must still carry the custom tokens, e.g. bg-surface/text-ink/accent utilities) and render tests. Slice 4 (zod 4 + react-markdown 10 + @types/node 26): install the three; fix the two z.record call sites to `z.record(z.string(), z.unknown())`; verify server tests (zod schemas drive the event/session routers) and build. Final: full verification (tsc, lint, vitest, build, root npm test) + lockfile audit (exactly one version of each upgraded package, no vite 5/vitest 1/tailwind 3/zod 3 remnants).
- Risks: TS 7 + typescript-eslint is the only genuinely uncertain pairing — mitigated by the slice-2 decision gate with a documented fallback (TS stays 5.x; TS 7 deferred with an issue note; everything else in the batch still lands). Tailwind 4 via @config keeps the JS theme but v4's legacy-config support has edge cases (e.g. darkMode 'class' honored, custom color nesting); mitigated by build-output inspection plus the render tests' class-token assertions and manual visual smoke of the dev server if the bundle looks wrong. Vitest 1→4 spans three majors of runner internals; the config surface used is stable and the 571-test suite is the gate. react-markdown 10 is ESM-only — the app and vitest are ESM, so no CJS interop expected. @types/node 26 vs CI node 20: types-only, no runtime effect. `--legacy-peer-deps` was re-verified unnecessary in F045; re-check after this batch's installs per the issue constraint.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1 (build/test chain): vite 8.2.2 + @vitejs/plugin-react 6.1.0 + vitest 4.1.11 installed together; fix config drift; vitest 571 baseline + build green.
- [x] Slice 2 (typescript 7): typescript 7.0.2; tsc clean; empirical lint gate — if typescript-eslint breaks, pin TS latest 5.x and record the TS 7 blocker on the issue. → DECISION: typescript-eslint 8.68 (latest published) hard-errors on TS 7.0 ("does not support TS 7.0"; TS 7 is the native-compiler line, tracked by typescript-eslint#10940 for >=7.1); landed typescript 6.0.3 instead — the parallel JS line, inside typescript-eslint's <6.1.0 support range — tsc/lint/suite/build all green on 6.0.3.
- [x] Slice 3 (tailwind 4): tailwindcss + @tailwindcss/postcss 4.3.3, postcss.config.js rewrite, index.css @import + @config keeping the JS theme and @layer base; build CSS carries custom tokens; render tests green. → Also inlined the `card` tokens into `.card-hover` (v4's @apply no longer accepts custom component classes) and dropped autoprefixer (v4 prefixes internally); verified in the built CSS: class-strategy dark variants (`.dark\:bg-slate-800:is(.dark *)`), fadeIn keyframes and page-container/btn-primary/card-hover component classes present; custom color utilities correctly absent because no source file uses them (content-driven pruning, not a config failure).
- [x] Slice 4 (zod 4 + react-markdown 10 + @types/node 26): three installs; two z.record call sites fixed to two-argument form; server tests + build green.
- [x] Slice 5 (final verification + lockfile audit): full .scratch/f046-verify.sh (tsc, lint, vitest, build), root npm test, lockfile holds exactly one version of each upgraded package; `--legacy-peer-deps` re-check. → Lockfile: vite 8.2.2 / plugin-react 6.1.0 / vitest 4.1.11 / typescript 6.0.3 / tailwindcss 4.3.3 / @tailwindcss/postcss 4.3.3 / zod 4.4.3 / react-markdown 10.1.0 / @types/node 26.3.0, no stale majors (only nested entry is vite's macOS-only fsevents optional); plain `npm install --dry-run` exits 0 (flag not needed for the final tree; used once transiently for the simultaneous plugin-react/vite major swap).

## Resume Checkpoint

- Resume Point: implementation complete — all five slices landed; verification green (tsc, lint, vitest 571/571, build, root suite 2672/0).
- Blockers: none.
- Next Action: session verify → complete → handoff → accept, then commit.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- apps/web runs vite 8 + @vitejs/plugin-react 6 + vitest 4; no vite 5 / plugin-react 4 / vitest 1 entries remain in the lockfile.
- typescript is 7.0.2 with tsc + lint + suite green, or pinned at the latest 5.x with the TS 7 blocker recorded on issue #207 (decision documented in Evidence).
- tailwindcss 4 powers the styling: postcss uses @tailwindcss/postcss, CSS entry uses @import "tailwindcss" (+ @config for the JS theme), build output still emits the custom design tokens, dark-mode class strategy intact, render tests green.
- zod 4 with the two-argument record form; react-markdown 10; @types/node 26; no zod 3 / react-markdown 9 / @types/node 20 entries remain.
- apps/web vitest green (571 baseline may grow, never shrink), `npx tsc --noEmit` clean, `npm run build` clean, `npm run lint` 0 errors.
- Root CLI suite unaffected; `--legacy-peer-deps` re-checked per the issue constraint.
- Existing Amber guardrails still pass.

## Verification

- bash .scratch/f046-verify.sh
- npm test (repo root)

## Evidence Schema

- Command: bash .scratch/f046-verify.sh (apps/web: npx tsc --noEmit; npm run lint; npx vitest run; npm run build) + npm test (repo root)
- Result: pass — tsc clean on TS 6.0.3; lint 0 errors/36 pre-existing warnings; vitest 571/571 (67 files) on vitest 4.1.11; vite 8.2.2 build clean; root suite 2672 pass / 0 fail
- Date: 2026-08-26
- Notes: Full batch landed — vite 8.2.2 + @vitejs/plugin-react 6.1.0 + vitest 4.1.11 (no config drift; manualChunks intact); typescript 6.0.3 NOT 7.0.2: typescript-eslint 8.68 (latest) hard-errors on TS 7.0 ("does not support TS 7.0" — TS 7 is the native-compiler line; support tracked at typescript-eslint#10940 for >=7.1), while 6.0.3 (the parallel JS line) sits inside its <6.1.0 range — TS 7 upgrade deferred until typescript-eslint supports it; tailwind 4.3.3 via @tailwindcss/postcss + `@import 'tailwindcss'` + `@config` (JS theme preserved), autoprefixer dropped, card tokens inlined into card-hover (v4 @apply rejects custom classes), dark class-strategy verified in built CSS; zod 4.4.3 with both z.record call sites moved to the two-argument form; react-markdown 10.1.0 drop-in; @types/node 26.3.0. Lockfile audit: one version of each, no stale majors (only nested entry is vite's macOS-only fsevents). `--legacy-peer-deps`: final tree resolves with a plain `npm install --dry-run` (exit 0); the flag was needed only once, transiently, for the simultaneous plugin-react 6 / vite 8 major swap. Session cedf3fc9-0d56-420b-a8f4-f99082f9cdfb, both verifications executed and recorded (exit 0).
