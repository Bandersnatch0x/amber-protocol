# Plan: apps/web tRPC 11 + TanStack Query 5 (issue #207 batch 2)

Feature: F044
Status: accepted
User Confirmation: confirmed

## Goal

apps/web runs tRPC 11 with @tanstack/react-query 5; client/provider/hooks refactored for the v5 API; all routers keep their contracts

## High Level Design

- Context: Issue #207 batch 2 — tRPC 10.45.4 → 11.18.0 and @tanstack/react-query 4.44 → 5.102.3 must land together (tRPC 11's react-query integration targets v5). Issue warns: "expect real refactor work, not a version bump." Breakage survey (2026-08-25): the tRPC surface is small — server/trpc.ts (initTRPC.create + superjson transformer, unchanged API), server/app.ts (createExpressMiddleware, unchanged), src/lib/trpc.ts (createTRPCReact + createClient with top-level `transformer: superjson` — tRPC 11 moved the transformer off createClient into the httpBatchLink), src/lib/trpc-provider.tsx (QueryClient + trpc.Provider — fine on v5), and `trpc.useContext()` → `trpc.useUtils()` (renamed in tRPC 11). Client hook usage across 15 route/component files is `trpc.x.y.useQuery/useMutation` — stable across both majors. The real breakage is Query v5's removal of useMutation callback options: `src/routes/gates.tsx` defines `onSuccess`/`onError`/`onSettled` on two mutations (approveAndResume, rejectGate) that drive an aria-live feedback banner + pending-action key + query invalidation. Baselines: vitest 571/571, lint 0 errors, build clean (F043 landed).
- Proposed approach: (1) bump @trpc/* to ^11.18.0 and @tanstack/react-query to ^5.102.3 (`--legacy-peer-deps` still, re-verify); (2) src/lib/trpc.ts — remove `transformer` from createClient, add it to httpBatchLink; (3) gates.tsx — replace callback-driven mutation handling with `mutateAsync` in the existing handler functions (handleApproveAndResume/handleReject already own pre-dispatch state) wrapped in try/catch/finally, keeping the exact feedback semantics: setPendingActionKey(key) + setActionFeedback(null) pre-flight, onSuccess body → try block (refetch + invalidate + cleanup + feedback), onError body → catch block, onSettled body → finally (setPendingActionKey(null)); (4) `trpc.useContext()` → `trpc.useUtils()`; (5) fix whatever typecheck surfaces (e.g. v5's `isLoading` semantics on mutations is `isPending` — already used; useQuery `isLoading` still exists as `isPending && isFetching`); (6) update tests/client/trpc.test.ts's createClient expectation if the transformer move affects the mocked shape (it asserts createClient receives `transformer` — will need to assert the link carries it instead).
- Risks: Query v5 removed `cacheTime` (→ `gcTime`, provider already uses gcTime — safe) and object-syntax `retry` etc.; the mutation-callback rewrite is the one behavior-adjacent change — mitigated by the existing 571-test suite (gates render + control flow are covered) plus keeping the feedback-state machine byte-identical (same setState calls in same order, only the trigger moves from callback to try/catch). tRPC 11 type inference changes may surface as new TS errors in route files — mechanical fixes only; no router-side changes expected (server/routers/* untouched by design). The `--legacy-peer-deps` flag must survive; if peer resolution changed, re-check per the issue constraint.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1 (dependency bump + client transformer move): upgrade @trpc/client/server/react-query to ^11.18.0 and @tanstack/react-query to ^5.102.3; move `transformer: superjson` from createClient to httpBatchLink in src/lib/trpc.ts; rename useContext → useUtils in gates.tsx; update tests/client/trpc.test.ts to assert the link (not createClient) carries the transformer. Typecheck + vitest green.
- [x] Slice 2 (mutation callback rewrite): rewrite gates.tsx approveAndResume/rejectGate from useMutation callbacks to mutateAsync + try/catch/finally in the existing handlers, preserving the exact feedback-state sequence; vitest (gates.render tests) + lint + build green; root suite untouched.

## Resume Checkpoint

- Resume Point: implementation complete — both slices landed; verification suite green (web lint/test/build + root suite).
- Blockers: none.
- Next Action: session verify → complete → handoff → accept, then commit.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- apps/web runs @trpc/* 11.18.x with @tanstack/react-query 5.102.x; no tRPC 10 / Query 4 packages remain in the lockfile.
- The superjson transformer lives on the httpBatchLink (tRPC 11 shape); client and server round-trip superjson payloads (vitest client tests pass).
- gates.tsx mutation feedback behavior is unchanged: aria-live banner, pending-action key, and invalidation fire in the same order as before (render tests green).
- apps/web vitest green (571 baseline may grow if tests are added, never shrink), `npm run build` clean, `npm run lint` 0 errors.
- Root CLI suite unaffected; `--legacy-peer-deps` re-verified still required (or dropped if resolution improved, per issue constraint).
- Existing Amber guardrails still pass.

## Verification

- cd apps/web && npm run lint
- cd apps/web && npm test
- cd apps/web && npm run build
- npm test (repo root)

## Evidence Schema

- Command: bash .scratch/f044-verify.sh (apps/web: npm run lint; npx vitest run; npm run build) + npm test (repo root)
- Result: pass — lint 0 errors/36 pre-existing warnings; vitest 571/571 (67 files); vite build clean; root suite 2672 pass / 0 fail
- Date: 2026-08-25
- Notes: Lockfile holds only @trpc/client|react-query|server 11.18.0 and @tanstack/react-query 5.102.3 (no tRPC 10 / Query 4 remnants); transformer moved to httpBatchLink; gates.tsx mutations rewritten to mutateAsync + try/catch/finally with byte-identical feedback-state sequence; useContext → useUtils; `--legacy-peer-deps` still required. Session 880fa2ec-ce7a-40ae-a1d3-b06058c87898, both verifications executed and recorded (exit 0).
