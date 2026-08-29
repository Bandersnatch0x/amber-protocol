<div align="center">

# Amber Protocol

> **Make AI coding sessions reviewable, gated, and handoff-ready.**

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![npm](https://img.shields.io/npm/v/amber-protocol?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D23-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)

<p align="center">
  <a href="#what-is-amber">What is Amber</a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#core-concepts">Core Concepts</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  Repository-local governance for AI-assisted engineering — plans, gates, approvals,<br />
  and handoffs live as inspectable files inside your repo.<br />
  <b>Status:</b> Stable · <a href="./ROADMAP.md">Milestones & test status →</a>
</p>

</div>

---

## What is Amber?

Amber Protocol is a repository-local governance layer for AI-assisted engineering. When a team lets an AI agent work inside a repo, the hard parts are no longer just writing the code. The hard parts are knowing what was done, whether it is safe to keep, how to hand it off, and how to prove it was reviewed.

Amber makes those parts explicit: it prepares agent-facing context, records approvals and gates, verifies state with read-only checks, and produces handoff and audit artifacts as files inside your repository.

It is deliberately conservative. Amber creates review artifacts, dry-run plans, and approval records. It does **not** run dynamic workflows, invoke live subagents, execute your project's commands, or rewrite your existing docs.

## Why Amber?

AI coding work becomes easier to trust when the workflow leaves inspectable evidence:

- **Reviewable by default:** plans, gates, ledgers, and handoffs live in the repo instead of in a chat transcript.
- **Dry-run first:** setup, audit, route, and loop commands expose intent before changing state.
- **Human gates stay explicit:** approvals are records a reviewer can inspect, not hidden runtime assumptions.
- **Agent context is local:** `AGENTS.md`, wiki files, feature plans, and session handoffs travel with the codebase.

## Lifecycle map

```text
audit -> init -> governance report -> next -> plan -> gate -> verify -> approve -> handoff bundle -> handoff validate
```

| Stage         | Command                                                   | What you get                                                                                           |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Inspect       | `amber audit --target <repo> --summary`                   | Read-only readiness findings                                                                           |
| Install       | `amber init --target <repo>`                              | Starter governance files without overwrites                                                            |
| Score         | `amber governance report --target <repo>`                 | Readiness score, risks, and structured next actions                                                    |
| Effectiveness | `amber workflow assess --target <repo>`                   | Workflow-effectiveness dimensions (separate from readiness; ADR-0008)                                  |
| Plan          | `amber plan --target <repo> --feature F001 --title "..."` | A feature plan and review surface                                                                      |
| Gate          | `amber next --target <repo>`                              | The next safe lifecycle command                                                                        |
| Verify        | `amber doctor --target <repo>`                            | Checks for required agent-facing surfaces                                                              |
| Context       | `amber context request --target <repo> --page <id>`       | Contract-driven distillation: turns session evidence into provenance-backed knowledge pages (ADR-0009) |
| Memory        | `amber memory status --target <repo> --json`              | Governed MEMORY.md write-back pipeline: nominate, admit, approve, book (ADR-0018)                      |
| Handoff       | `amber handoff bundle --target <repo>`                    | Portable continuation bundle another human or agent can continue                                       |

## Repository artifacts

Amber is meant to be inspected as files:

```text
AGENTS.md
CLAUDE.md
feature_list.json
PROGRESS.md
session-handoff.md
clean-state-checklist.md
docs/wiki/
.workflow/continuous-improvement/state.json
```

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

<details>
<summary><b>From GitHub Packages</b> (scoped package, one-time <code>.npmrc</code> setup)</summary>

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

</details>

## Use with DeepSeek Harness

Amber is listed under the official [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic. Install it as a native dsh bundle — no manual path editing:

```bash
# Install once; dsh adds the Amber bundle layer to your profile
dsh plugin --profile web add dsh-amber-protocol

# Ordinary startup loads Amber after install (no repeated --patch flag)
dsh --profile web
```

On Windows, default port `3080` is often reserved — pass `--port 13080` if listen fails.

**Unpublished checkout fallback:** if you are developing Amber itself and the bundle is not yet published, use the overlay patches instead. Edit `dsh/amber-full.patch.yml`, replace `/path/to/amber-protocol` with this checkout, then overlay without changing your profile:

```bash
dsh --profile web --patch /path/to/amber-protocol/dsh/amber-full.patch.yml
```

Full bundle and overlay notes: [dsh/README.md](./dsh/README.md).

## Quick Start

Bring Amber into an existing repository and produce a handoff-ready delivery bundle:

```bash
# 1. Read-only audit of the target repo (changes nothing)
amber audit --target my-project --summary

# 2. Install Amber starter files (skips anything that already exists)
amber init --target my-project

# 3. Verify the repo now has the expected agent-facing surfaces
amber doctor --target my-project

# 4. Score the delivery loop and risks
amber governance report --target my-project

# 5. Ask Amber what to do next: it reads live state and prints one command
amber next --target my-project

# 6. Produce and validate the portable handoff bundle
amber handoff bundle --target my-project
amber handoff validate --target my-project
```

`init` and `wiki` never overwrite existing files. Default help shows journey and core governance commands; `amber --all` shows the complete compatibility surface. See the [CLI reference](./docs/CLI_REFERENCE.md).

### `amber governance report` - readiness score and next actions

`amber governance report` is the primary product-loop report. It scores governance, evidence,
continuity, safety, and maintenance; names risks; and emits structured next actions with the exact
command and expected outcome.

```bash
amber governance report --target .
amber governance report --target . --output docs/quality/amber-governance-report.md --confirm
```

### `amber next` — guided next step

`amber next` is read-only: it infers where the repo sits in the Amber delivery lifecycle
(`init → feature → plan → gate → verify/approve → complete-check → accept`) and prints the single
most relevant next command — it never runs anything itself.

```bash
amber next --target .                 # auto-selects a focus and states which it chose
amber next --target . --feature F001  # focus one feature's lifecycle
amber next --target . --session <id>  # focus a session's verify → approve → complete-check
amber next --target . --objective "fix login timeout" # suggest a target-local Route and Workflow Pack
amber next --target . --json          # machine-readable envelope (focus, nextStep, remedy)
```

When a focus is omitted, `next` picks the active session, else the most-recently-touched plan's
feature, else the first unstarted feature — and always says which it chose plus how many other
items are pending. The same actionable `remedy` hints surface inline in `doctor` checks and
`review` findings, so a failed check tells you the exact command to fix it.
With `--objective`, `next` deterministically scores target-local Route and Workflow Pack metadata;
when nothing matches, it advises the plan gate instead of guessing an execution path.

### `amber handoff bundle` - portable continuation artifact

`amber handoff bundle` writes a complete handoff directory with the session summary, verification
evidence, risks, next actions, recovery commands, and manifest. `handoff validate` checks that the
bundle is complete before another human or agent continues.

```bash
amber handoff bundle --target .
amber handoff validate --target .
```

<details>
<summary><b>More command surfaces</b> — workflow effectiveness · learnings · loops · context · memory · operations registries · commit-time enforcement</summary>

#### `amber workflow` — workflow effectiveness (ADR-0008)

`amber workflow` is a **separate** read-only assessment from governance readiness. It scores five
Amber dimensions (Context Adequacy, Lifecycle Discipline, Verification Coverage, Delivery Integrity,
Improvement Loop) from repository evidence and optional session observations. Diagnostics go to
**stderr**; stdout stays parser-safe JSON (or Markdown). Never merges into readiness's overall score.

```bash
# Assess the target (stdout JSON; sessions included by default)
amber workflow assess --target .
amber workflow assess --target . --format markdown
amber workflow assess --target . --output-dir .amber/workflow-reports
amber workflow assess --target . --no-sessions

# Operate on a saved report
amber workflow findings --target . --report path/to/report.json
amber workflow plan --target . --report path/to/report.json --finding ca-1-feature-observable
amber workflow compare --target . --baseline path/to/old.json --current path/to/new.json
```

`plan` is dry-run only (plan-input or maintenance-proposal draft). Only `assess` accepts
`--output-dir`. Full flag list: [CLI reference — Workflow Commands](./docs/CLI_REFERENCE.md#workflow-commands).

#### `amber learnings` — post-accept knowledge checkpoint

After `amber accept`, `amber learnings` checks (read-only) whether the accepted work hit mandatory
knowledge write-back triggers — schema, contract, or infra paths — and `--reviewed` books the review
on the feature entry. Amber detects and reminds; the write-back itself stays with the operator.

```bash
amber learnings --target . --feature F001                          # inspect triggers read-only
amber learnings --target . --feature F001 --reviewed --surface docs/specs/f001.md
```

#### `amber loop recommend` — safe continuous improvement

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

#### `amber context` — contract-driven distillation and Loadouts

`amber context` closes the gap between session evidence and project knowledge (ADR-0009). Amber
emits a distillation contract; a host agent executes it; Amber validates and persists the result —
Amber itself never calls a model.

```bash
amber context request --target . --page governed-execution     # write a distillation contract
amber context ingest --target . --request <id> --payload out.json --confirm   # judge the agent's output
amber context verify --target . --json                         # page health (stale/tampered/obsolete)
amber context refresh --target .                               # regenerate requests for stale sources
amber context load --target . --route feature-standard --feature F016 # assemble a governed Loadout
amber context verify --target . --loadout .amber/context/loadouts/feature-standard-F016.json
amber context projection status --target .                    # verify the derived index projection
amber context benchmark --target . --fixture <fixture.json>   # deterministic Loadout quality report
amber context source-adapter --target . --fixture <fixture.json> --enable # unaccepted local candidates
amber context retention --target . --older-than-days 90       # report-only retention candidates
amber context stats --target . --window 50                     # filter rate, pass rate, unknown share
```

Every claim on an accepted page carries provenance; pages live in `.amber/context/pages/` and are
indexed in `docs/wiki/context-index.md`. See `skills/amber-context-continuity/SKILL.md` for the full
governed context and handoff journey. Loadouts include target-local Required Artifacts and fresh Context
Pages, enforce the configured budget, and fail closed when required inputs are missing or changed.
Knowledge Kind, supersession lineage, and assurance are observational and never grant execution
authority. Source adapters are opt-in, transcript import requires explicit redacted handling, and
returned Source Bundles are hash-bound to the selected Target Repository. Retention never deletes
artifacts. See the [Context threat model](docs/architecture/context-threat-model.md).

#### `amber memory` — governed MEMORY.md write-back

`amber memory` is the ADR-0018 Governed Memory Layer. Amber never writes MEMORY.md: the host agent
(or a human) nominates entries via a request, Amber admits them mechanically (schema, source
binding, signal, α budget, γ rate limit), a human approves entry-by-entry, and `book` registers the
surface hash. `status` is a read-only projection; doctor owns the judgment rules.

```bash
amber memory request --target . --payload mem-request.json --yes   # nominate (T1/T2 or escape hatch)
amber memory ingest  --target . --request mreq-... --yes           # all-or-nothing admission
amber memory approve --target . --entry-id sha256:... --decision approve --yes  # the human gate
amber memory book    --target . --entry-id sha256:... --yes         # register the MEMORY.md hash
amber memory book    --target . --ratify --claim "<heading>" --yes     # ratify a human direct edit (γ-free)
amber memory status  --target . --json                             # entries / gamma / alpha
```

#### `amber maintain` / `retention` / `external` / `breakglass` — governed operations registries (F054–F057)

Four hash-chained, append-only registries under `.amber/<family>/` extend the same contract to
operations: Control Band detectors whose out-of-band observations become deterministic Findings
(`maintain`), governed retention classes with deterministic expiry, Legal Holds, and settled
deletion (`retention`), registered External Effect contracts whose proposals are approval-required
(`external`), and one-use human emergency authorizations with a mandatory post-review
(`breakglass`). Every mutation settles behind a single-use committed human Decision, and nothing
here executes anything itself.

```bash
# F054 — register a Control Band detector, then evaluate one declared observation
amber maintain register-detector --target . --id detector/error-rate \
  --detector-version 1 --metric http-5xx-rate --source observability/api \
  --baseline 10 --rule warn:ge:100 --window-ms 3600000 --scope service/api \
  --cooldown-ms 3600000 --max-observations 100 --owner alice@example.com \
  --decision-identity decision/detector-error-rate --revision 1
amber maintain detect --target . --id detector/error-rate --detector-version 1 \
  --subject service/api --window-from 2026-08-29T00:00:00.000Z \
  --window-to 2026-08-29T01:00:00.000Z --value 120 --observation-hash sha256:<64-hex>

# F055 — classify a record into a governed retention class, then derive expiry read-only
amber retention classify --target . --record spec:spec/login@2 \
  --retention-class operational --policy policy/tenant-retention@1
amber retention evaluate --target . --now 2026-08-29T00:00:00.000Z --json

# F056 — register an External Effect contract; propose an exact request (--yes confirms the
# submission — authorization stays a separate single-use human Approval)
amber external register --target . --id effect/ticket-comment --effect-version 1 \
  --owner platform-team --system ticketing --operation comment.create \
  --external-target tracker/amber-protocol --scope issues \
  --input-schema '{"type":"object","required":["body"]}' --idempotency idempotent \
  --credential scoped --receipt-field commentId \
  --compensation-effect effect/ticket-comment-delete --timeout-ms 30000 \
  --adapter adapter/tracker --adapter-version 1 \
  --decision-identity decision/effect-1 --revision 1
amber external propose --target . --id request/ticket-comment-288 \
  --effect effect/ticket-comment@1 --payload-hash sha256:<64-hex> --yes

# F057 — grant a one-use break-glass authorization (--yes confirms the submission, never the
# emergency itself), then spend it on the already-authorized underlying request
amber breakglass grant --target . --id breakglass/incident-42-restore \
  --incident incident/42 --purpose restore-login-service \
  --capability external:effect/ticket-comment@1 --exact-target tracker/amber-protocol \
  --scope issues --environment production --risk high --credential scoped \
  --valid-from 2026-08-29T00:00:00.000Z --valid-until 2026-08-29T01:00:00.000Z \
  --review-by 2026-09-01T00:00:00.000Z \
  --decision-identity decision/breakglass-42 --revision 1 --yes
amber breakglass use --target . --id breakglass/incident-42-restore \
  --request request/ticket-comment-288
```

Full surfaces, triage/hold/settlement verbs, and error codes: [CLI reference](./docs/CLI_REFERENCE.md).

#### Mechanical enforcement (opt-in)

Amber's gates are advisory by default — a markdown field someone flips. To enforce them at commit
time, install the opt-in guard:

```bash
amber hooks install --target .     # writes .git/hooks/pre-commit (opt-in; never auto-installed)
amber hooks status --target .
amber hooks check --target .       # what the hook runs; exits non-zero on a violation
amber hooks breadcrumb install --target .  # opt-in per-turn workflow-state context injection for agent hosts
```

The guard reads governance **metadata only** (e.g. a feature must not be marked complete with an
empty `evidence` array) — it never runs your build or tests. Install with `--warn-only` to surface
findings without blocking, bypass once with `AMBER_SKIP_HOOKS=1 git commit ...`, or remove it with
`amber hooks uninstall`. The breadcrumb hook (`amber hooks breadcrumb install`) is likewise opt-in
and per-turn: it reads governance metadata only and injects the current workflow state — focus,
session status, required next step — into every agent turn; it never runs target commands.

Every blocking error carries a stable code (e.g. `AMBER_E_FEATURE_NO_EVIDENCE`). Run
`amber explain <code>` for its cause and fix, `amber explain` to list them all, or
`amber explain --markdown docs/ERROR_CODES.md` to write a standalone reference table.

</details>

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
