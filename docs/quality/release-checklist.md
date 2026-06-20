# Release Checklist

This checklist ensures quality and consistency for Amber Protocol releases.

## Pre-Release Checks

### Code Quality
- [ ] All CI checks passing on master
- [ ] No failing tests (`npm test`)
- [ ] Coverage meets thresholds (`npm run test:coverage`)
- [ ] No HIGH or CRITICAL security vulnerabilities (`npm audit`)
- [ ] Performance benchmarks pass thresholds (`npm run test:load`)
- [ ] Doctor check passes (`npm run doctor`)

### Documentation
- [ ] CHANGELOG.md updated with release notes
- [ ] README badges show correct version
- [ ] All documentation links validated (no broken links)
- [ ] Migration guides updated (if breaking changes)
- [ ] API reference updated (if new commands/options)

### Version Management
- [ ] package.json version updated to target version
- [ ] Version follows Semantic Versioning (MAJOR.MINOR.PATCH)
- [ ] CHANGELOG.md dates updated (replace YYYY-MM-DD)
- [ ] No unresolved CRITICAL/HIGH GitHub issues in milestone

### Package Validation
- [ ] `npm pack --dry-run` runs without errors
- [ ] Package manifest generated: `tar -tzf *.tgz > package-manifest.txt`
- [ ] Required files present in package:
  - [ ] `package/scripts/amber.js`
  - [ ] `package/templates/`
  - [ ] `package/routes/`
  - [ ] `package/schemas/`
  - [ ] `package/workflow-packs/`
  - [ ] `package/profiles/`
  - [ ] `package/src/`
  - [ ] `package/README.md`
  - [ ] `package/LICENSE`
  - [ ] `package/CHANGELOG.md`
- [ ] Excluded files NOT in package:
  - [ ] No `package/tests/`
  - [ ] No `package/.github/`
  - [ ] No `package/docs/superpowers/`
  - [ ] No `package/.git/`
  - [ ] No `package/node_modules/`

## RC Testing (Release Candidates Only)

### Integration Testing
- [ ] Test on oh-my-openagent-dev (or equivalent external project)
- [ ] Core commands verified:
  - [ ] `amber init` creates expected files
  - [ ] `amber audit --summary` completes without errors
  - [ ] `amber doctor` passes all checks
  - [ ] `amber adoption report` generates valid output
- [ ] Test in Docker isolation (see Docker testing section below)

### Simulated External User Testing
- [ ] Install RC globally: `npm install -g amber-protocol@rc`
- [ ] Create empty test project
- [ ] Run `amber init` in empty project
- [ ] Verify created files match templates
- [ ] Run `amber doctor --target .` and verify pass
- [ ] Check `amber --version` shows correct version

### Docker Isolation Testing
```bash
# Build test package
npm pack

# Test in isolated Alpine container
docker run --rm -it -v $(pwd):/workspace node:18-alpine sh -c "
  npm install -g /workspace/amber-protocol-*.tgz
  cd /tmp && mkdir test-project && cd test-project
  amber init
  amber doctor --target .
  amber --version
"

# Test in isolated Debian container (alternative)
docker run --rm -it -v $(pwd):/workspace node:18 sh -c "
  npm install -g /workspace/amber-protocol-*.tgz
  cd /tmp && mkdir test-project && cd test-project
  amber init
  amber audit --summary
  amber --version
"
```

### Validation Report
- [ ] RC validation report created at `docs/quality/rc-validation-report.md`
- [ ] All discovered issues documented
- [ ] CRITICAL/HIGH issues resolved before final release

## Release Execution

### Git Operations
- [ ] Working directory clean (`git status`)
- [ ] On master branch
- [ ] Local branch up to date with remote (`git pull`)
- [ ] Commit message follows format: `chore: release vX.Y.Z`

### Tag Creation
- [ ] GPG signing configured:
  ```bash
  git config user.signingkey <YOUR-GPG-KEY-ID>
  git config tag.gpgSign true
  ```
- [ ] Create signed tag: `git tag -s vX.Y.Z -m "Release vX.Y.Z"`
- [ ] Verify tag signature: `git tag -v vX.Y.Z`

### Push Operations
- [ ] Push commits: `git push origin master`
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Verify tag visible on GitHub

## Publishing

### npm Publication
- [ ] Logged into npm with correct account (`npm whoami`)
- [ ] For RC: `npm publish --tag rc`
- [ ] For stable: `npm publish`
- [ ] Verify package on npm registry: `https://www.npmjs.com/package/amber-protocol`
- [ ] Test install from npm: `npm install -g amber-protocol@X.Y.Z`

### GitHub Release
- [ ] Create release on GitHub:
  ```bash
  gh release create vX.Y.Z \
    --title "vX.Y.Z - Release Title" \
    --notes-file CHANGELOG.md \
    --latest  # Omit for RC
  ```
- [ ] Release notes match CHANGELOG
- [ ] Assets attached (if any)
- [ ] Release marked as latest (stable only)
- [ ] Release marked as pre-release (RC only)

## Post-Release Verification

### Installation Test
- [ ] Clean npm cache: `npm cache clean --force`
- [ ] Install released version: `npm install -g amber-protocol@X.Y.Z`
- [ ] Verify version: `amber --version`
- [ ] Test core command: `amber init` in test directory

### Documentation Updates
- [ ] README installation instructions tested
- [ ] Badges reflect new version
- [ ] Documentation site updated (if applicable)

### Communication
- [ ] Release announcement prepared (if v1.0.0)
- [ ] Known issues documented in release notes
- [ ] Migration guide available (if breaking changes)

## Rollback Procedures

If critical issues discovered post-release:

### npm Rollback
- [ ] Deprecate broken version:
  ```bash
  npm deprecate amber-protocol@X.Y.Z "Critical issue: <description>. Use vX.Y.Z-1 instead."
  ```
- [ ] DO NOT unpublish (breaks existing installations)
- [ ] Publish hotfix as new patch version

### GitHub Rollback
- [ ] Mark GitHub release as pre-release
- [ ] Add warning to release notes
- [ ] Create hotfix branch from previous stable tag
- [ ] Publish hotfix following full release process

### Communication
- [ ] Post issue on GitHub with details
- [ ] Update README with warning (if severe)
- [ ] Notify users via release notes

## Version-Specific Notes

### For v1.0.0-rc.1
- This is first public release candidate
- Extended testing period (1-2 days minimum)
- Focus on external project integration
- Document all friction points for user experience improvement

### For v1.0.0
- Final validation of RC fixes
- All RC issues resolved
- Comprehensive testing on multiple projects
- Complete documentation review
- Migration guide from any pre-v1.0.0 usage

### For patch releases (vX.Y.Z, Z > 0)
- Focus on specific bug fixes
- Verify fix doesn't introduce regressions
- Update CHANGELOG with [Fixed] section
- Minimal documentation changes

### For minor releases (vX.Y.0, Y > 0)
- New features tested independently
- Backward compatibility verified
- Update CHANGELOG with [Added] section
- Feature documentation complete

## Emergency Hotfix Process

For critical production issues requiring immediate release:

1. Create hotfix branch from affected tag
2. Implement minimal fix
3. Run critical tests only: `npm test && npm run doctor`
4. Update CHANGELOG with [Fixed] entry
5. Bump patch version
6. Follow abbreviated checklist:
   - [ ] Tests pass
   - [ ] Package validation
   - [ ] Single integration test
   - [ ] Tag, push, publish
7. Full validation post-release
8. Document lessons learned

## Checklist Metadata

- **Last Updated:** 2026-06-21
- **Template Version:** 1.0.0
- **Maintainer:** Bandersnatch0x
