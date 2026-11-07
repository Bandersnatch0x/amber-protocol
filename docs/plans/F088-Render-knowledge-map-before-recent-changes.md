# Plan: Render knowledge map before recent changes

Feature: F088
Status: implementation-ready
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

- [ ] Slice 1: gate the initial recent feed on graph data and verify blocked-feed rendering with real graph counts.
  - paths: apps/web/src/features/knowledge/KnowledgeMapPage.tsx, apps/web/tests/client/KnowledgeMapPage.test.tsx, apps/web/tests/e2e/knowledge.spec.ts
  - depends-on: none
  - verify: npm --prefix apps/web run test -- tests/client/KnowledgeMapPage.test.tsx
- [ ] Slice 2: document the first-map contract and measured evidence.
  - paths: docs/specs/F088-knowledge-first-load.md, docs/plans/F088-Render-knowledge-map-before-recent-changes.md
  - depends-on: 1
  - verify: node scripts/amber.js gate --target . --plan docs/plans/F088-Render-knowledge-map-before-recent-changes.md
- [ ] Slice 3: record feature verification and the user-visible fix.
  - paths: feature_list.json, CHANGELOG.md
  - depends-on: 1, 2
  - verify: npm run manifests

## Resume Checkpoint

- Resume Point: baseline trace and five alternating API samples per request pattern captured; the existing query-option change and behavior regressions are delegated.
- Blockers: none. The user's continuation authorizes this fix and its verification.
- Next Action: complete the focused fix and fix-then-revert proof, then collect final cold-browser and full-suite evidence before independent review.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

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
