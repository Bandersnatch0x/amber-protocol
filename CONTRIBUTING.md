# Contributing to Amber Protocol

Thank you for your interest in contributing to Amber Protocol!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/amber-protocol.git`
3. Install dependencies: `npm install`
4. Run tests: `npm test`
5. Make your changes
6. Submit a pull request

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:load

# Run web viewer tests
cd apps/web
npm test
npm run test:e2e

# Run validation
npm run manifests
npm run doctor
```

### Code Style

- Use CommonJS modules (`require`/`module.exports`) for CLI scripts
- Use ES modules for web viewer code
- Follow existing naming conventions (kebab-case for files, camelCase for functions)
- Keep functions under 50 lines where possible
- Write tests for new features
- Document command-line interfaces

### Git Commit Identity

This repository requires a single author/committer identity on new commits:

- name: `Bandersnatch0x`
- email: `xihalele@gmail.com` (or the GitHub noreply form `13325067+bandersnatch0x@users.noreply.github.com`)

Local setup:

```bash
git config --local user.name "Bandersnatch0x"
git config --local user.email "xihalele@gmail.com"
npm run dev:hooks:install   # points core.hooksPath at .githooks (pre-commit identity check)
npm run identity:check      # validate the effective author/committer now
```

CI runs the same checker on introduced commits (`identity` job). Release jobs and the test matrix wait on it.

**Platform exceptions (CI only):** when validating already-made commits (`--range` / `--commit`), the checker accepts exact name+email pairs for Dependabot, GitHub’s bot committer, and `github-actions[bot]`. It also accepts GitHub's account display name as the author when the commit uses this repository's exact noreply email and was committed by the exact GitHub bot identity — covering GitHub-generated merge AND squash-merge commits (squash-merges carry a single parent; the trust anchor is the owner's noreply address plus GitHub's own committer identity, which only holds when the owner produced the commit through GitHub). Local pre-commit (`npm run identity:check` with no args) stays human-only so platform or bot identities cannot land from a workstation.

CLI:

```bash
npm run identity:check
node scripts/validate-git-identity.js --range <base>..<head>
node scripts/validate-git-identity.js --commit <sha>   # exactly one revision (git log -1)
```

### Commit Messages

Use conventional commit format:

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Example:

```
feat: add session pause command

Allow users to pause a running session for later continuation.
Updates session state machine and adds pause event to timeline.
```

## Architecture Documentation

Before making significant changes, review the architecture documentation:

- [Route Engine](./docs/architecture/route-engine.md)
- [Session Lifecycle](./docs/architecture/session-lifecycle.md)
- [Web Viewer](./docs/architecture/web-viewer.md)
- [Governance Model](./docs/architecture/governance-model.md)

These documents provide design context and help maintain architectural consistency.

## Tracing Git History

The repository underwent a major rename from "Coding Harness" to "Amber Protocol" in June 2026. Historical context and design decisions are preserved in Git history.

### Finding Historical Documentation

Historical planning documents and phase notes are preserved under `docs/superpowers/plans/`:

- Route engine design: `docs/superpowers/plans/2026-06-10-phase-b-alpha-week-2-route-engine.md`
- Session lifecycle: `docs/superpowers/plans/2026-06-10-phase-b-beta-autonomous-mode.md`
- Web viewer: `docs/superpowers/plans/2026-06-10-phase-c-web-viewer.md`
- Governance: `docs/superpowers/plans/2026-06-11-phase-2-governance-surfaces.md`
- Rename plan: `docs/superpowers/plans/2026-06-11-amber-protocol-rename-and-governance.md`

### Tracing File History

Use `git log --follow` to trace files through renames:

```bash
# Trace main CLI through rename
git log --follow scripts/amber.js

# Trace core facade through rename
git log --follow scripts/lib/amber-core.js

# Trace wiki template through rename
git log --follow templates/docs/wiki/agent/amber.md
```

### Finding Design Decisions

Architecture decisions and rationale are recorded in:

1. **Git commit messages** - Use `git log --grep="<keyword>"` to find relevant commits
2. **Planning documents** - See `docs/superpowers/plans/` for implementation plans
3. **Architecture docs** - See `docs/architecture/` for extracted design documentation
4. **CLAUDE.md** - Project overview and current architecture

Example searches:

```bash
# Find commits related to session lifecycle
git log --grep="session" --oneline

# Find route engine implementation
git log --grep="route" --since="2026-06-01" --until="2026-06-15"

# Find governance implementation
git log --grep="governance" --oneline
```

## Testing Requirements

All changes must:

1. Pass existing tests: `npm test`
2. Include new tests for new features
3. Pass manifest validation: `npm run manifests`
4. Pass doctor check: `npm run doctor`
5. Not break web viewer: `cd apps/web && npm test`

## Documentation Requirements

When adding new commands or features:

1. Update `README.md` with command examples
2. Add help text to CLI (see existing `usage()` functions)
3. Update `CLAUDE.md` if changing core architecture
4. Add architecture documentation for significant new components

## Pull Request Process

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes with clear commit messages
3. Run all tests and validation
4. Push to your fork
5. Create a pull request with:
   - Clear description of changes
   - Rationale for the change
   - Test coverage summary
   - Any breaking changes noted

## Design Principles

When contributing, keep these principles in mind:

1. **Governance-first**: Strengthen verification, observability, and control surfaces
2. **Read-only by default**: Commands should read state unless explicitly modifying
3. **Idempotent operations**: Commands should be safe to run multiple times
4. **No hidden state**: All state should be in `.amber/` directory
5. **Repository-local**: Avoid dependencies on external services
6. **Conservative execution**: Don't run Dynamic Workflows or auto-rewrite project files

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before opening new ones
- Tag issues appropriately (bug, enhancement, question, documentation)
- Be respectful and constructive in discussions

## Release Process

### Quality Documentation

Before releasing, review the quality assurance documentation:

- [Core Use Cases](./docs/quality/core-use-cases.md) - Essential functionality validation
- [Coverage Baseline](./docs/quality/coverage-baseline.md) - Test coverage requirements
- [Release Checklist](./docs/quality/release-checklist.md) - Pre-release verification steps
- [Rollback Procedures](./docs/quality/rollback-procedures.md) - Emergency rollback guide

### Automated Release (Default)

Amber Protocol uses automated releases via GitHub Actions. When a stable version tag (`vX.Y.Z`) is pushed, CI runs the full test matrix and publishes **both** `amber-protocol` and `dsh-amber-protocol` to npmjs.org from `.github/workflows/ci.yml`. The GitHub Packages workflow remains a scoped mirror of the main package only.

**Core invariants (never bypass):**

- `npm run version:sync` MUST be executed during prep (it keeps plugin manifests, `dsh/package.json`, and the root lockfile in lockstep with `package.json`).
- `npm run release:verify` MUST be run after the tag is pushed and the publish workflow has completed (terminal guard against the v1.3.1 ghost-version class from #46).
- Prefer the smallest increment (patch) unless the changes warrant minor/major.

**Zero-dependency changelog automation:**
CHANGELOG.md is now generated from conventional commits by `node scripts/changelog.js` (pure Node + git, modeled on `sync-version.js` / `verify-release.js`). No external release-please or additional dependencies. This fulfills #47: the next release cut requires no hand-written CHANGELOG.

**Release cut workflow:**

1. Ensure working tree clean and on `master`. All changes landed as conventional commits (`feat:`, `fix:`, `chore:`, etc.).
2. Choose minimal bump and update `package.json`:
   ```bash
   npm version --no-git-tag-version patch   # or minor / major
   ```
3. Sync plugin manifests, DSH bundle version, and lockfile (mandatory):
   ```bash
   npm run version:sync
   ```
4. Generate the release section in CHANGELOG.md from commits since the prior tag:
   ```bash
   npm run changelog
   ```
   Review the inserted `## [X.Y.Z] - YYYY-MM-DD` section. Light narrative polish is acceptable; the commit list is authoritative.
5. Stage and commit (version files + changelog):
   ```bash
   git add package.json package-lock.json dsh/package.json .claude-plugin/plugin.json .codex-plugin/plugin.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   ```
6. Create annotated tag:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   ```
7. Push:
   ```bash
   git push origin master
   git push origin vX.Y.Z
   ```
8. CI runs tests, then publishes `amber-protocol` and `dsh-amber-protocol` to npmjs (idempotent; re-runs are safe).
9. After the publish workflow succeeds, run the terminal verifier:
   ```bash
   npm run release:verify
   ```
   This asserts every stable tag is on the remote and both lockstep packages exist on npmjs.

**Version Tag Format:**

- Stable releases: `v1.0.0`, `v1.1.0`, `v2.0.0` (triggers npmjs lockstep publish)
- Release candidates: `v1.0.0-rc.1`, `v1.0.0-rc.2` (skips npmjs publish)
- Beta releases: `v1.0.0-beta`, `v1.0.0-beta.1` (skips npmjs publish)

**Publish workflow notes:**

- Authoritative npmjs flow: the `release` job in `.github/workflows/ci.yml`. It validates the lockstep version contract, publishes `amber-protocol`, then `dsh-amber-protocol`, then creates the GitHub Release. Both publish steps skip if that exact version already exists.
- Mirror: `.github/workflows/publish-github-packages.yml` (on tag push `v*`, scopes temporarily for `@bandersnatch0x/amber-protocol`, publishes idempotently to `https://npm.pkg.github.com`). It does not publish the DSH bundle.

### Manual Release (Emergency Fallback)

If automated release fails or is unavailable, use manual publish. Follow the invariants above (version:sync + changelog generator + release:verify).

```bash
# 1. Ensure all checks pass
npm test
npm run manifests
npm run doctor

# 2. Validate package contents
npm pack --dry-run

# 3. (If needed) Publish to GitHub Packages manually (rare)
# npm pkg set name="@bandersnatch0x/amber-protocol"
# echo "@bandersnatch0x:registry=https://npm.pkg.github.com" >> .npmrc
# echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> .npmrc
# npm publish --registry=https://npm.pkg.github.com
# npm pkg set name="amber-protocol"

# 4. Create GitHub Release manually (body should reference the generated CHANGELOG)
gh release create vX.Y.Z \
  --title "Release vX.Y.Z" \
  --notes "See [CHANGELOG.md](https://github.com/Bandersnatch0x/amber-protocol/blob/master/CHANGELOG.md)" \
  --latest
```

### Version Numbering Rules

Amber Protocol follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): Breaking changes to CLI interface or route schema
- **MINOR** (v1.1.0): New features, new commands, backward-compatible changes
- **PATCH** (v1.0.1): Bug fixes, documentation updates, no new features

### Pre-release Tags

For testing releases before stable publish (these do not trigger the GitHub Packages publish):

```bash
# Prepare RC (use generator for changelog even for RCs)
npm version 1.1.0-rc.1 --no-git-tag-version
npm run version:sync
npm run changelog
git add package.json .claude-plugin/plugin.json .codex-plugin/plugin.json CHANGELOG.md
git commit -m "chore(release): v1.1.0-rc.1"
git tag -a v1.1.0-rc.1 -m "Release Candidate 1"
git push origin master v1.1.0-rc.1

# Beta example follows identical pattern (no publish triggered)
```

Install pre-releases with: `npm install -g amber-protocol@rc` or `npm install -g amber-protocol@beta` (from GitHub Packages).

### GitHub Secrets / Permissions

The authoritative npmjs release job in `.github/workflows/ci.yml` uses `secrets.NPM_TOKEN` to publish `amber-protocol` and `dsh-amber-protocol`.

The GitHub Packages publish workflow (`.github/workflows/publish-github-packages.yml`) uses the built-in `GITHUB_TOKEN` (with `packages: write` permission). It is a scoped mirror of the main package only, does not publish the DSH bundle, and skips `-rc`/`-beta` tags while still allowing `workflow_dispatch`.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
