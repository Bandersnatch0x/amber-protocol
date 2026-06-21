# Release Notes - Amber Protocol v1.0.0

**June 22, 2026** - Amber Protocol v1.0.0 is the first stable release of the repository-local governance layer for agent-assisted engineering.

## What Is Amber Protocol?

Amber Protocol helps teams prepare, review, validate, hand off, and audit AI-assisted engineering work inside a repository. It exposes one CLI entry point, `amber`, with read-only checks first and explicit guardrails around generated project state.

## Highlights

### Repository-Local Governance

Install a durable project scaffold with `amber init`, then validate it with `amber doctor`. The scaffold includes agent instructions, continuity files, a wiki skeleton, task templates, and verification guidance.

### Read-Only Adoption Workflow

Use `amber audit` and `amber adoption report` to inspect existing projects without modifying them. Reports identify missing starter files, tooling evidence, existing agent docs, and safe next actions.

### Route And Session Lifecycle

Reference routes cover feature work, bug fixes, and refactors. Session commands create traceable manifests, timelines, checkpoints, and handoff surfaces for agent-assisted work.

### Multi-Agent Skill Distribution

Amber skills are maintained under `skills/` and generated into platform-specific surfaces for Claude Code, Codex, Cursor, and Gemini CLI. `npm run gen:agents:check` guards against generated drift.

### Security And Release Hardening

The v1.0.0 release includes path traversal protections, secret redaction in client error reports, package manifest validation, coverage gates, link checks, and an updated Nodemailer dependency resolving GHSA-p6gq-j5cr-w38f.

## Getting Started

```bash
npm install -g amber-protocol
amber init --target my-project
amber doctor --target my-project
```

Inspect an existing repository without writing files:

```bash
amber audit --target my-project
amber adoption report --target my-project --output-dir docs/examples/adoptions
```

## Compatibility Notes

- Node.js 18.17.0 or newer is required.
- npm 9.0.0 or newer is required.
- The legacy `coding-harness` bin remains as a compatibility alias.
- Session manifest schema compatibility remains at `1.0.0-rc.1`; package version and data-contract version are intentionally decoupled until the manifest format changes.

## Verification Snapshot

Release validation for this build includes:

- `npm test`
- `npm run test:coverage`
- `npm run test:load`
- `npm run gen:agents:check`
- `npm run manifests`
- `node scripts/amber.js doctor --target .`
- `node scripts/check-broken-links.js`
- `npm audit --audit-level=high --registry=https://registry.npmjs.org`
- `node scripts/publish.js --dry-run`

## Known Operational Requirements

Before public publication, maintainers must still verify npm account access, configure the Git remote, push the v1.0.0 tag, and create the GitHub release from the committed release artifact.

---

[Documentation](../user-guide/getting-started.md) | [Changelog](../../CHANGELOG.md)
