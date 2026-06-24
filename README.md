# Amber Protocol


[简体中文](./README.zh-CN.md)

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/npm/v/amber-protocol)

**Status:** Stable | **Version:** 1.0.0 · [Milestones & test status →](./ROADMAP.md)

Amber Protocol is a repository-local governance layer for AI-assisted engineering. When a team lets an AI agent work inside a repo, the hard parts are no longer writing the code — they're knowing what was done, whether it's safe to keep, how to hand it off, and how to prove it was reviewed. Amber makes those parts explicit: it prepares agent-facing context, records approvals and gates, verifies state with read-only checks, and produces handoff and audit artifacts — all as files inside your repository.

It is deliberately conservative. Amber creates review artifacts, dry-run plans, and approval records. It does **not** run dynamic workflows, invoke live subagents, execute your project's commands, or rewrite your existing docs.

## Installation

### From npm (Recommended)

```bash
npm install -g amber-protocol
amber --version
```

### From source

```bash
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol
npm install
node scripts/amber.js --version
```

## Quick Start

Bring Amber into an existing repository in three safe steps:

```bash
# 1. Read-only audit of the target repo (changes nothing)
amber audit --target my-project --summary

# 2. Install Amber starter files (skips anything that already exists)
amber init --target my-project

# 3. Verify the repo now has the expected agent-facing surfaces
amber doctor --target my-project
```

`init` and `wiki` never overwrite existing files. See the [CLI reference](./docs/CLI_REFERENCE.md) for the full command surface.

## Core Concepts

Amber organizes governance into seven control layers, weighted toward safety — the higher the priority, the more of Amber's surface that layer gets:

| Layer | Role in Amber | Priority |
| --- | --- | --- |
| `Governance` | Approval records, safe defaults, policy boundaries, and adoption controls constrain behavior. | Highest |
| `Verification` | Doctor, audit, validation, review, and gate surfaces provide explicit checks. | High |
| `Observability` | Timelines, manifests, ledgers, and reports make behavior inspectable. | High |
| `Lifecycle` | Routes, sessions, checkpoints, and worktrees organize work locally. | Medium |
| `Context` | Starter docs, wiki scaffolds, manifests, and handoff artifacts keep project context explicit. | Medium |
| `Tooling` | CLI commands, schemas, validators, workflow packs, and profiles expose explicit interfaces. | Medium |
| `Execution` | Minimal — Amber avoids becoming a general execution runtime or live agent platform. | Low |

The through-line: strengthen `Governance`, `Verification`, and `Observability`; keep `Lifecycle` repository-local; avoid drifting into a full agent platform. The [governance model](./docs/architecture/governance-model.md) maps each layer to concrete commands.

**What gets installed** — the minimum surface `doctor` checks for:

- `AGENTS.md` and `CLAUDE.md` — agent-facing rules
- `feature_list.json` — tracked feature state
- `PROGRESS.md`, `session-handoff.md`, `clean-state-checklist.md`, `evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- a minimal `docs/wiki/` — project context, system map, runbook, verification, glossary

All starter files are safe defaults. `init` and `wiki` skip existing files and report what *would* be created in dry-run mode.

## What It Won't Do

These boundaries are part of the product, not TODOs:

- No dynamic workflow execution
- No live subagent runner invocation
- No automatic execution of target project commands
- No automatic rewrite of existing project docs
- No scheduled loop execution in the current product

For the full boundary notes, see [SPEC.md](./SPEC.md).

## Documentation

| Topic | Link |
| --- | --- |
| Full CLI reference | [docs/CLI_REFERENCE.md](./docs/CLI_REFERENCE.md) |
| Getting started guide | [docs/user-guide/getting-started.md](./docs/user-guide/getting-started.md) |
| Architecture & governance model | [docs/architecture/governance-model.md](./docs/architecture/governance-model.md) |
| Deployment & ops | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Monitoring / notifications / policy | [MONITORING_SETUP.md](./docs/MONITORING_SETUP.md) · [NOTIFICATION_SETUP.md](./docs/NOTIFICATION_SETUP.md) · [POLICY_CONFIGURATION.md](./docs/POLICY_CONFIGURATION.md) |
| Troubleshooting | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) |
| Full docs index | [docs/README.md](./docs/README.md) |
| Spec & roadmap | [SPEC.md](./SPEC.md) · [ROADMAP.md](./ROADMAP.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |

The web viewer (`apps/web`) provides a dashboard for sessions and timelines:

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev
# Visit http://localhost:3001
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, CI, and the release process.

## Support

- 📖 Documentation: [docs/](./docs/)
- 🐛 Report bugs: [GitHub Issues](https://github.com/Bandersnatch0x/amber-protocol/issues)
- 💡 Feature requests: [GitHub Discussions](https://github.com/Bandersnatch0x/amber-protocol/discussions)

## License

MIT License — see [LICENSE](./LICENSE) for details.

---

**Amber Protocol** — Repository-local AI coding governance for engineering teams.
