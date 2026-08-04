# Amber Protocol 1.3.12 Release Readiness

Generated: 2026-08-04
Status: BLOCKED (B3 remote CI and B4 release metadata)
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
- [x] Broken-link scan: all 177 Markdown files valid after correcting three stale links.
- [x] Package dry-run: 226 entries, 308357-byte tarball, 1101172 bytes unpacked.
- [x] Package includes `scripts/amber.js`, `templates/`, `routes/`, `schemas/`, `README.md`, and `LICENSE`.
- [x] Package excludes `tests/`, `.github/`, and `docs/superpowers/`.
- [x] Encoding validation passed.
- [x] Current tag/registry reality check passed (`npm run release:verify`).
- [x] Targeted dependency fix: `brace-expansion` 5.0.8 -> 5.0.9; lock diff changed only version, resolved URL, and integrity.
- [x] Security audit after clean install: 0 vulnerabilities.
- [x] Coverage under the project-supported Node 22.19.0 runtime: 1416 total, 1412 passed, 4 skipped, 0 failed; 90.1% statements, 79.13% branches, 96% functions, 90.1% lines.
- [x] ESLint passes under Node 22.19.0.

## Closed During Readiness

### B1 - High dependency advisory (closed)

- Updated transitive `brace-expansion@5.0.8` to patched `5.0.9` through the existing `minimatch@10.2.5` range.
- `package-lock.json` changed exactly three lines: version, resolved URL, and integrity.
- `npm ci --include=dev` installed 117 packages from the lockfile and reported 0 vulnerabilities.
- Final `npm audit --audit-level=high --registry=https://registry.npmjs.org`: 0 vulnerabilities.

### B2 - Coverage unavailable in prior install (closed)

- Restored declared dev dependencies; `c8@12.0.0` is installed.
- The ambient Node 20.18.1 shell is below the repository's declared engine and cannot run c8 12 correctly.
- Used the already-installed project runtime via `volta run --node 22.19.0`.
- Coverage passed with the full 1416-test suite and the percentages recorded above.

## Remaining Release Blockers

### B3 - Remote CI not current

- Local `master` was ahead of `origin/master` before this readiness pass; the new security lock update and readiness evidence are also local.
- Required action: commit reviewed blocker fixes, then push only with explicit external-write approval and wait for all required CI jobs: identity, test, coverage, security, performance, and web.

### B4 - Release metadata not finalized

- `package.json`, lockfile, README badge, and plugin manifests still correctly read `1.3.11`.
- CHANGELOG content remains under `[Unreleased]`.
- Required action only after B1-B3: bump to `1.3.12`, run `npm run version:sync`, date the CHANGELOG section, and review the resulting diff.

## Remaining Preparation Sequence

1. Commit the reviewed `brace-expansion` lock update and refreshed readiness evidence.
2. Push `master` only with explicit external-write approval; wait for required CI.
3. Bump `package.json` and `package-lock.json` to `1.3.12`.
4. Run `npm run version:sync`; verify README and both plugin manifests read `1.3.12`.
5. Move current `[Unreleased]` content to `[1.3.12] - <date>` and create a fresh empty `[Unreleased]` section.
6. Rerun all release gates under Node 22.19+ and inspect `npm pack --dry-run --json` as `amber-protocol@1.3.12`.
7. Commit release metadata, create annotated `v1.3.12`, and push commit/tag only after explicit human approval.
8. Let tag-triggered CI publish to npm; do not run a competing manual `npm publish`.
9. Post-release:
    - `npm run release:verify`
    - `npm view amber-protocol version` -> `1.3.12`
    - clean install smoke test and `amber --version` -> `1.3.12`
    - verify GitHub Release exists.

## Non-Blocking Observation

- Repo-wide `npm run format:check` reports broad historical/generated-file drift and is not a current CI or maintained release-checklist gate.
- No bulk formatting was applied; doing so would create unrelated churn. ESLint and `git diff --check` pass.

## Explicitly Not Performed

- [ ] Version bump.
- [ ] Release commit or tag.
- [ ] Push to GitHub.
- [ ] npm publish.
- [ ] GitHub Release creation.

## Decision

`1.3.12` is not release-ready until B3 (current remote CI) and B4 (release metadata) are closed with fresh evidence. B1 and B2 are closed locally.
