# Plan: apps/web react-hooks production warnings

Feature: F047
Status: accepted
User Confirmation: confirmed

## Goal

apps/web runs with zero react-hooks set-state-in-effect/refs warnings; theme hydration, settings sync, gates pagination reset, and SSE reconnect behavior are unchanged

## High Level Design

- Context: F043 (eslint 10 flat config) surfaced 6 production react-hooks warnings, deliberately deferred: 5× set-state-in-effect + 1× refs. Exact sites (2026-08-26 survey): (1) ThemeToggle.tsx:11 — `setMounted(true)` mount-effect hydration guard; (2) theme-provider.tsx:64 — mount-effect reads localStorage + matchMedia then `setThemeState(resolved)` + applyDOMTheme; (3) routes/settings.tsx:23 — effect copies `globalSettings` into local `persistedSettings`/`settings` state whenever the context value changes; (4) routes/gates.tsx:198 — effect resets `visibleCount` to PAGE_SIZE when `statusFilter` changes; (5) useSessionEvents.ts:126 — effect body calls `setConnectionState('closed')` when sessionId is null (plus a block of per-session state resets); (6) useSessionEvents.ts:90 — `connect.current = () => {...}` assigns a ref during render (the hook keeps its SSE connect/reconnect functions in a ref to break the dependency cycle). Consumers: ThemeProvider mounts once in __root.tsx; useSessionEvents is used only by routes/sessions/$id/index.lazy.tsx and covered by tests/client/useSessionEvents.test.ts + src/lib/hooks/useSessionEvents.test.ts. ThemeToggle tests stub matchMedia (happy-dom lacks it). The app is a client-only SPA (no SSR), so the mount-effect "hydration" patterns are next-themes relics — lazy initializers are safe. Baselines: vitest 571/571, lint 0 errors/36 warnings (6 react-hooks set-state-in-effect/refs + 2 react-hooks/exhaustive-deps + 27 react-refresh + 1 incompatible-library — census corrected 2026-08-26; originally misrecorded as 6 + 29 + 1), build clean, local Playwright E2E 43/43, root suite 2672/0.
- Proposed approach: five slices, each preserving exact behavior. Slice 1 (theme): theme-provider initializes with a lazy `useState(() => resolveTheme(readStoredTheme()))` (client-only SPA — no SSR mismatch to guard), keeps a DOM-sync effect (`applyDOMTheme(theme)` on theme change — the canonical legitimate effect) and the existing matchMedia-change listener; ThemeToggle drops the `mounted` state entirely (theme is defined from first render) — button enabled immediately, title/icon from theme. Slice 2 (settings page): replace the copy-prop-into-state effect with the react.dev render-time adjustment pattern (`if (prevGlobal !== globalSettings) { setPrevGlobal(...); setPersistedSettings(...); setSettings(...) }`) — the documented replacement for "adjust state when a prop changes". Slice 3 (gates): same render-time adjustment for `visibleCount` reset on `statusFilter` change. Slice 4 (SSE hook): move the per-session state resets (status/events/lastEvent/error/reconnectAttempt/connectionState) into a render-time adjustment keyed on sessionId (connectionState initial value derives: sessionId ? 'connecting' : 'closed'); restructure the hook so connect/scheduleReconnect/closeEventSource are defined INSIDE the single useEffect (closures replace the `connect.current` ref — warning 6 dies structurally, and the backoff timeout can call the local connect directly); manualReconnect becomes a plain callback that resets attempt state, sets 'connecting', and bumps a `reconnectNonce` state the effect depends on (event-handler setState is allowed). Slice 5 (full verification): lint must report 0 react-hooks set-state-in-effect/refs warnings (30 total remaining: 29 react-refresh + 1 incompatible-library, both out of scope); vitest 571 baseline (tests directly cover ThemeToggle click-to-dark, useSessionEvents connect/reconnect); build; local Playwright E2E 43/43 (transcript-timeline specs exercise the SSE hook end-to-end; home-visual specs exercise theme); root npm test.
- Risks: The SSE hook restructure is the riskiest — behavior surface (backoff timing, online-listener reconnect, manual reconnect, cleanup on session change/unmount) must survive; mitigated by the two dedicated vitest files asserting connect/reconnect semantics plus E2E transcript-timeline coverage, and by keeping the effect's control flow (close→connect→onopen/onerror/backoff) shape-identical with only the ref indirection removed. Theme lazy-init changes first-paint ordering slightly (DOM class applied in effect instead of hydration effect — same frame in practice, and happy-dom tests stub matchMedia before render so the initializer is safe). Render-time setState is guarded conditional state adjustment — React documents it; it does not loop because the guard variable updates in the same pass. i18n.tsx/settings-provider.tsx warnings were checked: neither is in the six (settings-provider's storage listener sets state in a handler — legal; i18n.tsx's warnings are react-refresh export-shape, out of scope).

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/engineering/harness-evolution.md
- review: docs/wiki/engineering/harness-evolution.md

## Vertical Slices

- [x] Slice 1 (theme): lazy-init provider state, DOM-sync effect, drop ThemeToggle `mounted`.
- [x] Slice 2 (settings page): render-time adjustment replacing the globalSettings-copy effect.
- [x] Slice 3 (gates): render-time adjustment replacing the statusFilter-reset effect.
- [x] Slice 4 (SSE hook): render-time per-session reset + effect-local connect (kill the render-phase ref assignment).
- [x] Slice 5 (verification): lint 0 react-hooks warnings, vitest 571/571, build, local E2E 43/43, root suite 2672/0.

## Resume Checkpoint

- Resume Point: implementation complete — all five slices landed; verification green (lint 0 react-hooks warnings, vitest 571/571, build, local E2E 43/43, root 2672/0).
- Blockers: none.
- Next Action: accept, then commit.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `npm run lint` in apps/web reports zero react-hooks/set-state-in-effect and react-hooks/refs warnings (0 errors; 30 warnings remained at acceptance — 27 react-refresh export-shape + 2 react-hooks/exhaustive-deps + 1 react-hooks/incompatible-library, all explicitly out of scope; census corrected 2026-08-26, the exhaustive-deps pair was then fixed — see Review Fixes below).
- Theme behavior unchanged: dark/light toggle applies the html.dark class (ThemeToggle vitest assertions pass; E2E dark-palette spec passes).
- Settings page behavior unchanged: external settings changes reset the local form; dirty-state tracking still works (existing tests green).
- Gates pagination still resets when the status filter changes (gates render tests green).
- SSE behavior unchanged: connect on mount, backoff reconnect on error, manual reconnect, state reset on session change (useSessionEvents tests + E2E transcript specs green).
- apps/web vitest green (571 baseline may grow, never shrink), `npx tsc --noEmit` clean, `npm run build` clean.
- Local Playwright E2E 43/43; root CLI suite unaffected.
- Existing Amber guardrails still pass.

## Verification

- bash .scratch/f047-verify.sh
- npm test (repo root)
- npx playwright test (apps/web, local-chrome)

## Evidence Schema

- Command: bash .scratch/f047-verify.sh (apps/web: tsc; lint; vitest; build) + npm test (root) + npx playwright test (local-chrome)
- Result: pass — tsc clean; lint 0 errors / 30 warnings at acceptance (was 36: all 6 react-hooks set-state-in-effect/refs warnings cleared; remaining 27 react-refresh export-shape + 2 react-hooks/exhaustive-deps + 1 react-hooks/incompatible-library were out of scope — census corrected 2026-08-26, see Review Fixes); vitest 571/571; build clean; local Playwright E2E 43/43; root suite 2672/0
- Date: 2026-08-26
- Notes: theme-provider now lazy-initializes resolved theme (client-only SPA — no SSR mismatch to guard) with a pure DOM-sync effect; ThemeToggle drops the mounted guard (button enabled immediately, title/icon from first render). settings.tsx and gates.tsx replace copy-prop-into-state effects with the react.dev render-time adjustment pattern. useSessionEvents moves per-session state resets to a render-time adjustment (connectionState derives connecting/closed from sessionId presence, lazy-initialized for first mount), restructures connect/scheduleReconnect/closeEventSource inside the single effect (closures replace the render-phase connect.current ref assignment — the backoff timeout calls the local connect directly), and manualReconnect bumps a reconnectNonce the effect depends on. Session 32bfea55-4326-4b2e-ae22-bb6e28621ab3, both verifications executed and recorded (exit 0).

## Review Fixes (2026-08-26)

Two-axis review of v1.6.0..HEAD found the warning census misrecorded: the evidence said "29 react-refresh + 1 incompatible-library" but the actual post-F047 census was 27 react-refresh + 2 react-hooks/exhaustive-deps (src/routes/index.tsx, the sessions/gates conditional initializations) + 1 incompatible-library. All census mentions above are corrected. The exhaustive-deps pair was then fixed by wrapping the sessions/gates conditionals in their own useMemo — lint now reports 0 exhaustive-deps (28 warnings remain: 27 react-refresh + 1 incompatible-library), tsc clean, vitest 571/571.
