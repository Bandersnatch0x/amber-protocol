# v1.0.0 Release Validation Report

## Release Information

- **Version:** 1.0.0
- **Validation Date:** 2026-06-22
- **Validator:** Codex CLI
- **Scope:** Local release readiness, package dry-run, security gate, documentation checks, and Amber product self-validation.

## Executive Summary

- **Status:** PASS WITH PUBLISHING ACTIONS REMAINING
- **Assessment:** Local quality gates, package validation, documentation links, and high-severity security audit are passing. Public publication still requires maintainer credentials and repository remote/tag operations.

## Validation Environment

| Environment | OS | Node Version | npm Version | Status |
| --- | --- | --- | --- | --- |
| Local Dev | Windows PowerShell | Node from active toolchain | npm from active toolchain | PASS |
| Docker Alpine | Not run in this session | Not verified | Not verified | PENDING |
| Docker Debian | Not run in this session | Not verified | Not verified | PENDING |
| CI/CD | Not run in this session | Not verified | Not verified | PENDING |

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `node scripts/amber.js doctor --target .` | PASS | Product checks: plugin manifests, workflow-pack smoke, project-profile smoke; errors 0. |
| `npm test` | PASS | 886 tests passed, 0 failed. |
| `npm run test:coverage` | PASS | 886 tests passed; 89.23% statements, 79.01% branches, 95.48% functions. |
| `npm run test:load` | PASS | Sequential 20-session load test completed under 2 minutes. |
| `npm run gen:agents:check` | PASS | 28 generated agent command files up to date. |
| `npm run manifests` | PASS | Manifest validation errors 0. |
| `node scripts/check-broken-links.js` | PASS | 108 markdown files checked, all links valid. |
| `npm audit --audit-level=high --registry=https://registry.npmjs.org` | PASS after dependency update | Nodemailer upgraded to 9.0.1 to resolve GHSA-p6gq-j5cr-w38f. |
| `node scripts/publish.js --dry-run` | PASS | Package dry-run includes required files. |
| `node --test tests/amber-cli.test.js` | PASS | Includes regression coverage for `amber --version`. |

## Package Validation

`node scripts/publish.js --dry-run` verified the npm package contains the required release surfaces:

- `package.json`
- `README.md`
- `scripts/amber.js`
- `scripts/lib/`
- `schemas/`
- `templates/`

The dry-run tarball also includes routes, profiles, workflow packs, source modules, license, and changelog.

## Security Observations

- Previous blocker: `nodemailer <=9.0.0` high-severity advisory GHSA-p6gq-j5cr-w38f.
- Resolution: upgraded to `nodemailer@9.0.1` and refreshed `package-lock.json`.
- Current status: high-severity npm audit gate passes against `https://registry.npmjs.org`.

## Known Publishing Actions Remaining

These are not local code blockers, but they must be completed by a maintainer before declaring the public v1.0.0 release live:

1. Configure/verify `origin` remote for `Bandersnatch0x/amber-protocol`.
2. Commit the release changes with `chore: release v1.0.0`.
3. Create and verify the `v1.0.0` tag from the release commit.
4. Push `master` and the `v1.0.0` tag.
5. Confirm npm account with `npm whoami`.
6. Publish with `npm publish --access public`.
7. Verify registry installation and `amber --version` from the published package.
8. Create the GitHub release and mark it as latest.

## Recommendation

The repository is locally ready for a v1.0.0 release commit once the final verification pass remains green. Public release should wait until the publishing actions above are complete.
