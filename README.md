# Amber Protocol

<p align="center">
  <img src="./assets/brand/amber-protocol-logo.png" alt="Amber Protocol logo" width="160" />
</p>

[简体中文](./README.zh-CN.md)

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

Amber Protocol is a repository-local governance and control layer for agent-assisted engineering. It installs, audits, validates, and maintains a small set of project files that help agents understand a codebase, keep feature state explicit, and hand off work cleanly.

The current product is deliberately conservative. It creates review artifacts, dry-run plans, approval records, workflow-pack metadata, and maintenance proposals. It does not run Dynamic Workflows, invoke live subagents, execute target project commands, or automatically rewrite old project files.

Amber Protocol (formerly Coding Harness) is a repo-local governance layer for coding agents. It is not trying to become a general agent framework or execution platform. It is trying to constrain, verify, audit, and hand off agent work safely inside a repository. The legacy `coding-harness` bin and `.harness` state remain readable for one release; see `docs/release/MIGRATION_GUIDE.md`.

![Amber Protocol safe bootstrap infographic](./assets/readme/amber-protocol-cover.png)

## Positioning

This project is strongest when framed as a governance-first protocol layer with supporting verification and lifecycle capabilities. A useful way to read the current system is through seven control layers: `Execution`, `Tooling`, `Context`, `Lifecycle`, `Observability`, `Verification`, and `Governance`.

| Layer | Current role in this project | Priority |
| --- | --- | --- |
| `Execution` | Minimal. The project avoids becoming a general execution runtime or live agent platform. | Low |
| `Tooling` | CLI commands, schemas, validators, workflow packs, and profiles expose explicit interfaces. | Medium |
| `Context` | Starter docs, wiki scaffolds, manifests, and handoff artifacts keep project context explicit. | Medium |
| `Lifecycle` | Routes, sessions, checkpoints, worktrees, and continuation flows organize work locally. | Medium |
| `Observability` | Timelines, manifests, ledgers, reports, and maintenance artifacts make behavior inspectable. | High |
| `Verification` | Doctor, audit, validation, review, and gate surfaces provide explicit checks. | High |
| `Governance` | Approval records, safe defaults, policy boundaries, and adoption controls constrain behavior. | Highest |

This is the architectural through-line behind the Amber Protocol direction: strengthen `Governance`, `Verification`, and `Observability`; keep `Lifecycle` repository-local; avoid drifting into a full agent platform.

## Architecture

```mermaid
flowchart LR
  CLI["scripts/amber.js<br/>Unified CLI"] --> Core["scripts/lib/amber-core.js<br/>Deterministic operations"]
  Core --> Templates["templates/<br/>Amber starter files"]
  Core --> Skills["skills/<br/>Agent-facing instructions"]
  Core --> Packs["workflow-packs/<br/>Declarative packs"]
  Core --> Profiles["profiles/<br/>Project profiles"]
  Core --> Examples["docs/examples/<br/>Review artifacts"]
  Core --> Validators["scripts/validate-*<br/>Manifest/wiki checks"]
  Core --> Routes["routes/*.route.json<br/>Delivery route definitions"]
  Core --> Schemas["schemas/*.schema.json<br/>JSON Schema drafts"]
  Core --> PhaseB["src/migration/ src/security/<br/>Migration tools + Security scanners"]
  Core -.-> Web["apps/web/<br/>Phase C scaffolding (deferred)"]
  Tests["tests/<br/>Node test suite"] --> CLI

  Target["Target repository"] -. "init/wiki create missing files only" .-> Templates
  Target -. "audit/adoption read target state" .-> CLI
```

Core boundaries:

- `scripts/amber.js` handles command routing and user-facing output.
- `scripts/lib/amber-core.js` contains deterministic scaffold, audit, adoption, planning, review, team, and maintenance logic.
- `templates/`, `skills/`, `workflow-packs/`, and `profiles/` are declarative inputs.
- `tests/` protect idempotency, output safety, schema validation, and V1 boundaries.
- `docs/examples/` contains review artifacts generated from real read-only trials.

Control-plane emphasis:

- **Governance:** approvals, adoption gates, safety boundaries, maintenance proposals, and explicit non-goals.
- **Verification:** doctor, audits, schema validation, review artifacts, and dry-run proof surfaces.
- **Observability:** session timelines, ledgers, manifests, reports, and other inspectable records.
- **Lifecycle:** routes, sessions, checkpoints, and worktrees remain local control mechanisms rather than a full orchestration platform.

## Command Surface

### V1–V5.5 Commands

Safe bootstrap:

```sh
node scripts/amber.js init --target path/to/project
node scripts/amber.js audit --target path/to/project --summary
node scripts/amber.js wiki --target path/to/project --dry-run
node scripts/amber.js doctor --target path/to/project
node scripts/amber.js handoff --target path/to/project
```

### Phase B Commands

Route engine:

```sh
node scripts/amber.js route list
node scripts/amber.js route inspect feature-standard
node scripts/amber.js route validate routes/feature-standard.route.json
node scripts/amber.js route test bugfix-quick --dry-run
```

Session lifecycle:

```sh
node scripts/amber.js session start --goal "fix login bug"
node scripts/amber.js session start --goal "add feature" --mode interactive
node scripts/amber.js session status
node scripts/amber.js session list
node scripts/amber.js session abort <session-id>
node scripts/amber.js session continue
```

Migration:

```sh
node scripts/amber.js migrate --target .
node scripts/amber.js migrate --target . --dry-run
```

Daemon:

```sh
node scripts/amber.js daemon status
node scripts/amber.js daemon stop
```

Adoption review chain:

```sh
node scripts/amber.js adoption report --target path/to/project --output-dir docs/examples/adoptions
node scripts/amber.js adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md
node scripts/amber.js adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md
node scripts/amber.js adoption compare --reports-dir docs/examples/adoptions
node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions
node scripts/amber.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md
node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle
node scripts/amber.js adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md
node scripts/amber.js adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record.md
node scripts/amber.js adoption apply-plan --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-apply-plan.md --dry-run
node scripts/amber.js adoption selected-files --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-selected-files.md --include AGENTS.md
```

Artifact-only planning and review:

```sh
node scripts/amber.js plan --target path/to/project --feature F001 --title "Small slice"
node scripts/amber.js gate --target path/to/project --plan docs/plans/F001-small-slice.md
node scripts/amber.js review --target path/to/project --plan docs/plans/F001-small-slice.md
node scripts/amber.js accept --target path/to/project --plan docs/plans/F001-small-slice.md
```

Declarative inspection:

```sh
node scripts/amber.js pack inspect --file workflow-packs/safe-amber-bootstrap.pack.json
node scripts/amber.js pack validate --file workflow-packs/safe-amber-bootstrap.pack.json
node scripts/amber.js profile inspect --file profiles/default.profile.json
```

Local team and maintenance metadata:

```sh
node scripts/amber.js team inspect --target path/to/project
node scripts/amber.js team install --target path/to/project --version 1.0.0 --preset safe-bootstrap
node scripts/amber.js maintenance inspect --target path/to/project
node scripts/amber.js maintenance propose --target path/to/project
```

Run `node scripts/amber.js <command> --help` for scoped command help.

Additional commands `task`, `result`, `agent`, and `loop` exist but are
lower-level orchestration tools used internally by the execution engine;
they are not documented in this README.

## What Gets Installed

Minimum Amber files checked by `doctor`:

- `AGENTS.md` and `CLAUDE.md`
- `feature_list.json`
- `PROGRESS.md`
- `session-handoff.md`
- `clean-state-checklist.md`
- `evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- minimum `docs/wiki/` pages for project context, system map, runbook, verification, glossary, and agent operations

Starter files are safe defaults. `init` and `wiki` skip existing files and report what would be created in dry-run mode.

## Adoption Boundaries

Adoption commands are for old or existing projects that should not be modified automatically.

- `adoption report` aggregates audit and dry-run evidence into a single review artifact.
- `adoption bundle` packages report status, index, diff, gate, and manifest files into a review directory.
- `adoption next-actions` creates a checklist for human approval.
- `adoption decision-record` records Gate A/B/C decisions but does not execute them.
- `adoption apply-plan --dry-run` previews bootstrap file creation; non-dry-run apply plans are rejected in V1.
- `adoption selected-files` accepts only safe relative known Amber file paths and writes only the requested proposal.

Sample adoption artifacts live under `docs/examples/` and are review-only. They do not imply the target project was initialized, modified, or tested.

## Short Roadmap

| Phase | Status | Scope |
| --- | --- | --- |
| V1 – V5.5 | Implemented | `init`, `audit`, `wiki`, `doctor`, `handoff`, plans, gates, reviews, packs, teams, maintenance, loops |
| **Phase B Alpha W1** | Implemented | Schema foundation: route/session timeline schemas + validators |
| **Phase B Alpha W2** | Implemented | Route engine: route-loader, route-selector, `route` CLI |
| **Phase B Alpha W3** | Implemented | Session lifecycle: state machine, worktree manager, `session` CLI |
| **Phase B Alpha W4** | Implemented | Interactive execution: stage executor, gate handler, budget tracker |
| **Phase B Alpha W5** | Implemented | Checkpoint & continue: checkpoint-manager, migrate CLI |
| **Phase B Beta** | Implemented | Autonomous mode: executor, policy, daemon, logger, notifier, session-lock |
| **Phase B RC** | Implemented | Integration testing: e2e/load/migration/security test suites |
| **Phase B GA** | Implemented | Release: publish/release scripts, migration tools (dry-run, rollback, schema-validator) |
| **Phase C** | Scaffold only | Web Viewer — 7 config files, 0 pages. Deferred. |
| Future Live Loop Scheduling | Not implemented | future-only readiness track |

Loop readiness is available as a static, record-only surface. `pack readiness` checks declarative controls without running jobs, dispatching live agents, writing external systems, or opening PRs. `loop inspect`, `loop run --dry-run`, `loop record`, and `loop status` resolve contracts and write or inspect ledger records only; `readyForLiveScheduling` remains `false` by product boundary.

For the full boundary and phase notes, see [SPEC.md](./SPEC.md) and [ROADMAP.md](./ROADMAP.md).

## CI/CD

GitHub Actions lives in `.github/workflows/ci.yml`.

CI runs on pushes and pull requests:

- install dependencies with `npm install`
- run `npm test`
- run manifest validation
- run `doctor --target .`
- smoke-check CLI help

Release dry-run runs when a tag like `v1.2.3` is pushed:

- reruns the CI checks
- runs `npm pack --dry-run`
- uploads the generated package preview as an artifact

No workflow publishes packages, creates releases, or uses repository secrets.

## Local Verification

```sh
npm test
npm run manifests
npm run doctor
node scripts/amber.js --help
```

The test suite uses Node's built-in test runner and requires Node `>=18.17`.

Load and E2E tests (separate, may be slower):

```sh
npm run test:load
```

## Non-Goals

- No Dynamic Workflow execution.
- No live subagent runner invocation.
- No automatic target project command execution.
- No external marketplace publishing.
- No automatic rewrite of existing target project docs.
- No scheduled loop execution in the current product.
