<div align="center">

# Amber Protocol

> **Make AI coding sessions reviewable, gated, and handoff-ready.**  
> Evidence lives as files in the repo — not in chat transcripts.

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![npm](https://img.shields.io/npm/v/amber-protocol?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D23-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)

<p align="center">
  <a href="#positioning">Positioning</a> ·
  <a href="#layering">Layering</a> ·
  <a href="#what-amber-will-not-do">Hard non-goals</a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start-about-10-minutes">Quick Start</a> ·
  <a href="./docs/TEAM_REPLICATION_CHARTER.md">Team Replication Charter</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <b>Repository-local</b> team replication layer — plans, gates, approvals,<br />
  and handoffs live as inspectable files inside your repo.<br />
  <b>Status:</b> Stable · <a href="./ROADMAP.md">Milestones & test status →</a>
</p>

</div>

---

## Positioning

**Amber = the in-repo team replication layer: how a team safely uses AI on *this* codebase, written as handoff-ready file evidence.**

It sits under your existing coding engine and adds governance plus evidence. It is not another agent runtime, and not an org-scale platform.

| Amber is | Amber is not |
| -------- | ------------ |
| In-repo governance and evidence protocol | Org-scale Skill marketplace / plugin store |
| Reviewable plans / gates / approvals / handoffs | Cross-repo gateway or cross-machine control dashboard |
| Local conventions a team can replicate | Always-on scheduler / daemon that runs your project commands |

---

## Layering

| Layer | Role |
| ----- | ---- |
| **Engine** | Edit code, call tools, run models and the agent loop (provided by your chosen coding host) |
| **Governance (Amber)** | Plans, gates, approvals, doctor/audit, handoff; evidence written as repo files |
| **Upper Shell (optional)** | Consumes Amber via MCP only; must not rewrite the `.amber` contract or push the agent loop into Amber core |

Engines do the work; Amber proves what was done, whether it is safe to keep, and how to hand it off.

## What Amber will NOT do

These are product boundaries, not TODOs:

1. Not a replacement for the coding engine / not a general agent runtime
2. No Dynamic Workflow execution, no live subagent dispatch, no automatic execution of your project commands
3. No org-scale marketplace, cross-repo gateway, cross-machine dashboard, or always-on scheduler
4. No overwrite of existing project docs (`init` / `wiki` only create missing files)

Full boundaries: [Team Replication Charter](./docs/TEAM_REPLICATION_CHARTER.md) and [SPEC.md](./SPEC.md).

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

## Quick Start (about 10 minutes)

Homepage path only: install → audit → init → doctor → optional plan/gate → handoff.

```bash
# 1. Read-only audit (changes nothing)
amber audit --target my-project --summary

# 2. Install starter files (skips anything that already exists)
amber init --target my-project

# 3. Verify agent-facing surfaces
amber doctor --target my-project

# 4. (Optional) create a plan and see the next gate
amber plan --target my-project --feature F001 --title "…"
amber next --target my-project

# 5. Produce and validate a portable handoff bundle
amber handoff bundle --target my-project
amber handoff validate --target my-project
```

`init` / `wiki` never overwrite existing files. Expert commands, dsh plugin notes, full lifecycle tables, and Web Viewer live in later sections and:

- `amber --all` — full compatibility command surface
- [CLI reference](./docs/CLI_REFERENCE.md)

Expert path (not the homepage main line): read-only continuous-improvement discovery via `amber loop recommend` (see `amber --all`):

```bash
amber loop recommend --target . --goal "continuous improvement" --json
amber loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --json
```

`loop run` requires `--dry-run`; live scheduling stays out of product scope.

---

## Core Concepts

Amber organizes governance into seven control layers, weighted toward safety — the higher the priority, the more of Amber's surface that layer gets:

| Layer           | Role in Amber                                                                                 | Priority |
| --------------- | --------------------------------------------------------------------------------------------- | -------- |
| `Governance`    | Approval records, safe defaults, policy boundaries, and adoption controls constrain behavior. | Highest  |
| `Verification`  | Doctor, audit, validation, review, and gate surfaces provide explicit checks.                 | High     |
| `Observability` | Timelines, manifests, ledgers, and reports make behavior inspectable.                         | High     |
| `Lifecycle`     | Routes, sessions, checkpoints, and worktrees organize work locally.                           | Medium   |
| `Context`       | Starter docs, wiki scaffolds, manifests, and handoff artifacts keep project context explicit. | Medium   |
| `Tooling`       | CLI commands, schemas, validators, workflow packs, and profiles expose explicit interfaces.   | Medium   |
| `Execution`     | Minimal — Amber avoids becoming a general execution runtime or live agent platform.           | Low      |

The through-line: strengthen `Governance`, `Verification`, and `Observability`; keep `Lifecycle` repository-local; avoid drifting into a full agent platform. The [governance model](./docs/architecture/governance-model.md) maps each layer to concrete commands.

**What gets installed** — the minimum surface `doctor` checks for:

- `AGENTS.md` and `CLAUDE.md` — agent-facing rules
- `feature_list.json` — tracked feature state
- `PROGRESS.md`, `session-handoff.md`, `clean-state-checklist.md`, `evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- a minimal `docs/wiki/` — project context, system map, runbook, verification, glossary

All starter files are safe defaults. `init` and `wiki` skip existing files and report what _would_ be created in dry-run mode.

## What It Won't Do

These boundaries are part of the product, not TODOs:

- No dynamic workflow execution or live subagent dispatch
- No automatic / unattended execution — see "Governed loop execution" below for the one gated exception
- No scheduled / cron / hook-triggered execution
- No external writes (PRs, issue trackers, notifications) or agent tool-call interception
- No automatic rewrite of existing project docs

### Governed loop execution (opt-in, gated)

Since [ADR-0003](./docs/adr/0003-governance-gated-execution.md), Amber can run a loop contract's
declared `governed.command` — but only behind four gates: a declarative policy check
(`.amber/governance/rules.json`, deny-wins / default-deny), an explicit `amber loop approve` (one
approval authorizes one run), an isolated git worktree (your main checkout is never the cwd), and a
tamper-evident hash-chain ledger. Default `loop run` is still dry-run; execution needs `--execute`.

```bash
amber loop approve --file <pack> --contract <id> --reviewer <name>
amber loop run --file <pack> --contract <id> --execute
amber loop verify-ledger --contract <id>
amber governance standards --target .   # honest OWASP-ASI coverage of what this does (and doesn't) cover
```

For the full boundary notes, see [SPEC.md](./SPEC.md).

## Documentation

| Topic                               | Link                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full CLI reference                  | [docs/CLI_REFERENCE.md](./docs/CLI_REFERENCE.md)                                                                                                                      |
| Getting started guide               | [docs/user-guide/getting-started.md](./docs/user-guide/getting-started.md)                                                                                            |
| Architecture & governance model     | [docs/architecture/governance-model.md](./docs/architecture/governance-model.md)                                                                                      |
| Deployment & ops                    | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)                                                                                                                            |
| Monitoring / notifications / policy | [MONITORING_SETUP.md](./docs/MONITORING_SETUP.md) · [NOTIFICATION_SETUP.md](./docs/NOTIFICATION_SETUP.md) · [POLICY_CONFIGURATION.md](./docs/POLICY_CONFIGURATION.md) |
| Troubleshooting                     | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)                                                                                                                  |
| Full docs index                     | [docs/README.md](./docs/README.md)                                                                                                                                    |
| Spec & roadmap                      | [SPEC.md](./SPEC.md) · [ROADMAP.md](./ROADMAP.md)                                                                                                                     |
| DeepSeek Harness (`dsh`) overlay    | [dsh/README.md](./dsh/README.md)                                                                                                                                      |
| Contributing                        | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                                                                                  |

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

<p align="center"><b>Amber Protocol</b> — Repository-local AI coding governance for engineering teams.</p>
