# LOOP.md — Amber Protocol (Loop Engineering)

This file describes how **Amber Protocol** is maintained using loop engineering patterns on top of its built-in governance and loop contract system.

Amber is a **governance-first repository-local harness**. It defines strict Loop Contracts (see `schemas/loop-contract.schema.json` and `workflow-packs/`) with explicit `execution: { executesAnything: false }`. Live scheduling and autonomous agent dispatch remain **outside the current product boundary**.

We combine Amber's contracts + skills + ledgers with the operational patterns and tooling from [loop-engineering](https://github.com/cobusgreyling/loop-engineering).

## Active Loops

### Daily Amber Triage (L1 — report + governance inspection)

- **Cadence**: Daily (or on demand)
- **Contract**: `daily-amber-triage` in [workflow-packs/safe-amber-bootstrap.pack.json](workflow-packs/safe-amber-bootstrap.pack.json)
- **Skill**: `amber-continuous-improvement` (see `skills/amber-continuous-improvement/SKILL.md`)
- **State spine**: `.amber/loops/daily-amber-triage/state.json` (per contract) + project-level observability
- **Phase**: Report / inspection only. `loop run` is always invoked with `--dry-run`.
- **How invoked** (Grok example):
  ```
  /loop 1d Run amber-continuous-improvement. Inspect Amber health using amber doctor, manifests, and wiki validation. Update relevant state. Produce candidate improvements only — never mutate without explicit human approval.
  ```
- **Outputs**: Findings for continuous improvement, maintenance proposals (in `.amber/maintenance/proposals/`), next safe commands.
- **Human gate**: All file changes, command execution, and external writes require explicit approval per the pack's `approvalPolicy`.

### CI / Validation Automation (always-on)

- Runs on every push/PR via [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Includes: `npm test`, `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`, CLI smoke tests, coverage, security.
- This acts as a **CI Sweeper + Dependency + Post-Merge** verification layer (see loop-engineering patterns).
- Failures surface in PRs and block merges where policy requires.

### Adoption & Continuous Improvement

- `amber adoption report` (read-only) for onboarding existing projects.
- `amber doctor`, `amber audit`, `amber handoff` — recurring health and readiness checks.
- Feature work follows route contracts (`routes/*.route.json`) + session lifecycle.
- `amber loop recommend` / `amber loop run --dry-run` for safe selection of maintenance loops.

### Handoff & Session Lifecycle (opportunistic)

- Uses Amber session manifests, checkpoints, and `session-handoff.md` for clean work transfer between sessions/agents.
- Aligns with loop-engineering "handoff to human with full context" principle.

## Multi-Loop Coordination & Priority

1. CI validation (always-on, blocking)
2. Daily Amber Triage (governance inspection + candidate work)
3. Adoption reports (when onboarding or major changes)
4. Feature / bugfix routes (user-driven via `amber plan` + sessions)
5. Release / changelog processes (manual + doctor gates)

See Amber control layers in README.md (Governance > Verification > Observability first).

## State & Memory

Amber uses multiple durable spines:

- **Contract-defined**: `.amber/loops/{contractId}/...` (ledgers, state per loop-contract.schema.json)
- **Continuous improvement**: `.workflow/continuous-improvement/state.json`
- **Sessions & handoff**: `.amber/sessions/`, `session-handoff.md`
- **Project tracking**: `feature_list.json`, `PROGRESS.md`, timelines in sessions
- **Optional human-friendly overlay** (recommended when running loop-engineering patterns): `STATE.md` at root (see loop-engineering daily-triage format)

The simple `STATE.md` (High Priority / Watch List / Recent Noise / Post-Run Critique) is excellent for daily-triage loops because it is directly readable and updatable by both humans and agents.

## Worktrees & Isolation

Per Amber contracts (`workspaceIsolation` in workflow packs):

- Mutating work uses isolated git worktrees.
- Main checkout is never mutated directly by automated loops.

## Safety, Budgets & Gates (Amber-native)

- All loops declare `hardStops` (maxIterations, timeoutMinutes, noProgressDetection) and `budget`.
- `reviewGates` and `approvalPolicy` are enforced at the contract level.
- `amber doctor` + `amber loop inspect` validate readiness.
- Denylists and "no auto-execution" are core to the product (see CLAUDE.md and SPEC.md).

When layering loop-engineering tools:

- Use `npx @cobusgreyling/loop-budget.md` + `loop-run-log.md` for operational cost tracking.
- Add token/minute budgets matching the Amber contract `budget` fields.

## Tooling (Loop Engineering CLIs + Amber)

Run these alongside Amber commands:

```bash
# Scaffold loop artifacts (use with caution — Amber already has rich structure)
npx @cobusgreyling/loop-init . --pattern daily-triage --tool grok

# Score loop readiness (pairs beautifully with `amber doctor`)
npx @cobusgreyling/loop-audit . --suggest

# Estimate costs
npx @cobusgreyling/loop-cost --pattern daily-triage --level L1 --cadence 1d

# Amber-native loop commands (dry-run only)
node scripts/amber.js loop recommend --target . --goal "continuous improvement"
node scripts/amber.js loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run
node scripts/amber.js doctor --target .
```

See full Amber loop commands in [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md).

## Phased Rollout (L1 → L2 → L3)

Follow loop-engineering guidance:

- **L1 (current for most Amber loops)**: Report-only, human reviews STATE.md / ledgers / doctor output.
- **L2**: Assisted. **Now partly available** via governed execution (ADR-0003): `amber loop approve`
  then `amber loop run --execute` runs a contract's `governed.command` in an isolated worktree with a
  tamper-evident ledger. Human approval is required; scheduling/unattended runs stay disallowed.
- **L3**: Unattended — still disallowed by the Amber product boundary (no scheduling/daemon; loop
  `execution.executesAnything` stays `false`).

Amber's explicit boundaries make it a **safe place to practice L1/L2 loops**.

## Evolution & Dogfooding

This repo dogfoods its own governance:

- CI runs doctor + manifest validation on every change.
- Skills are regenerated via `npm run gen:agents` (never edit generated agent command surfaces directly).
- Adoption reports and handoff validation are part of the offering.

Future: richer integration of loop-engineering patterns (PR Babysitter, Changelog Drafter, etc.) expressed as Amber workflow-packs or routes.

## References

- Loop Engineering: https://github.com/cobusgreyling/loop-engineering
- Daily Triage pattern: https://github.com/cobusgreyling/loop-engineering/blob/main/patterns/daily-triage.md
- Amber Loop Contract schema: schemas/loop-contract.schema.json
- Amber continuous improvement skill: skills/amber-continuous-improvement/SKILL.md
- Primitives matrix (Grok mapping): see loop-engineering docs/primitives-matrix.md

---

_LOOP.md is both documentation and the seed for loops that help maintain Amber. Update it when cadence, contracts, or safety rules change._
