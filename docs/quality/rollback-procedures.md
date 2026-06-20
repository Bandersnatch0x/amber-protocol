# Rollback Procedures

## Overview

This document provides step-by-step procedures for rolling back Amber Protocol releases in various failure scenarios. All procedures assume you have maintainer access to the npm package and GitHub repository.

## Scenario 1: Broken npm Package (Post-Publish)

**Indicators:**
- Users report installation failures
- Package missing critical files
- CLI commands fail immediately after install

**Rollback Steps:**

```bash
# 1. Deprecate the broken version on npm
npm deprecate amber-protocol@X.Y.Z "Broken release, use vX.Y.W instead"

# 2. Verify previous working version
npm info amber-protocol versions

# 3. Update npm dist-tags to point to last known good version
npm dist-tag add amber-protocol@X.Y.W latest

# 4. Notify users via GitHub Release
gh release create vX.Y.Z \
  --title "⚠️ vX.Y.Z Deprecated - Use vX.Y.W" \
  --notes "This release has been deprecated due to [reason]. Please use vX.Y.W instead: \`npm install -g amber-protocol@X.Y.W\`" \
  --prerelease

# 5. Create hotfix branch to fix issue
git checkout -b hotfix/vX.Y.Z+1
# ... fix issue ...
git commit -m "fix: [description]"

# 6. Test thoroughly before re-releasing
npm run test
npm run doctor
npm pack --dry-run

# 7. Release fixed version
npm version X.Y.Z+1 --no-git-tag-version
git commit -am "chore: release vX.Y.Z+1"
git tag -s vX.Y.Z+1 -m "Hotfix for vX.Y.Z"
git push origin master vX.Y.Z+1
# Automated release job will publish
```

**Time to Recovery:** 15-30 minutes (assuming fix is ready)

## Scenario 2: Breaking Changes Discovered After Release

**Indicators:**
- User projects broken after upgrade
- CLI interface changes cause scripts to fail
- Route schema incompatibility

**Rollback Steps:**

```bash
# 1. Assess impact (check GitHub issues, npm download stats)
npm info amber-protocol@X.Y.Z

# 2. If impact is high, deprecate immediately
npm deprecate amber-protocol@X.Y.Z "Breaking changes, reverting to vX.Y.W"

# 3. Roll back latest tag to previous version
npm dist-tag add amber-protocol@X.Y.W latest

# 4. Create incident report
cat > docs/incidents/YYYY-MM-DD-vX.Y.Z-rollback.md <<EOF
# Incident Report: vX.Y.Z Rollback

**Date:** $(date -I)
**Version:** vX.Y.Z
**Reason:** [Breaking changes description]
**Impact:** [Number of users affected, duration]

## Timeline

- 00:00 - vX.Y.Z published
- 00:XX - First user report
- 00:YY - Rollback initiated
- 00:ZZ - Rollback complete

## Root Cause

[Description]

## Action Items

- [ ] Fix breaking change
- [ ] Add regression test
- [ ] Update CHANGELOG with breaking change note
- [ ] Create migration guide
EOF

# 5. Communicate to users
gh issue create \
  --title "Breaking change in vX.Y.Z - rolled back" \
  --body "vX.Y.Z has been rolled back due to breaking changes. The \`latest\` tag now points to vX.Y.W. Users who installed vX.Y.Z should downgrade: \`npm install -g amber-protocol@X.Y.W\`"

# 6. Fix and re-release as MAJOR version (if breaking change intended)
# OR release as PATCH with fix (if unintended)
```

**Time to Recovery:** 1-2 hours (including communication and testing)

## Scenario 3: Automated Release Job Fails Mid-Flight

**Indicators:**
- GitHub Actions release job fails
- npm publish succeeds but GitHub Release fails (or vice versa)
- Inconsistent state between npm and GitHub

**Rollback Steps:**

### Case 3a: npm publish failed, GitHub Release succeeded

```bash
# 1. Delete the GitHub Release
gh release delete vX.Y.Z --yes

# 2. Delete the git tag
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# 3. Fix the issue (usually package.json or NPM_TOKEN)

# 4. Retry release
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
# CI will retry automatically
```

### Case 3b: npm publish succeeded, GitHub Release failed

```bash
# 1. Verify npm package is correct
npm info amber-protocol@X.Y.Z

# 2. Manually create GitHub Release
gh release create vX.Y.Z \
  --title "Release vX.Y.Z" \
  --notes-file CHANGELOG.md \
  --latest

# 3. No rollback needed if package is correct
```

### Case 3c: Package validation failed

```bash
# 1. Delete the tag (package not published yet)
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# 2. Fix package.json files array or .npmignore

# 3. Test locally
npm pack --dry-run
tar -tzf *.tgz | less

# 4. Retry release
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

**Time to Recovery:** 5-15 minutes (automated pipeline handles most of it)

## Scenario 4: Security Vulnerability Discovered

**Indicators:**
- npm audit reports high/critical vulnerability
- Security researcher reports issue
- Automated security scan flags package

**Rollback Steps:**

```bash
# 1. IMMEDIATELY deprecate affected versions
npm deprecate amber-protocol@">=X.Y.A <=X.Y.Z" "Security vulnerability, upgrade to vX.Y.Z+1"

# 2. Create security advisory
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/Bandersnatch0x/amber-protocol/security-advisories \
  -f summary="[Vulnerability Title]" \
  -f description="[Details]" \
  -f severity="high"

# 3. Fix vulnerability in private branch
git checkout -b security/CVE-YYYY-XXXXX
# ... implement fix ...
git commit -m "fix(security): [description]"

# 4. Test fix thoroughly
npm run test
npm audit --audit-level=high

# 5. Release security patch ASAP
npm version patch --no-git-tag-version
git commit -am "chore: release security patch vX.Y.Z+1"
git tag -s vX.Y.Z+1 -m "Security patch"
git push origin master vX.Y.Z+1

# 6. Publish security advisory after fix is live
gh api \
  --method PATCH \
  -H "Accept: application/vnd.github+json" \
  /repos/Bandersnatch0x/amber-protocol/security-advisories/{advisory_id} \
  -f state="published"

# 7. Notify users via multiple channels
# - GitHub Release (mark as important)
# - npm package deprecation warning
# - GitHub issue pinned to top
```

**Time to Recovery:** 2-8 hours (depending on fix complexity)

## Scenario 5: Complete Rollback (Nuclear Option)

**Use Only When:**
- Multiple critical issues discovered
- Data corruption risk
- Legal/compliance issue

**Steps:**

```bash
# 1. Unpublish the version (within 72 hours of publish)
npm unpublish amber-protocol@X.Y.Z

# WARNING: unpublish is permanent and can only be done within 72h
# After 72h, you can only deprecate

# 2. Delete GitHub Release
gh release delete vX.Y.Z --yes

# 3. Delete git tag
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# 4. Roll back dist-tag
npm dist-tag add amber-protocol@X.Y.W latest

# 5. Create incident report (see Scenario 2)

# 6. Communicate widely
# - GitHub issue
# - README banner (temporarily)
# - npm deprecation message (if past 72h window)
```

**Time to Recovery:** 30 minutes for rollback, days for full fix

## Prevention Measures

To reduce the need for rollbacks:

1. **Always test RC/beta first**
   ```bash
   npm version X.Y.Z-rc.1
   npm publish --tag rc
   # Test in multiple environments
   # Wait 24-48 hours for feedback
   ```

2. **Use package validation locally**
   ```bash
   npm pack --dry-run
   tar -tzf *.tgz > manifest.txt
   # Manually review manifest.txt
   ```

3. **Run full CI locally before tagging**
   ```bash
   npm test
   npm run test:coverage
   npm run test:load
   npm audit --audit-level=high
   npm run manifests
   npm run doctor
   cd apps/web && npm test && npm run test:e2e
   ```

4. **Monitor npm stats after release**
   ```bash
   npm info amber-protocol@X.Y.Z
   # Check download count after 1 hour, 6 hours, 24 hours
   ```

5. **Keep GitHub Issues open for 48 hours after release**
   - Monitor for user reports
   - Check CI status on tag
   - Watch npm download trends

## Post-Rollback Checklist

After any rollback:

- [ ] Incident report created in `docs/incidents/`
- [ ] Root cause documented
- [ ] Regression test added
- [ ] CHANGELOG updated with rollback notice
- [ ] Users notified via GitHub Release/Issue
- [ ] npm package deprecation message set
- [ ] CI/CD improvements identified
- [ ] Post-mortem scheduled (if high impact)

## Emergency Contacts

- **npm Support:** support@npmjs.com (for account issues)
- **GitHub Support:** Via https://support.github.com (for Actions issues)
- **Security Reporting:** security@[yourdomain] or GitHub Security Advisory

## Related Documentation

- [Release Process](../../CONTRIBUTING.md#release-process)
- [CI/CD Configuration](../../.github/workflows/ci.yml)
- [Package Validation](./release-checklist.md)
