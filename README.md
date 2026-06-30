# Amber Protocol


[简体中文](./README.zh-CN.md)

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/npm/v/amber-protocol)

**Status:** Stable | **Version:** 1.1.0 · [Milestones & test status →](./ROADMAP.md)

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

### From GitHub Packages

Amber Protocol is also published as a scoped package on GitHub Packages
(`@bandersnatch0x/amber-protocol`). Consuming it requires a one-time `.npmrc`
setup:

```bash
# 1. Create a GitHub PAT with read:packages scope at https://github.com/settings/tokens

# 2. Copy the template and replace the token
cp .github/npmrc-github-packages .npmrc
# Edit .npmrc: replace ${GITHUB_TOKEN} with your PAT

# 3. Install
npm install -g @bandersnatch0x/amber-protocol
amber --version
```

Other `@bandersnatch0x/*` packages (if any are added as dependencies) will also
resolve from GitHub Packages automatically.

For CI (GitHub Actions), `secrets.GITHUB_TOKEN` is available automatically — the
publish workflow (`.github/workflows/publish-github-packages.yml`) builds the
`.npmrc` on the fly.

## Quick Start

Bring Amber into an existing repository in three safe steps:

```bash
# 1. Read-only audit of the target repo (changes nothing)
amber audit --target my-project --summary

# 2. Install Amber starter files (skips anything that already exists)
amber init --target my-project

# 3. Verify the repo now has the expected agent-facing surfaces
amber doctor --target my-project

# 4. Ask Amber what to do next — it reads live state and prints one command
amber next --target my-project
```

`init` and `wiki` never overwrite existing files. See the [CLI reference](./docs/CLI_REFERENCE.md) for the full command surface.

### `amber next` — guided next step

`amber next` is read-only: it infers where the repo sits in the Amber delivery lifecycle
(`init → feature → plan → gate → verify/approve → complete-check → accept`) and prints the single
most relevant next command — it never runs anything itself.

```bash
amber next --target .                 # auto-selects a focus and states which it chose
amber next --target . --feature F001  # focus one feature's lifecycle
amber next --target . --session <id>  # focus a session's verify → approve → complete-check
amber next --target . --json          # machine-readable envelope (focus, nextStep, remedy)
```

When a focus is omitted, `next` picks the active session, else the most-recently-touched plan's
feature, else the first unstarted feature — and always says which it chose plus how many other
items are pending. The same actionable `remedy` hints surface inline in `doctor` checks and
`review` findings, so a failed check tells you the exact command to fix it.

### `amber loop recommend` — safe continuous improvement

`amber loop recommend` is read-only: it scans local workflow-pack loop contracts, scores them
against a maintenance goal, and prints the safest dry-run command to review next. It does not
schedule jobs, execute workflow steps, dispatch agents, or write external systems.

```bash
amber loop recommend --target . --goal "continuous improvement" --json
amber loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --json
```

Live scheduling remains outside the current product boundary; `loop run` requires `--dry-run`.

**Loop Engineering companion**

Amber provides the **governance and contract layer** (loop contracts, ledgers, hard stops, review gates, skills harness). Pair it with the [loop-engineering](https://github.com/cobusgreyling/loop-engineering) patterns and CLIs for operational readiness:

- `npx @cobusgreyling/loop-audit . --suggest` — scores loop readiness (L1/L2/L3) and gives concrete suggestions
- `npx @cobusgreyling/loop-cost` — token/cost estimation before scheduling
- `LOOP.md` (this repo) — describes Amber's active loops using loop-engineering vocabulary
- Simple `STATE.md` (optional overlay) — human + agent friendly memory spine compatible with daily-triage etc.

See [LOOP.md](./LOOP.md) for Amber's self-described loops (Daily Amber Triage, CI validation, adoption flows) and how the two systems complement each other. Phased rollout (report → assisted → governed) is encouraged.

### Mechanical enforcement (opt-in)

Amber's gates are advisory by default — a markdown field someone flips. To enforce them at commit
time, install the opt-in guard:

```bash
amber hooks install --target .     # writes .git/hooks/pre-commit (opt-in; never auto-installed)
amber hooks status --target .
amber hooks check --target .       # what the hook runs; exits non-zero on a violation
```

The guard reads governance **metadata only** (e.g. a feature must not be marked complete with an
empty `evidence` array) — it never runs your build or tests. Install with `--warn-only` to surface
findings without blocking, bypass once with `AMBER_SKIP_HOOKS=1 git commit ...`, or remove it with
`amber hooks uninstall`.

Every blocking error carries a stable code (e.g. `AMBER_E_FEATURE_NO_EVIDENCE`). Run
`amber explain <code>` for its cause and fix, `amber explain` to list them all, or
`amber explain --markdown docs/ERROR_CODES.md` to write a standalone reference table.

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
