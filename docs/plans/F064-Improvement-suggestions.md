# Plan: Improvement Suggestions (web, multi-host)

Feature: F064
Status: proposed
User Confirmation: confirmed (web mount, multi-host, knowledge-file Apply only)

## Goal

Operators can open the web viewer, see Improvement Suggestion cards clustered from Claude, Codex, and Cursor transcripts for this repository, and Apply / Dismiss / Snooze / Undo a wiki friction note — never product code, never a new default CLI verb.

## High Level Design

- Context: Session Lens already reads Claude transcripts and can propose regressions. Learnings, break-loop, and maintain propose already encode "observe, don't auto-write". The missing last mile is a web card with evidence count, host union, and an allowlisted Apply.
- Approach: one suggestions module behind tRPC. Host adapters emit tool-failure signals; a fingerprint clusters them; promotion requires two transcripts; the planner emits a wiki create/update; the store overlays dismiss/snooze/applied; Apply is all-or-nothing with content hashes.
- Risks: (1) host format drift — adapters fail empty, never throw or leak other repos; (2) wiki Apply in a dirty tree — optimistic hash refuses the whole card; (3) nav crowding — one nav item plus a home surface entry, no sixth home block.

## Context manifests

- implement: docs/specs/F064-improvement-suggestions.md, CONTEXT.md, docs/wiki/agent/failure-patterns.md, docs/wiki/agent/continuous-improvement.md
- review: docs/specs/F064-improvement-suggestions.md, docs/adr/0001-product-boundary.md, docs/adr/0014-routing-advisor.md

## Tickets

1. Host adapters + cluster/promote (Claude, Codex, Cursor; threshold 2).
2. Allowlisted Apply / Undo + overlay store.
3. Web route `/suggestions`, nav, home entry, i18n.
4. Unit, router, and Playwright coverage.

## Exit

`apps/web` vitest green for the new suites; Playwright suggestions spec green; no new default CLI verb; Apply refused on a non-allowlisted path.
