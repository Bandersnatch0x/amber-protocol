# Amber Protocol 1.5.0 Release Readiness

Generated: 2026-08-10
Status: RELEASED
Scope: release complete.

## Release Baseline

- Published package version: `1.5.0` (minor release for the governed Context
  knowledge lifecycle introduced after `v1.4.1`).
- `package.json`, `package-lock.json`, README, and both plugin manifests are
  aligned at `1.5.0`.
- Latest local/remote stable tag and npm registry version: `v1.5.0` / `1.5.0`.
- Annotated tag `v1.5.0` resolves to `029e07f`; the same commit was pushed to
  `origin/master` before tagging.
- Governance readiness: 100/100, with no next actions.

## Release Candidate Verification

Verified on Node `v24.2.0`:

- [x] `npm test`: 1649 total, 1645 passed, 4 skipped, 0 failed.
- [x] `npm run test:coverage`: 90.22% statements, 79.43% branches, 96.39%
  functions, and 90.22% lines.
- [x] `npm run test:load`: 20 sequential sessions completed in 7.1 seconds; 0
  failures.
- [x] `npm run lint`: ESLint clean.
- [x] `npm run typecheck`: TypeScript clean.
- [x] `npm run gen:agents:check`: 31 generated files current.
- [x] `npm run manifests`: 0 errors.
- [x] `npm run doctor`: 0 errors and 0 warnings.
- [x] `node scripts/validate-wiki.js --target .`: 0 errors.
- [x] `node scripts/check-broken-links.js`: all 189 Markdown files valid.
- [x] `node scripts/amber.js governance report --target .`: ready, 100/100.
- [x] `node scripts/amber.js handoff validate --target .`: latest bundle valid.
- [x] `npm audit --audit-level=high`: 0 vulnerabilities at every severity.
- [x] `npm pack --dry-run --json`: `amber-protocol-1.5.0.tgz`, 258 files,
  367219 bytes packed, 1329216 bytes unpacked, no warnings.
- [x] `npm run release:verify`: 16 existing stable tags are published; latest
  registry version is `1.4.1`.
- [x] `git diff --check`: no whitespace errors.

## Release Contents

### Added

- Governed Knowledge Kind and forward-lineage validation for Context Pages.
- Current-only Loadout assembly and derived projections.
- Deterministic Context benchmarks, source-adapter contracts, report-only
  retention metrics, and dependency-boundary protections.

### Changed

- Context schemas, CLI behavior, verification errors, architecture guidance, and
  lifecycle documentation now cover the expanded assurance model.
- F016/F017 governance evidence is reconciled without granting retrospective
  acceptance to F017.

## Post-Publish Verification

- [x] `master` push CI completed successfully at `029e07f`.
- [x] Annotated tag `v1.5.0` was pushed and resolves to `029e07f` locally and
  remotely.
- [x] Tag-triggered CI completed successfully.
- [x] GitHub Packages publish workflow completed successfully.
- [x] `npm run release:verify`: 17 stable tags are published; latest registry
  version is `1.5.0`.
- [x] `npm view amber-protocol version`: `1.5.0`.
- [x] Clean-install smoke test: package metadata, `amber --version`, and
  `coding-harness --version` all report `1.5.0`.
- [x] GitHub Release `v1.5.0` exists, is published, and is neither a draft nor a
  prerelease.
- [x] No competing manual `npm publish` was run.

## Remaining Release Steps

All release steps completed. No further action is required for `1.5.0`.

## Non-Blocking Observation

- The repository-wide Prettier check reports broad historical formatting drift,
  including five release metadata files. This check is not part of the current CI
  or publish workflow; lint and whitespace validation pass. Avoid a whole-repo
  formatting rewrite in the release commit.
