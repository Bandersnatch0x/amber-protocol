# Amber Protocol 1.5.0 Release Readiness

Generated: 2026-08-10
Status: READY FOR TAG/PUSH/PUBLISH AFTER WORKTREE CLEANUP
Scope: release preparation and local verification only.

## Release Baseline

- Candidate version: `1.5.0` (minor release for the governed Context knowledge
  lifecycle introduced after `v1.4.1`).
- `package.json`, `package-lock.json`, README, and both plugin manifests are
  aligned at `1.5.0`.
- Latest local/remote stable tag and npm registry version: `v1.4.1` / `1.4.1`.
- `v1.5.0` does not exist locally or remotely.
- Candidate source contains three commits after `v1.4.1`; the release metadata
  is committed at `61843c3`, and local `master` is two commits ahead of
  `origin/master`.
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

## Remaining Release Steps

1. Resolve the three unrelated user-owned working-tree changes separately:
   `docs/quality/release-readiness-1.3.12.md`, `session-handoff.md`, and
   `output/prd-context-knowledge-lifecycle.md`.
2. Push the outstanding source and release commits to `origin/master`; require a
   green CI run before tagging.
3. After explicit human approval, create and push annotated tag `v1.5.0`.
4. Let tag-triggered CI publish to npm and GitHub Packages; do not run a
   competing manual `npm publish`.
5. After the workflows complete, run `npm run release:verify`, confirm registry
   version `1.5.0`, perform clean-install CLI smoke tests, and verify the GitHub
   Release.

## Non-Blocking Observation

- The repository-wide Prettier check reports broad historical formatting drift,
  including five release metadata files. This check is not part of the current CI
  or publish workflow; lint and whitespace validation pass. Avoid a whole-repo
  formatting rewrite in the release commit.
