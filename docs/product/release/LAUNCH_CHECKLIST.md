# Launch Checklist - Amber Protocol v1.0.0

**Release Date:** 2026-06-22  
**Version:** 1.0.0  
**Status:** Local validation passed; GitHub repository created; npm publication pending maintainer npm credentials.

---

## Local Release Gates

- [x] Version bumped to `1.0.0` in `package.json` and `package-lock.json`
- [x] Plugin manifests bumped to `1.0.0`
- [x] README status updated to stable
- [x] CHANGELOG dated for v1.0.0
- [x] Release notes updated for Amber Protocol terminology
- [x] `npm test` passes
- [x] `npm run test:coverage` passes configured thresholds
- [x] `npm run test:load` passes
- [x] `npm run gen:agents:check` passes
- [x] `npm run manifests` passes
- [x] `node scripts/amber.js doctor --target .` passes
- [x] `node scripts/check-broken-links.js` passes
- [x] `npm audit --audit-level=high --registry=https://registry.npmjs.org` passes
- [x] `node scripts/publish.js --dry-run` passes
- [x] `amber --version` regression coverage added and passing

## Publishing Prerequisites

- [x] Configure/verify `origin` remote
- [ ] Confirm local branch is up to date with remote `master`
- [x] Commit release changes with `chore: release v1.0.0`
- [x] Create signed `v1.0.0` tag, or annotated tag if GPG is unavailable
- [ ] Verify tag signature when a signed tag is used
- [x] Push `master` to origin
- [x] Push `v1.0.0` tag to origin
- [ ] Confirm npm account with `npm whoami` (currently returns `ENEEDAUTH`)
- [ ] Publish stable package with `npm publish --access public`
- [ ] Verify `npm view amber-protocol version` returns `1.0.0`
- [ ] Install from registry and verify `amber --version`
- [ ] Create GitHub release from `v1.0.0`
- [ ] Mark GitHub release as latest

## Announcement Checklist

- [ ] Publish release announcement
- [ ] Share installation command: `npm install -g amber-protocol`
- [ ] Link to release notes and changelog
- [ ] Monitor npm package page after publish
- [ ] Monitor GitHub issues after release

## Rollback Plan

If a critical issue is discovered after publication:

1. Do not unpublish the package.
2. Deprecate the affected version with a clear message.
3. Create a hotfix branch from `v1.0.0`.
4. Publish a patch release after the same local validation gates pass.
5. Update the GitHub release notes with the issue and mitigation.

## Sign-Off

- [ ] Engineering lead
- [ ] Security review
- [ ] Documentation review
- [ ] Release manager
