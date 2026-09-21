# Plan: Improvement Suggestions (web, multi-host)

Feature: F064
Status: accepted
User Confirmation: confirmed

## Goal

Operators can open the web viewer, see Improvement Suggestion cards clustered from Claude, Codex, and Cursor transcripts for this repository, and Apply / Dismiss / Snooze / Undo a wiki friction note — never product code, never a new default CLI verb.

## High Level Design

- Context: Session Lens already reads Claude transcripts and can propose regressions. Learnings, break-loop, and maintain propose already encode "observe, don't auto-write". The missing last mile is a web card with evidence count, host union, and an allowlisted Apply.
- Approach: one suggestions module behind tRPC. Host adapters emit tool-failure signals; a fingerprint clusters them; promotion requires two transcripts; the planner emits a wiki create/update; the store overlays dismiss/snooze/applied; Apply is all-or-nothing with content hashes.
- Risks: (1) host format drift — adapters fail empty, never throw or leak other repos; (2) wiki Apply in a dirty tree — optimistic hash refuses the whole card; (3) nav crowding — one nav item plus a home surface entry, no sixth home block.

## Context manifests

- implement: docs/specs/F064-improvement-suggestions.md, CONTEXT.md, docs/wiki/agent/failure-patterns.md, docs/wiki/agent/continuous-improvement.md
- review: docs/specs/F064-improvement-suggestions.md, docs/adr/0001-governance-first-artifact-first.md, docs/adr/0014-routing-advisor.md

## Tickets

1. Host adapters + cluster/promote (Claude, Codex, Cursor; threshold 2).
2. Allowlisted Apply / Undo + overlay store.
3. Web route `/suggestions`, nav, home entry, i18n.
4. Unit, router, and Playwright coverage.

## Vertical Slices

- [x] Slice 1: Host adapters + cluster/promote (Claude, Codex, Cursor; threshold 2).
- [x] Slice 2: Allowlisted Apply / Undo + overlay store.
- [x] Slice 3: Web route `/suggestions`, nav, home entry, i18n.
- [x] Slice 4: Unit, router, and Playwright coverage.

## Resume Checkpoint

- Resume Point: all four slices are implemented and verified; the plan is at acceptance.
- Blockers: none.
- Next Action: accept the plan, then close F064.
- Recovery Instructions: reopen this plan and re-run the Verification commands if a suggestions regression is reported; the plan file is the record, do not regenerate it.

## Exit

`apps/web` vitest green for the new suites; Playwright suggestions spec green; no new default CLI verb; Apply refused on a non-allowlisted path.

## Acceptance Criteria

- The web viewer exposes one suggestions surface that clusters tool-failure signals from Claude, Codex, and Cursor transcripts for this repository only; a cluster is promoted only after two distinct transcripts carry it, and each card reports its evidence count and host union.
- Dismiss / Snooze / Undo are overlay-only state; Apply is all-or-nothing against content hashes and refuses the whole card when the wiki file moved under it.
- **Phase boundary:** Apply is confined to the allowlisted knowledge surfaces (`AGENTS.md`, `CLAUDE.md`, `docs/wiki/**/*.md`, `skills/*/SKILL.md`) — never product code, never tests, never `MEMORY.md`. This phase ships as a web mount over tRPC and adds no new default CLI verb.
- A host adapter whose transcript format drifted fails empty — it does not throw, and it never reads a transcript belonging to another repository.
- Existing Amber guardrails still pass: full test suite, manifests, doctor, gen:agents:check.

## Verification

- npm --prefix apps/web run test
- npm --prefix apps/web run test:e2e -- tests/e2e/suggestions.spec.ts
- node scripts/amber.js --help --all
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
