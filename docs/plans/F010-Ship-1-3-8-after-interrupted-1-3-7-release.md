# Plan: Ship 1.3.8 after interrupted 1.3.7 release

Feature: F010
Status: implementation-ready
User Confirmation: confirmed

## Goal

Complete the interrupted `v1.3.7` ship: tag CI failed after the version bump, so no GitHub Release was created. Land the two post-tag master fixes (docs boundary allowlist + `fast-uri` 3.1.4) under a clean **1.3.8** CHANGELOG entry and version so the next tag can publish successfully.

## High Level Design

- Context: `chore(release): 1.3.7` tagged `v1.3.7` while master still had (1) a docs-boundary test failure for `--mode autonomous` in `session-lifecycle.md`, and (2) a high `fast-uri` advisory that failed the Security job. Both are fixed on master (`009290f`, `d2d4ca1`) but are not versioned as a release.
- Proposed approach: Add a `[1.3.8]` CHANGELOG section for those two fixes; bump `package.json` / lock metadata to `1.3.8` via existing sync scripts if present; keep product code unchanged.
- Risks: Low. No runtime behavior change. Avoid retagging `v1.3.7`. Do not force-push tags. Tagging/publish can be a follow-up after this slice is accepted.

## Vertical Slices

- [x] Slice 1: Document 1.3.8 Fixed notes and bump package version to 1.3.8 (CHANGELOG + package.json + lock version field).

## Resume Checkpoint

- Resume Point: slice 1 implemented (1.3.8 CHANGELOG + version + version:sync); awaiting session verify --execute and terminal lifecycle.
- Blockers: none.
- Next Action: commit, `session start` bound to F010, `session verify --execute`, approve gates, handoff, complete-check --strict, complete, accept.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `package.json` version is `1.3.8`.
- CHANGELOG has a `[1.3.8]` section covering docs-boundary allowlist + `fast-uri` 3.1.4.
- `npm test` exits 0 (session verify --execute).
- Existing Amber guardrails still pass (`doctor` / manifests if touched — not required for version-only).

## Verification

- `node -e "console.log(require('./package.json').version)"` → `1.3.8`
- `npm test`
- `npm audit --audit-level=high` → 0 vulnerabilities

## Evidence Schema

- Command: `npm test`
- Result: exit 0
- Date: 2026-07-22
- Notes: weekly dogfood F010; real evidence via `session verify --execute`
