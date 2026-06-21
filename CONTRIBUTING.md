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

Amber Protocol uses automated releases via GitHub Actions. When a version tag is pushed, the CI pipeline automatically publishes to npm and creates a GitHub Release.

**Workflow:**

1. Update version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Commit changes: `git commit -m "chore: release vX.Y.Z"`
4. Create and push tag: `git tag -s vX.Y.Z -m "Release vX.Y.Z" && git push origin master vX.Y.Z`
5. CI automatically publishes to npm and creates GitHub Release

**Version Tag Format:**

- Stable releases: `v1.0.0`, `v1.1.0`, `v2.0.0` (triggers automatic publish)
- Release candidates: `v1.0.0-rc.1`, `v1.0.0-rc.2` (skips automatic publish)
- Beta releases: `v1.0.0-beta`, `v1.0.0-beta.1` (skips automatic publish)

**Release Job Requirements:**

The `release` job in CI runs only when:
- All test, coverage, security, performance, and web jobs pass
- A version tag matching `v*.*.*` is pushed
- The tag does NOT contain `-rc` or `-beta`

**Package Validation:**

Before publishing, the release job validates:
- ✅ Critical files included: `scripts/`, `templates/`, `routes/`, `schemas/`, `README.md`, `LICENSE`
- ❌ Test files excluded: `tests/`, `.github/`
- ❌ Internal docs excluded: `docs/superpowers/`

### Manual Release (Emergency Fallback)

If automated release fails or is unavailable, use manual publish:

```bash
# 1. Ensure all checks pass
npm test
npm run manifests
npm run doctor

# 2. Validate package contents
npm pack --dry-run
tar -tzf *.tgz | grep -E '^package/(scripts|templates|routes|schemas)/'

# 3. Publish to npm
npm publish

# 4. Create GitHub Release manually
gh release create vX.Y.Z \
  --title "Release vX.Y.Z" \
  --notes "See CHANGELOG.md" \
  --latest
```

### Version Numbering Rules

Amber Protocol follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): Breaking changes to CLI interface or route schema
- **MINOR** (v1.1.0): New features, new commands, backward-compatible changes
- **PATCH** (v1.0.1): Bug fixes, documentation updates, no new features

### Pre-release Tags

For testing releases before stable publish:

```bash
# Publish release candidate
npm version 1.1.0-rc.1 --no-git-tag-version
git commit -am "chore: release v1.1.0-rc.1"
git tag -s v1.1.0-rc.1 -m "Release Candidate 1"
git push origin master v1.1.0-rc.1
npm publish --tag rc

# Publish beta
npm version 1.1.0-beta --no-git-tag-version
git commit -am "chore: release v1.1.0-beta"
git tag -s v1.1.0-beta -m "Beta Release"
git push origin master v1.1.0-beta
npm publish --tag beta
```

Install pre-releases with: `npm install -g amber-protocol@rc` or `npm install -g amber-protocol@beta`

### GitHub Secrets Configuration

The automated release requires `NPM_TOKEN` secret configured in GitHub repository settings:

1. Generate npm token: `npm token create --type automation`
2. Add to GitHub: Settings → Secrets → Actions → New repository secret
3. Name: `NPM_TOKEN`
4. Value: `<your-npm-token>`

**Note:** `GITHUB_TOKEN` is automatically provided by GitHub Actions for creating releases.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
