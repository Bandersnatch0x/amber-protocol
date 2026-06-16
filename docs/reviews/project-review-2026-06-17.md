# Amber Protocol — Project Review (2026-06-17)

**Reviewer role:** Fresh-agent continuation after handoff  
**Scope:** Full product-repo inspection + follow-up implementation from review suggestions  
**Date:** 2026-06-17  
**Workspace:** `coding-harness` (Amber Protocol source repository)

---

## Executive Summary

Amber Protocol is a healthy, governance-first product repository. Self-verification surfaces (`doctor`, manifest validation, `gen:agents:check`) pass with zero errors. Architecture, boundaries, and documentation remain aligned with the stated non-goals (no live execution, dry-run first, idempotent scaffolding).

This review round closed three follow-up tracks from the prior session:

1. **CI/docs branch completion** — web viewer job, `gen:agents:check`, `amber.js` smoke check, bilingual README phase/CI alignment, animated brand logo.
2. **Platform hardening** — cross-platform test discovery, product-repo audit messaging, user-facing Amber naming cleanup.
3. **Review persistence** — this document under `docs/reviews/`.

No blockers were found. All changes are additive and preserve product boundaries.

---

## Self-Verification Evidence

| Surface | Result |
| --- | --- |
| `doctor --target . --summary` | Pass — `product-repo`, 0 errors |
| `audit --target . --summary` | Expected gaps for product repo; now includes `Target type: product-repo` and explanatory notes |
| `npm run manifests` | 0 errors |
| `npm run gen:agents:check` | Up to date |
| `npm test` (via `scripts/run-tests.js`) | Cross-platform file discovery |
| Web Vitest + Playwright | Wired into CI `web` job |
| `apps/web` production build | Pass after aligning `@tanstack/react-query` v4 with `@trpc/react-query` v10 |

---

## Architecture & Compliance

**Control layer priority** remains correct: Governance → Verification → Observability → Lifecycle → Context → Tooling → Execution (minimal).

**Boundaries respected:**

- `init` / `wiki` skip existing files
- `audit` / adoption reports are read-only on targets
- Loop surfaces remain record-only; `readyForLiveScheduling` stays `false`
- Legacy `.harness/` readable via shims; `amber migrate` available

**Phase claims** now match implementation in README (EN + zh-CN): Phase B GA, Phase C (web viewer + CI e2e), Phase D partial.

---

## Findings Addressed in This Session

### A1. Windows `npm test` discovery (Medium)

**Problem:** `node --test tests/` fails on Windows because Node treats `tests/` as a module path instead of recursively discovering `*.test.js` files.

**Fix:** Added `scripts/run-tests.js` to collect `*.test.js` files and invoke `node --test` with explicit paths. Updated `test`, `check`, `test:load`, and `test:e2e` npm scripts.

### A2. Product-repo audit noise (Medium)

**Problem:** Running `audit` on the Amber source repo reported missing starter files without explaining that this is expected for the product repository.

**Fix:** `auditProject` now includes `classification` from `classifyTarget`. Summary output prints `Target type: product-repo` and notes that starter scaffolds live under `templates/`. Audit doc walks ignore `.claude/` trees to reduce agent-worktree noise.

### A3. Legacy “Harness” user-facing labels (Low)

**Problem:** Audit/adoption CLI output still said “Harness files” after the Amber Protocol rename.

**Fix:** User-facing strings now read “Amber starter files”. Added `MINIMUM_AMBER_FILES` / `REQUIRED_AMBER_FILES` aliases alongside legacy constant names for internal compatibility.

### A4. CI / docs drift (Low)

**Problem:** README Phase C still said “scaffold only”; CI lacked web e2e and `gen:agents:check`.

**Fix:** `.github/workflows/ci.yml` adds `web` job and `gen:agents:check`; README EN/zh-CN document the expanded CI matrix and implemented Phase C.

---

## Remaining Suggestions (Not Blockers)

| Item | Priority | Notes |
| --- | --- | --- |
| Internal constant rename (`MINIMUM_HARNESS_FILES` → identifiers only) | Low | Aliases added; full rename deferred to avoid wide internal churn |
| Deeper Phase B regression pass | Optional | Budget persistence, migrate logging — spot-check when touching execution paths |
| Full load test on Windows | Optional | `test:load` works via runner; broad load suite still slow |
| `session-handoff.md` on product repo | N/A | Intentionally absent; `handoff` fails by design on source repo |
| Example adoption artifacts under `docs/examples/` | N/A | Historical records retain legacy “Harness” wording by allowlist policy |

---

## Recommended Next Commands

```sh
npm test
npm run manifests
npm run doctor
npm run gen:agents:check
node scripts/amber.js audit --target . --summary
```

For target-repo adoption work, start with `amber audit` and `amber doctor` on the external path — not on this product repository.

---

## Review Artifact Index

Prior rounds remain authoritative for their scopes:

- `docs/reviews/correctness-review.md` / `correctness-review-round2.md`
- `docs/reviews/maintainability-review.md` / `maintainability-review-round2.md`
- `docs/reviews/tests-review-round2.md`
- `docs/reviews/docs-review-round3.md`

This file captures the 2026-06-17 holistic review and the follow-up implementation pass.