# Amber Protocol 1.3.12 Release Readiness

Generated: 2026-08-04
Status: BLOCKED
Scope: readiness evidence only; no version bump, tag, push, or publish performed.

## Release Baseline

- Current package version: `1.3.11`.
- Claude/Codex plugin manifests: `1.3.11` (aligned).
- Latest local stable tag: `v1.3.11`.
- Registry latest: `1.3.11`.
- `release:verify`: 13 stable tags present remotely and published; no ghost or unpushed stable tags.
- Changes since `v1.3.11`: 19 commits before this readiness pass.
- Local branch before readiness-doc changes: `master` ahead of `origin/master` by 5 commits.
- Governance readiness: 100/100, zero findings, zero next actions.

## F015 Dogfood Evidence

- `daily-amber-triage` dry-run completed with zero errors/warnings.
- Dry-run boundary: `executesAnything=false`, `schedulesJobs=false`, `callsExternalSystems=false`.
- Local history: 2 records available/considered/loaded; no truncation or partial reads.
- `loop status` outcome: `stalled` (expected dogfood result).
- Signals: `repeated-observation=2`, `empty-evidence-delta=2`.
- History location: `.amber/loops/daily-amber-triage/history/` (local ignored state).

## Passed Gates

- [x] Full test suite: 1416 total, 1412 passed, 4 skipped, 0 failed.
- [x] F015 targeted tests: 20 passed, 0 failed.
- [x] Doctor: 0 errors / 0 warnings.
- [x] Generated agent commands: 28 files current.
- [x] Plugin manifests: 0 errors.
- [x] Load test: 20 sessions completed under 2 minutes.
- [x] Broken-link scan: all 176 Markdown files valid after correcting three stale links.
- [x] Package dry-run: 226 entries, 308271-byte tarball, 1100907 bytes unpacked.
- [x] Package includes `scripts/amber.js`, `templates/`, `routes/`, `schemas/`, `README.md`, and `LICENSE`.
- [x] Package excludes `tests/`, `.github/`, and `docs/superpowers/`.
- [x] Encoding validation passed.
- [x] Current tag/registry reality check passed (`npm run release:verify`).

## Release Blockers

### B1 - High dependency advisory

- `npm audit --audit-level=high` reports one HIGH vulnerability.
- Package: transitive `brace-expansion@5.0.8` through `minimatch@10.2.5`.
- Advisory: `GHSA-rgw5-rvv9-x895` (CWE-400/CWE-770, CVSS 7.5).
- Patched range starts at `brace-expansion@5.0.9`; parent requirement `^5.0.5` permits the patch.
- Required action: approve a targeted lockfile update, inspect the lock diff, then rerun audit and full verification.

### B2 - Coverage unavailable in current install

- `package.json` declares `c8@^12.0.0`, but `node_modules/c8` is absent.
- `npm run test:coverage` cannot start: `'c8' is not recognized`.
- Required action: in a clean release environment, install declared dev dependencies (prefer lockfile-faithful `npm ci --include=dev`) and rerun coverage.
- Do not treat the missing local tool as a passing coverage result.

### B3 - Remote CI not current

- Local `master` was ahead of `origin/master` by 5 commits before this readiness artifact.
- Required action: after blockers B1/B2 are resolved and local gates pass, push reviewed commits and wait for all required CI jobs: identity, test, coverage, security, performance, and web.

### B4 - Release metadata not finalized

- `package.json`, lockfile, README badge, and plugin manifests still correctly read `1.3.11`.
- CHANGELOG content remains under `[Unreleased]`.
- Required action only after B1-B3: bump to `1.3.12`, run `npm run version:sync`, date the CHANGELOG section, and review the resulting diff.

## Approved Preparation Sequence

1. Obtain explicit approval for the targeted `brace-expansion` lockfile update.
2. Restore dev dependencies in a clean environment; run `npm run test:coverage`.
3. Rerun:
   - `npm test`
   - `npm run test:coverage`
   - `npm run test:load`
   - `npm run gen:agents:check`
   - `npm run manifests`
   - `npm run doctor`
   - `node scripts/check-broken-links.js`
   - `npm audit --audit-level=high --registry=https://registry.npmjs.org`
   - `npm pack --dry-run --json`
4. Commit reviewed blocker fixes and this readiness artifact.
5. Push `master` only with explicit external-write approval; wait for required CI.
6. Bump `package.json` and `package-lock.json` to `1.3.12`.
7. Run `npm run version:sync`; verify README and both plugin manifests read `1.3.12`.
8. Move current `[Unreleased]` content to `[1.3.12] - <date>` and create a fresh empty `[Unreleased]` section.
9. Rerun all release gates and inspect `npm pack --dry-run --json` as `amber-protocol@1.3.12`.
10. Commit release metadata, create annotated `v1.3.12`, and push commit/tag only after explicit human approval.
11. Let tag-triggered CI publish to npm; do not run a competing manual `npm publish`.
12. Post-release:
    - `npm run release:verify`
    - `npm view amber-protocol version` -> `1.3.12`
    - clean install smoke test and `amber --version` -> `1.3.12`
    - verify GitHub Release exists.

## Explicitly Not Performed

- [ ] Dependency or lockfile update.
- [ ] Dev dependency installation/reinstallation.
- [ ] Version bump.
- [ ] Release commit or tag.
- [ ] Push to GitHub.
- [ ] npm publish.
- [ ] GitHub Release creation.

## Decision

`1.3.12` is not release-ready until B1 (HIGH advisory), B2 (coverage evidence), B3 (current remote CI), and B4 (release metadata) are closed with fresh evidence.
