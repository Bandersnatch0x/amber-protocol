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

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
