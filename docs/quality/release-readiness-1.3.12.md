# Amber Protocol 1.3.12 Release Readiness

Generated: 2026-08-04 (final after tag/push/publish)
Status: RELEASED
Scope: release complete.

## Release Baseline

- Published package version: `1.3.12` (registry).
- Claude/Codex plugin manifests: `1.3.12`.
- Latest remote stable tag: `v1.3.12`.
- Registry latest: `1.3.12`.
- `release:verify`: 14 stable tags present remotely and published; no ghost or unpushed stable tags.
- Local `master` is aligned with `origin/master`; release commits pushed and CI green.
- Governance readiness: 100/100, zero findings, zero next actions.
- GitHub Release `v1.3.12` exists, created by `github-actions[bot]`, not draft/prerelease.

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

## Post-Publish Verification

- [x] `npm run release:verify`: OK — 14 stable tags all published (latest registry: 1.3.12).
- [x] `npm view amber-protocol version`: `1.3.12`.
- [x] Clean-install smoke (`npm install amber-protocol@latest`):
  - `amber --version` -> `1.3.12`.
  - `coding-harness --version` -> `1.3.12`.
- [x] GitHub Release `v1.3.12` exists at https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.3.12.
- [x] CI publish completed automatically from tag push; no manual `npm publish` was run.

## Remaining Release Steps

All release steps completed. No further action required for 1.3.12.

## Non-Blocking Observation

- Repo-wide `npm run format:check` reports broad historical/generated-file drift and is not a current CI or maintained release-checklist gate.
- No bulk formatting was applied; doing so would create unrelated churn. ESLint and `git diff --check` pass.

## Explicitly Not Performed (awaiting human gate)

- [ ] Release commit (metadata staged locally, uncommitted).
- [ ] Tag `v1.3.12`.
- [ ] Push to GitHub.
- [ ] npm publish (CI will handle on tag push).
