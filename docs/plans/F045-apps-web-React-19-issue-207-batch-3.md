# Plan: apps/web React 19 (issue #207 batch 3)

Feature: F045
Status: accepted
User Confirmation: confirmed

## Goal

apps/web runs react/react-dom 19.2.x with @types/react 19; UI, tests, and build behave identically on the React 19 runtime

## High Level Design

- Context: Issue #207 batch 3 — react/react-dom 18.2/18.3 → 19.2.8 plus @types/react/@types/react-dom 18.3 → 19.x. Batch 4 (build chain: vite/vitest/ts/tailwind/zod/react-markdown/@types/node) stays out of scope. Breakage survey (2026-08-25): the app's React surface is small and already v19-shaped — entry (src/main.tsx) uses react-dom/client createRoot; zero JSX-namespace references, zero forwardRef/defaultProps/React.FC, zero bare useRef() (all carry initializers), no react-dom/test-utils or ReactDOM.render, and the single class component (src/components/ErrorBoundary.tsx, `extends Component`) is still supported in 19. Peer ranges all admit 19: react-markdown 9 (>=18), @tanstack/react-router 1.170 (>=18||>=19), @tanstack/react-query 5 / react-virtual 3 / @testing-library/react 16.3 (^18||^19, with @testing-library/dom ^10 already present). The risk is concentrated in @types/react 19's type changes (ReactElement default generics, stricter JSX return types) surfacing as tsc errors. Baselines: vitest 571/571, lint 0 errors/36 warnings, build clean, root suite 2672/0 (F044 landed).
- Proposed approach: (1) `npm install react@19.2.8 react-dom@19.2.8` and `npm install -D @types/react@^19 @types/react-dom@^19` in apps/web (`--legacy-peer-deps`, then re-check whether it is still required per the issue constraint); (2) `npx tsc --noEmit` and fix whatever the v19 types surface (expected: none to a handful of mechanical annotations); (3) full verification — lint, vitest, build, root suite; (4) confirm the lockfile holds a single react/react-dom version pair at 19.2.x.
- Risks: React 19 runtime behavior changes are behavior-adjacent (StrictMode double-render semantics unchanged; error-boundary `getDerivedStateFromError` unchanged) — mitigated by the 571-test suite exercising render paths, plus build + typecheck. react-markdown 9 runs on 19 but is batch 4's upgrade — keep it at 9 here. If @testing-library/react 16.3 shows act() warnings under 19, they are warnings, not failures; any real breakage gets fixed mechanically. If peer resolution improves (everything admits 19), try dropping `--legacy-peer-deps`; if install fails without it, document that it is still required.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1 (dependency bump + typecheck): install react/react-dom 19.2.8 and @types/react/@types/react-dom 19; run `npx tsc --noEmit` and fix any v19 type fallout; confirm lockfile holds exactly one react/react-dom pair at 19.2.x; re-check `--legacy-peer-deps` necessity.
- [x] Slice 2 (full verification): apps/web lint + vitest + build green (571 baseline preserved), root `npm test` green (2672 baseline); fix any runtime fallout the React 19 test run surfaces.

## Resume Checkpoint

- Resume Point: implementation complete — both slices landed; verification green (typecheck, web lint/test/build + root suite).
- Blockers: none.
- Next Action: session verify → complete → handoff → accept, then commit.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- apps/web runs react/react-dom 19.2.x; the lockfile holds no react/react-dom 18.x or @types/react 18.x entries.
- @testing-library/react 16 compat verified on the React 19 runtime (vitest suite green).
- apps/web vitest green (571 baseline may grow, never shrink), `npx tsc --noEmit` clean, `npm run build` clean, `npm run lint` 0 errors.
- Root CLI suite unaffected; `--legacy-peer-deps` re-checked (kept or dropped, per the issue constraint).
- Existing Amber guardrails still pass.

## Verification

- cd apps/web && npx tsc --noEmit
- bash .scratch/f045-verify.sh

## Evidence Schema

- Command: bash .scratch/f045-verify.sh (apps/web: npx tsc --noEmit; npm run lint; npx vitest run; npm run build) + npm test (repo root)
- Result: pass — tsc clean; lint 0 errors/36 pre-existing warnings; vitest 571/571 (67 files); vite build clean; root suite 2672 pass / 0 fail
- Date: 2026-08-25
- Notes: react/react-dom 19.2.8 + @types/react 19.2.18 / @types/react-dom 19.2.5 — lockfile holds exactly one version pair each, no 18.x remnants. Zero source changes needed: the app was already v19-shaped (createRoot entry, no JSX-namespace refs, no forwardRef/defaultProps, no bare useRef, single class ErrorBoundary still supported). @testing-library/react 16.3.2 verified green on the React 19 runtime. `--legacy-peer-deps` re-checked: `npm install --dry-run` without the flag exits 0 with no ERESOLVE — the flag is no longer required (kept installs unchanged; documented per issue constraint). Session c9897471-d3bc-4707-bdca-47c2c422daa6, both verifications executed and recorded (exit 0).
