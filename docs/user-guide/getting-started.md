# Getting Started with Amber Protocol

Amber Protocol is a repo-local AI coding governance console for engineering teams. It helps teams prepare, review, verify, hand off, and audit AI-assisted coding work inside a repository. It does not run live agents, execute project commands automatically, or replace human review.

## Prerequisites

- **Node.js** >= 18.17
- **npm** >= 9.x

## Service packages

Amber Protocol is organized into five service packages. Each package is a documentation and navigation grouping over existing CLI commands — service packages are not command namespaces of their own.

| Service package | Start here | Outcome |
| --- | --- | --- |
| Repository Onboarding | `node scripts/amber.js doctor --target .` | Confirm the repo has agent-facing rules, wiki, feature state, handoff, and verification surfaces. |
| Governance Report | `node scripts/amber.js governance report --target .` | Score readiness, risks, and structured next actions before changing an existing repo. |
| Governed Delivery | `node scripts/amber.js plan --target . --feature F001 --title "Small slice"` | Move one task through plan, gate, review, accept, and completion evidence. |
| Continuity Layer | `node scripts/amber.js handoff bundle --target .` | Produce a portable handoff bundle with evidence, risks, next actions, recovery commands, and a manifest. |
| Security Governance | `node scripts/amber.js security audit --target . --output docs/examples/security-audit.md` | Review dependency, secret, permission, and secure-review evidence. |

## First-Time Setup

### 1. Initialize a new project

```bash
mkdir my-agent-project
cd my-agent-project
node scripts/amber.js init --target .
```

This scaffolds safe defaults:

- `AGENTS.md` and `CLAUDE.md`
- `feature_list.json`
- `PROGRESS.md`
- `session-handoff.md`
- `docs/wiki/` skeleton
- `.workflow/continuous-improvement/state.json`

Re-running `init` skips existing files, so it is safe to call more than once.

### 2. Verify your setup

```bash
node scripts/amber.js doctor --target .
```

### 3. Produce the delivery-loop report

```bash
node scripts/amber.js governance report --target .
node scripts/amber.js next --target .
```

The report scores the loop `Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle` and prints the highest-value next actions.

### 4. Produce a handoff bundle

```bash
node scripts/amber.js handoff bundle --target .
node scripts/amber.js handoff validate --target .
```

The bundle is the continuation artifact another human or agent can use without reading the chat transcript.

### 5. Explore a service package

Pick the package closest to your current goal and run the real commands documented for it. For example, Security Governance:

```bash
node scripts/amber.js security audit --target . --output docs/examples/security-audit.md
node scripts/amber.js pack validate --file workflow-packs/security-audit.pack.json
```

## Non-goals

- Amber Protocol does not execute dynamic workflows.
- It does not invoke live subagent runners.
- It does not run target-project commands automatically.
- It does not create automatic pull requests or rewrite existing project docs without review.

## Next steps

- [CLI Commands](../api/cli-commands.md) — Complete command reference
- [Architecture](../architecture/overview.md) — How the pieces fit together
- [SPEC.md](../../SPEC.md) — Product boundary and release criteria
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
- [FAQ](./faq.md) — Frequently asked questions
