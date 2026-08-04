# Amber Protocol 1.3.12 Release Readiness

Generated: 2026-08-04 (refreshed after release-candidate gates)
Status: READY FOR HUMAN RELEASE GATES (tag/push/publish intentionally deferred)
Scope: readiness evidence only; no tag, push, or publish performed for 1.3.12.

## Release Baseline

- Current package version: `1.3.12` (local, uncommitted metadata).
- Claude/Codex plugin manifests: `1.3.12` (aligned via `version:sync`).
- Latest remote stable tag: `v1.3.11`.
- Registry latest: `1.3.11`.
- `release:verify`: 13 stable tags present remotely and published; no ghost or unpushed stable tags.
- Local `master` is aligned with `origin/master` (`aheadOfOrigin=0`); all prior commits pushed.
- CI green on the last pushed state: run 30894011845 (identity, test, coverage, security, performance, web).
- Governance readiness: 100/100, zero findings, zero next actions.

## Release Candidate Verification (Node 22.19.0)

All gates rerun against the 1.3.12 release candidate after metadata sealing:

- [x] `npm test`: full suite passes (1416 total, 1412 passed, 4 skipped, 0 failed).
- [x] `npm run test:coverage`: 90.1% statements, 79.13% branches, 96% functions, 90.1% lines.
- [x] `npm run test:load`: 20 sessions, 0 failures, under 2 minutes.
- [x] `npm run lint`: ESLint clean.
- [x] `npm run gen:agents:check`: 28 generated command files current.
- [x] `npm run manifests`: 0 errors.
- [x] `npm run doctor`: 0 errors / 0 warnings.
- [x] `node scripts/check-broken-links.js`: all 177 Markdown files valid.
- [x] `npm audit --audit-level=high`: 0 vulnerabilities.
- [x] `npm pack --dry-run --json`: `amber-protocol-1.3.12.tgz`, 226 entries.
- [x] CHANGELOG sealed: `[Unreleased]` content moved to `[1.3.12] - 2026-08-04`; fresh empty `[Unreleased]` created.
- [x] CHANGELOG 1.3.12 section now includes F012 (pre-push pi-rewind checkpoint guard) and `fast-uri` 3.1.4 -> 3.1.5 security bump entries.

## Closed During Readiness

### B1 - High dependency advisory (closed)

- Updated transitive `brace-expansion@5.0.8` to patched `5.0.9`; `npm audit` reports 0 vulnerabilities.
- Follow-up advisory addressed: `fast-uri` 3.1.4 -> 3.1.5 (GHSA-7p8r-x3mc-p8w7).

### B2 - Coverage unavailable in prior install (closed)

- Restored declared dev dependencies; coverage runs under the project runtime `volta run --node 22.19.0` (ambient Node 20.18.1 is below engine).

### B3 - Remote CI not current (closed)

- All commits pushed to `origin/master`; CI run 30894011845 green across all required jobs.

### B4 - Release metadata not finalized (closed)

- `package.json`, `package-lock.json`, README badge, and both plugin manifests read `1.3.12`.
- CHANGELOG `[Unreleased]` content dated as `[1.3.12] - 2026-08-04`; fresh empty `[Unreleased]` section added.

## Remaining Release Steps (all behind explicit human approval)

1. Commit release metadata (5 version files + CHANGELOG + this readiness artifact).
2. Human approval: create annotated tag `v1.3.12` and push commit + tag.
3. Let tag-triggered CI publish to npm (`refs/tags/v*`); do not run a competing manual `npm publish`.
4. Post-release:
   - `npm run release:verify`
   - `npm view amber-protocol version` -> `1.3.12`
   - clean install smoke test and `amber --version` -> `1.3.12`
   - verify GitHub Release exists.
5. Refresh `session-handoff.md` (`amber handoff`) after the metadata commit.

## Non-Blocking Observation

- Repo-wide `npm run format:check` reports broad historical/generated-file drift and is not a current CI or maintained release-checklist gate.
- No bulk formatting was applied; doing so would create unrelated churn. ESLint and `git diff --check` pass.

## Explicitly Not Performed (awaiting human gate)

- [ ] Release commit (metadata staged locally, uncommitted).
- [ ] Tag `v1.3.12`.
- [ ] Push to GitHub.
- [ ] npm publish (CI will handle on tag push).
