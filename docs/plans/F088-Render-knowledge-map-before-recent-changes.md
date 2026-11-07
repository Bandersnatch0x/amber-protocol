# Plan: Render knowledge map before recent changes

Feature: F088
Status: verified
User Confirmation: confirmed

## Goal

The knowledge map renders from its graph response before the initial recent-change feed is requested; a slow recent feed cannot hold the initial graph batch.

## High Level Design

- Context: issue #400 records the non-streaming batch dependency between graph and recent changes. Diagnostic spans show the second graph build and maintenance work inside the recent-change query.
- Proposed approach: enable the existing recent-change query when graph data exists. Use the existing graph DTO as readiness state and preserve every other query option.
- Risks: recent-feed loading and manual refresh must still work, cached graph data must remain usable, and graph errors must not accidentally start the initial feed. A blocked-feed browser regression proves the response dependency is removed.

## Context manifests

- implement: docs/specs/F088-knowledge-first-load.md, docs/specs/F059-knowledge-decision-map.md, docs/specs/F060-knowledge-map-v2-code-graph.md
- review: docs/specs/F088-knowledge-first-load.md, docs/specs/F059-knowledge-decision-map.md, docs/specs/F060-knowledge-map-v2-code-graph.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [x] Slice 1: gate the initial recent feed on graph data and verify blocked-feed rendering with real graph counts.
  - paths: apps/web/src/features/knowledge/KnowledgeMapPage.tsx, apps/web/tests/client/KnowledgeMapPage.test.tsx, apps/web/tests/e2e/knowledge.spec.ts
  - depends-on: none
  - verify: npm --prefix apps/web run test -- tests/client/KnowledgeMapPage.test.tsx
- [x] Slice 2: document the first-map contract and measured evidence.
  - paths: docs/specs/F088-knowledge-first-load.md, docs/plans/F088-Render-knowledge-map-before-recent-changes.md
  - depends-on: 1
  - verify: node scripts/amber.js gate --target . --plan docs/plans/F088-Render-knowledge-map-before-recent-changes.md
- [x] Slice 3: record feature verification and the user-visible fix.
  - paths: feature_list.json, CHANGELOG.md
  - depends-on: 1, 2
  - verify: npm run manifests

## Resume Checkpoint

- Resume Point: the query-option fix and regressions are implemented. Root tests, Web unit tests, production build, full browser suite and separate semantic cases pass. Delivery is pending publication.
- Blockers: independent Standards and Spec review and merge into the default branch remain required.
- Next Action: resolve independent review findings, publish and merge the implementation, then accept and book the learning review.
- Recovery Instructions: reopen this plan and the retained evidence under `.scratch/knowledge-timeout/`; verify the reviewed revision before publishing.

## Acceptance Criteria

- The real map renders before a deliberately held recent-change request is released, using default test timeouts.
- Existing Amber guardrails and phase boundary remain intact. Graph content and freshness checks, live recent-feed refresh and semantic consent are preserved.

## Verification

- Knowledge page renders while the recent feed is deliberately held
- Recent feed still loads and refreshes after graph data arrives

## Evidence Schema

- Command: focused client tests, blocked-feed browser regression, cold browser replays, full Web tests, root tests, manifests, doctor, generated checks and wiki validation.
- Result: complete logs and comparison artifacts under `.scratch/knowledge-timeout/`; record actual exits, outputs and every failed attempt before acceptance.
- Date: 2026-11-07
- Notes: API comparisons use the same fixed corpus and fresh server process per sample with warm OS caches. Profiled diagnostic runs are excluded from latency comparisons. The mobile timeout is a separate investigation, not evidence for this fix.

## Verification results

- Root `npm test`: 4312 tests, 4308 passed, 4 skipped because `sh` is unavailable, 0 failed. Web Vitest: 812 passed. Vite production build exited 0.
- Full real-data Playwright suite: 73 passed, 3 semantic-only cases skipped. Separate semantic-stub run: all 3 passed. Default timeouts and retries were unchanged.
- Clean baseline and temporary removal of the fix both fail the blocked-feed graph assertion at 15000 ms; restoring the fix passes. Five complete cold-browser wrapper runs passed. A sixth browser test passed but its original cleanup wrapper failed; its log and corrected cleanup receipt are retained separately.
- First-map API batch median: 2377.4774 ms before and 1664.9781 ms after, five alternating samples per request pattern. Ranges were 2195.2855 to 2980.0297 ms and 1613.0647 to 1768.2889 ms. All responses were HTTP 200 with identical graph hashes. These numbers exclude startup and later feed completion and do not measure browser rendering.
- Complete logs and hashes are in `.scratch/knowledge-timeout/complete-gate-evidence.json`. Independent evidence review returned PASS+NOTES. Scratch artifacts are local and not version controlled.
- The failed cold wrapper's original inventory included preexisting process identities. The corrected receipt proves eligible recorded descendants absent and ports free; it cannot establish whether unrelated historical processes were affected. The scratch helper now excludes preexisting identities and terminates individual verified PIDs.
- The historical mobile timeout remains untraced and unreproduced after six focused passes and the complete suite. Follow-up: https://github.com/Bandersnatch0x/amber-protocol/issues/401.
