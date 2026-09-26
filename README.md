<div align="center">

# Amber Protocol

> **Governed Agent Harness for real engineering systems.**

> **Amber Protocol is the governed execution boundary between AI agents and real
> systems.** It governs what an agent may see, use, execute, and emit, with whose
> approval, and what evidence proves it — in files beside the code, not in chat history.
>
> **Amber Protocol 是 AI Agent 与真实系统之间的治理执行边界。**

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![npm](https://img.shields.io/npm/v/amber-protocol?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D23-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)

<p align="center">
  <a href="#what-is-amber">What is Amber</a> ·
  <a href="#who-it-is-for">Who it is for</a> ·
  <a href="#product-journey">Journey</a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start-about-10-minutes">Quick Start</a> ·
  <a href="./docs/TEAM_REPLICATION_CHARTER.md">Team Replication Charter</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  For repositories already using coding agents in real delivery work.<br />
  Plans, evidence, decisions, and handoffs stay inspectable beside the code.<br />
  <b>Status:</b> Stable · <a href="./ROADMAP.md">Milestones & test status →</a>
</p>

</div>

---

## What is Amber?

Amber Protocol is a repository-local governance layer for projects that already use coding agents in recurring, real delivery work. The hard part is no longer only producing code. It is preserving enough trustworthy state for the next person or agent to understand what happened, what was approved, what evidence exists, and what should happen next.

Amber makes that state explicit through plans, sessions, evidence, decisions, and handoffs stored beside the code. Its core outcome is **Trusted Continuation**: another person or agent can enter without the old chat, identify the current state, and take one correct next step.

**Amber = the in-repo team replication layer: how a team safely uses AI on _this_ codebase, written as handoff-ready file evidence.**

It sits under your existing coding engine and adds governance plus evidence. It is not another agent runtime, and not an org-scale platform.

| Amber is                                        | Amber is not                                                 |
| ----------------------------------------------- | ------------------------------------------------------------ |
| In-repo governance and evidence protocol        | Org-scale Skill marketplace / plugin store                   |
| Reviewable plans / gates / approvals / handoffs | Cross-repo gateway or cross-machine control dashboard        |
| Local conventions a team can replicate          | Always-on scheduler / daemon that runs your project commands |

---

## Layering

| Layer                      | Role                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Engine**                 | Edit code, call tools, run models and the agent loop (provided by your chosen coding host)                 |
| **Governance (Amber)**     | Plans, gates, approvals, doctor/audit, handoff; evidence written as repo files                             |
| **Upper Shell (optional)** | Consumes Amber via MCP only; must not rewrite the `.amber` contract or push the agent loop into Amber core |

Engines do the work; Amber proves what was done, whether it is safe to keep, and how to hand it off.

## What Amber will NOT do

These are product boundaries, not TODOs:

1. Not a replacement for the coding engine / not a general agent runtime
2. No Dynamic Workflow execution, no live subagent dispatch, no automatic execution of your project commands
3. No org-scale marketplace, cross-repo gateway, cross-machine dashboard, or always-on scheduler
4. No overwrite of existing project docs (`init` / `wiki` only create missing files)

Full boundaries: [Team Replication Charter](./docs/TEAM_REPLICATION_CHARTER.md) and [SPEC.md](./SPEC.md).

## Who it is for

The target environment is a **Coding-Agent-Enabled Repository**: maintainers already use one or more coding agents for ongoing delivery under human review. A one-off experiment or a repository that merely installed an agent tool does not qualify.

- **Primary user — Repository Maintainer:** accountable for the repository outcome and continuity.
- **Working user — agent-assisted developer:** frames and performs bounded delivery work.
- **Decision user — reviewer:** makes go/no-go decisions from plans, diffs, and evidence.

## Why Amber?

AI coding work becomes easier to trust when the workflow leaves inspectable evidence:

- **Continue without the old chat:** plans, sessions, evidence, and handoffs make state portable across people and agents.
- **Review from repository evidence:** decisions rest on inspectable artifacts, not a completion claim in a transcript.
- **Recover at the right stage:** failures and interruptions remain attached to the step that produced them.
- **Keep authority explicit:** human approvals and governed boundaries are records, not hidden runtime assumptions.

## Product journey

```text
Fit -> Adopt -> First trusted continuation -> Deliver -> Recover -> Review / Accept
```

| Journey                 | User outcome                                                       | Default surface                                              | Completion evidence                                               |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| J0 · Fit                | Decide whether Amber addresses a real continuity or review failure | `amber audit`                                                | Read-only findings and an explicit adopt/defer decision           |
| J1 · Adopt              | Add the minimum repository-local surface without overwrites        | `amber init`, `amber doctor`                                 | A repeatable setup check                                          |
| J2 · First continuation | Prove a fresh context can continue one real task correctly         | `amber next`, `amber plan`, `amber session`, `amber handoff` | A new person or agent acts correctly without reading the old chat |
| J3 · Deliver            | Frame, authorize, work, prove, review, and hand off/accept         | Agent journey; CLI fallback                                  | Plan, session, command evidence, and checkpoint agree             |
| J4 · Recover            | Resume after failure, pause, or context loss at the correct stage  | `amber session`, `amber next`, `amber handoff`               | Failure remains visible and the recovery action is bounded        |
| J5 · Review / Accept    | Make a go/no-go decision from repository evidence                  | Plans, gates, evidence, Web Viewer                           | Review and acceptance can be explained without the transcript     |

Feature, bugfix, and refactor routes remain backend policy. Users keep one frontstage model:

```text
Frame -> Authorize -> Work -> Prove -> Review -> Handoff / Accept
```

Context repair, continuous improvement, team expansion, and high-assurance operations are conditional paths. They do not block the first Trusted Continuation. See the [feature matrix](./docs/wiki/features/feature-map.md) and [complete journey definitions](./docs/wiki/product/user-scenarios.md).

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

Use one real task to test whether Amber creates Trusted Continuation. File generation alone is not activation.

```bash
# J0 — establish fit without changing the project
amber audit --target my-project

# J1 — install the minimum surface; existing files are skipped
amber init --target my-project
amber doctor --target my-project

# J2 — frame one real goal and follow the state-derived next step
amber next --objective "finish the current API change" --target my-project

# Generate a repository-local continuation bundle
amber handoff --target my-project
```

Now open a fresh agent session or ask another maintainer to inspect the repository **without the old chat**. Amber is activated only when that new context can explain the current state and take one correct next step.

`init` and `wiki` never overwrite existing files. Default help exposes seven fallback verbs: `audit`, `init`, `doctor`, `next`, `plan`, `handoff`, and `session`. `amber --all` keeps the expert and compatibility surface available. See the [CLI reference](./docs/CLI_REFERENCE.md).

Expert path (not the homepage main line): read-only continuous-improvement discovery via `amber loop recommend` (see `amber --all`):

```bash
amber loop recommend --target . --goal "continuous improvement" --json
amber loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --json
```

`loop run` requires `--dry-run`; live scheduling stays out of product scope.

---

## Core Concepts

Amber organizes governance into seven control layers, weighted toward safety — the higher the priority, the more of Amber's surface that layer gets:

| Layer           | Role in Amber                                                                                                                                                                                           | Priority |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `Governance`    | Approval records, safe defaults, policy boundaries, and adoption controls constrain behavior.                                                                                                           | Highest  |
| `Verification`  | Doctor, audit, validation, review, and gate surfaces provide explicit checks.                                                                                                                           | High     |
| `Observability` | Timelines, manifests, ledgers, and reports make behavior inspectable.                                                                                                                                   | High     |
| `Lifecycle`     | Routes, sessions, checkpoints, and worktrees organize work locally.                                                                                                                                     | Medium   |
| `Context`       | Starter docs, wiki scaffolds, manifests, and handoff artifacts keep project context explicit.                                                                                                           | Medium   |
| `Tooling`       | CLI commands, schemas, validators, workflow packs, and profiles expose explicit interfaces.                                                                                                             | Medium   |
| `Execution`     | Gated and capability-bound — governed command execution exists behind four gates plus frozen per-attempt admission; there is no un-gated runtime, and no capability is registered in a vanilla install. | Low      |

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
- No governed verb-stage execution in a vanilla install: the implementation-owned adapter table ships **empty** (there is no fallback), so `session run` stages fail closed until a capability is registered — and registering one is a reviewed code change, not a config edit

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

### Governed trust layer (trusted-control contracts)

Beyond the journey surface, Amber ships a contract-tested trust layer ([four canonical contracts](./docs/specs/) with product tests, all delivered):

- **Governed execution attempts** — every `session run` attempt freezes its admission inputs (scope, policy, capability, request digest) before any effect; the gates re-verify against the frozen values, and authorization grants bind that frozen tuple with single-use consumption. Drift is refused at the gate, before execution.
- **Evidence with assurance levels** — receipts carry `unavailable / observed / replayable / verified`, and a replay bundle (`amber handoff bundle --replay-scope`) rebuilds the authorization chain offline.
- **Governed memory** — durable lessons flow through `amber memory` (request → ingest → human approve → book); `MEMORY.md` stays human-curated and hash-registered.
- **Instruction-surface evals** — `amber eval run` replays deterministic model-independent checks of the agent-facing surfaces.
- **MCP Action Types** — 20 thin projections of the governed verbs; mutating actions return `approvalRequired` and are never executed by the MCP surface.

These surfaces are the protocol's reference implementation: governed verb stages currently **fail closed** (no capability is registered — see "What It Won't Do") and the canonical specs are awaiting their coordinator re-review.

## Documentation

| Topic                               | Link                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full CLI reference                  | [docs/CLI_REFERENCE.md](./docs/CLI_REFERENCE.md)                                                                                                                                           |
| Getting started guide               | [docs/guides/user-getting-started.md](./docs/guides/user-getting-started.md)                                                                                                               |
| Architecture & governance model     | [docs/architecture/governance-model.md](./docs/architecture/governance-model.md)                                                                                                           |
| Deployment & ops                    | [docs/DEPLOYMENT.md](./docs/guides/DEPLOYMENT.md)                                                                                                                                          |
| Monitoring / notifications / policy | [MONITORING_SETUP.md](./docs/guides/MONITORING_SETUP.md) · [NOTIFICATION_SETUP.md](./docs/guides/NOTIFICATION_SETUP.md) · [POLICY_CONFIGURATION.md](./docs/guides/POLICY_CONFIGURATION.md) |
| Troubleshooting                     | [docs/TROUBLESHOOTING.md](./docs/guides/TROUBLESHOOTING.md)                                                                                                                                |
| Full docs index                     | [docs/README.md](./docs/README.md)                                                                                                                                                         |
| Spec & roadmap                      | [SPEC.md](./SPEC.md) · [ROADMAP.md](./ROADMAP.md)                                                                                                                                          |
| DeepSeek Harness (`dsh`) overlay    | [dsh/README.md](./dsh/README.md)                                                                                                                                                           |
| Contributing                        | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                                                                                                       |

The public documentation site (`apps/docs`) provides reader-focused guides, concepts, and authoritative single-source CLI references with 100% offline local search:

```bash
npm run docs:build      # Build the static documentation site
npm run docs:verify     # Run the mechanical verification seam
npm run docs:gen        # Generate CLI reference pages from command registry
npm run docs:gen:check  # Verify zero drift between code and CLI reference docs
npm run docs:test       # Run public documentation test suite
```

The optional Web Viewer (`apps/web`) is a journey-aware inspector. It shows the current J0–J5 stage, the next governed action, active sessions, pending gates, and repository-local evidence. It reflects Amber state; it does not create a second workflow or replace the Agent/CLI authority surface.

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

<p align="center"><b>Amber Protocol</b> — the governed execution boundary between AI agents and real systems.</p>
