# Release Notes — Phase B v1.0.0

**June 10, 2026** — The Coding Harness team is excited to announce the General Availability release of Phase B!

## What is Phase B?

Phase B is a complete reimagining of Coding Harness, introducing a modular framework for building, extending, and securing your AI-powered development workflows.

## Top 5 Features

### 1. 🔒 Built-in Security Audit
Run `coding-harness security audit` to scan your project for:
- **Dependency vulnerabilities** (via npm audit integration)
- **Hardcoded secrets** (API keys, tokens, passwords)
- **Permission issues** (overly broad access, unused permissions)

### 2. 🔄 One-Click Migration
Migrate from V5.5 with a single command. Dry-run mode shows you exactly what changes before you commit. Rollback if needed.

### 3. 🎯 Skill System
Create reusable AI capabilities with simple Markdown files. Share skills across your team. Programmatic API available for complex logic.

### 4. ⚡ Agent Profiles
Configure specialized AI agents with specific models, skills, and permissions. Worker/reviewer patterns for multi-agent workflows.

### 5. 🪝 Lifecycle Hooks
Intercept tool calls, git events, and session lifecycles. Validate inputs, audit outputs, and enforce policies automatically.

## Performance Improvements

- 40% faster startup with lazy skill loading
- Token budgeting prevents runaway consumption
- Parallel hook execution for large projects

## Breaking Changes

We've streamlined the configuration format. Key changes from V5.5:
- `version` changes from `"5.5"` to `"1.0.0"`
- New required `framework` field: `"phase-b"`
- Deprecated V5.5-only fields are removed
- Skills and profiles are now first-class concepts

Full details in the [Migration Guide](./MIGRATION_GUIDE.md).

## Getting Started

```bash
npm install -g coding-harness
coding-harness init my-project
cd my-project
coding-harness doctor
```

## Upgrade from V5.5

```bash
coding-harness migrate --dry-run  # Preview
coding-harness migrate            # Apply
coding-harness validate           # Verify
```

## What's Next

Phase C development is already underway, focusing on:
- Web-based project viewer
- Team collaboration features
- Cloud integration

## Thank You

To all our alpha testers, RC participants, and community contributors — this release wouldn't be possible without you. Special thanks to everyone who reported bugs, suggested improvements, and helped test the migration tool.

---

[GitHub](https://github.com/coding-harness) · [Documentation](../user-guide/getting-started.md) · [Changelog](./CHANGELOG.md)
