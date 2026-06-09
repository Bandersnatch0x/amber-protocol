# Coding Harness

Coding Harness is a repository-local agent operating toolkit. Its V1 core safely installs or audits a small set of files that help agents find project context, track feature state, validate work, and hand off cleanly between sessions. Later phases add artifact-only planning, review, orchestration metadata, team distribution metadata, and maintenance proposals.

The V1 command surface remains intentionally narrow: `init`, `audit`, `wiki`, `doctor`, and `handoff`. Later commands are gated and auditable; they do not invoke a live subagent runner, call external marketplaces, or automatically rewrite existing project documents.

## What It Creates

Minimum Harness files checked by `doctor`:

- `AGENTS.md` and `CLAUDE.md` agent entrypoints
- `feature_list.json` machine-readable feature state
- `PROGRESS.md` and `session-handoff.md` continuity files
- `clean-state-checklist.md` and `evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- Minimum `docs/wiki/` pages for index, product overview, system map, runbook, verification, agent harness, continuous improvement, workflow packets, and glossary

Starter files created by `init` and `wiki`:

- Additional product, architecture, engineering, agent, and feature Wiki pages
- `.workflow/continuous-improvement/packets/README.md` packet notes

Starter files are safe defaults for a richer project map. They may be removed or skipped in an existing project as long as the remaining Wiki pages do not link to missing local files.

## New Project Setup

Run the init command from this toolkit repository:

```sh
node scripts/harness.js init --target path/to/project
```

The package also exposes a `coding-harness` bin entry for linked or packaged use:

```sh
coding-harness init --target path/to/project
```

The scaffold is idempotent and does not overwrite existing files. Existing files are reported as skipped so a human can decide whether to merge suggested content.

## Existing Project Audit

Inspect an old project without modifying it:

```sh
node scripts/harness.js audit --target path/to/project
node scripts/harness.js audit --target path/to/project --summary
node scripts/harness.js adoption report --target path/to/project --output docs/examples/project-adoption-report.md
node scripts/harness.js adoption report --target path/to/project --output-dir docs/examples/adoptions
node scripts/harness.js adoption list --reports-dir docs/examples/adoptions
node scripts/harness.js adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md
node scripts/harness.js adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md
node scripts/harness.js adoption compare --reports-dir docs/examples/adoptions
node scripts/harness.js adoption compare --base docs/examples/adoptions/older.md --head docs/examples/adoptions/newer.md --output docs/examples/adoption-diff.md
node scripts/harness.js adoption gate --reports-dir docs/examples/adoptions
node scripts/harness.js adoption gate --report docs/examples/adoptions/newer.md --output docs/examples/adoption-gate.md
node scripts/harness.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md
node scripts/harness.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output docs/examples/adoption-status.md
node scripts/harness.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle
node scripts/harness.js adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md
node scripts/harness.js adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record.md
node scripts/harness.js adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record-reviewed.md --decision command-confirmation=deferred:Need-owner-confirmation
node scripts/harness.js adoption apply-plan --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-apply-plan.md --dry-run
node scripts/harness.js adoption selected-files --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-selected-files.md --include AGENTS.md --include CLAUDE.md
```

The audit reports existing agent instructions, detected commands, tooling evidence, missing Harness files, and conflicts. V1 does not automatically merge `AGENTS.md`, `CLAUDE.md`, or existing docs.

Command detection is conservative: confirmed entrypoints such as `package.json` scripts and Makefiles are reported as commands. Lockfiles and Python project files are reported as tooling evidence only, with an unknown recorded when the exact verification command cannot be proven.

For Python repositories, `audit` may also report `candidateCommands` such as `python -m pytest` when test/tooling evidence exists. Candidate commands require human confirmation and are not treated as confirmed project commands.

Audit documentation discovery skips dependency and generated-output directories such as `node_modules/`, virtual environments, `site-packages/`, `results/`, and `data/reports/` so old projects with large local artifacts stay readable.

Use `audit --summary` for large existing repositories. JSON output remains complete, while summary text reports counts, candidate commands, unknowns, and the next safe command without expanding long documentation lists.

Use `adoption report` for a single reviewable trial artifact. It aggregates audit, init dry-run, team-distribution status/update preview, and maintenance inspection into one markdown file. It does not initialize the target, install team metadata, or execute target project commands. Prefer `--output-dir` when you want the tool to create a non-conflicting timestamped report name.

Use `adoption list` to read generated report metadata from a reports directory without writing files. Use `adoption index` to create an explicit markdown index for a reports directory; it refuses to overwrite an existing index path. Use `adoption validate` to read-only check report metadata and optional index links. Use `adoption compare` to diff two adoption reports or the latest two reports in a directory; markdown diff output is only written when `--output` is explicit and unused. Use `adoption gate` as a conservative readiness check; missing Harness files, conflicts, unresolved unknowns, or unconfirmed candidate commands return a `wait` decision. Use `adoption status` as the read-only summary entrypoint for report count, latest report, index health, gate decision, recent compare summary, blockers, and next safe action. Use `adoption bundle` to create a review directory with status, index, diff, gate, README, and manifest files; `--output-dir` must not already exist. Use `adoption next-actions` to turn a bundle into a human approval checklist; `--output` must not already exist. Use `adoption decision-record` to create a pending Gate A/B/C audit record; it does not approve target writes by itself and refuses to overwrite existing output. Add repeatable `--decision <gate>=<status>[:note]` flags to record decisions with `pending`, `approved`, `rejected`, or `deferred`; recorded decisions remain audit evidence and do not execute follow-up work. Use `adoption apply-plan --dry-run` to preview target bootstrap file creation from a bundle; V1 rejects non-dry-run apply plans.

Use `adoption selected-files` to turn a bundle into an explicit file-selection proposal. Repeatable `--include <relative-path>` flags select known Harness bootstrap, starter wiki, or support files for review; unsafe paths such as absolute paths or `..` segments and unknown paths fail without writing output. The proposal is written only to the requested unused output path and does not copy files into the target project.

## Validation

Validate a generated or maintained Harness:

```sh
node scripts/harness.js wiki --target path/to/project
node scripts/harness.js handoff --target path/to/project
node scripts/harness.js doctor --target path/to/project
```

Run `node scripts/harness.js <command> --help` for command-specific options. Dry-run behavior is command-specific: scaffold commands preview missing files, while team updates use `--dry-run` for upgrade previews.

For focused low-level checks, the individual validator scripts remain available under `scripts/`.

`wiki` creates missing `docs/wiki/` skeleton files from templates and then validates local Wiki links. Existing Wiki files are skipped and never overwritten; use `--dry-run` to preview missing Wiki files without writing them.

For this repository itself, run:

```sh
npm test
npm run manifests
```

`npm run manifests` performs local structural validation for this toolkit's `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`. It does not publish, install, or certify plugins with an external platform.

When `doctor` is run against this toolkit repository, it reports `product-repo` status and runs product-level checks such as plugin manifest validation and workflow-pack/profile smoke inspection. Target repositories are classified separately as harnessed or unharnessed targets.

## Workflow Pack Smoke Inspection

V1.5 includes declarative sample files under `workflow-packs/` and `profiles/`. They can be inspected by the product doctor and validation helpers without executing scripts, workflows, external integrations, or subagents.

V3 exposes the design-kit commands directly:

```sh
node scripts/harness.js pack inspect --file workflow-packs/safe-harness-bootstrap.pack.json
node scripts/harness.js pack validate --file workflow-packs/safe-harness-bootstrap.pack.json
node scripts/harness.js profile inspect --file profiles/default.profile.json
```

Pack validation catches missing skills, broken standards references, unsafe script declarations, and undeclared external integrations. It remains a dry-run design check.

Workflow packs may also describe loop contracts: dry-run-only declarations for repeated agent workflows. A loop contract records its trigger, cadence, state spine, input sources, skills, connector declarations, triage outputs, hard stops, budget, and review gates. It explains how a loop would discover, triage, verify, and resume work, but it does not schedule jobs, dispatch live agents, call external systems, or apply fixes.

## Planning Gates

V2 adds a static planning layer:

```sh
node scripts/harness.js plan --target path/to/project --feature F001 --title "Small slice"
node scripts/harness.js gate --target path/to/project --plan docs/plans/F001-small-slice.md
```

`plan` creates a feature-linked plan without overwriting existing files. A plan is treated as a durable agent checkpoint: it records source bundles, unresolved unknowns, constraints, vertical slices, verification, acceptance criteria, blockers, and the next resume point. `gate` validates feature tie-back, high-level design, source provenance, evidence schema, and explicit user confirmation. It does not execute implementation work.

## Review And Acceptance

V2.5 adds static review and acceptance gates:

```sh
node scripts/harness.js review --target path/to/project --plan docs/plans/F001-small-slice.md
node scripts/harness.js accept --target path/to/project --plan docs/plans/F001-small-slice.md
```

`review` loads Harness standards and reports applicable checks, findings, required user action, release readiness, and the human feedback behind redirects or approval. `accept` only appends `docs/wiki/engineering/harness-evolution.md` after review passes.

## Isolated Task Results

V4 adds replayable task artifacts:

```sh
node scripts/harness.js task prepare --target path/to/project --plan docs/plans/F001-small-slice.md --task slice-1
node scripts/harness.js result inspect --target path/to/project --task slice-1
```

`task prepare` creates `.harness/worktrees/<task>/` plus `.harness/executions/<task>/ledger.json`, `evidence.json`, and `replay.md`. It prepares isolation and replayability; it does not execute task commands. Trace-derived work should preserve original failing inputs, relevant configuration, and proposed regression assertions before acceptance.

## Agent Orchestration Records

V4.5 adds artifact-only orchestration records:

```sh
node scripts/harness.js agent dispatch --target path/to/project --task slice-1 --worker worker-a --reviewer reviewer-b
node scripts/harness.js agent stop --target path/to/project --task slice-1
node scripts/harness.js agent resume --target path/to/project --task slice-1
node scripts/harness.js agent review --target path/to/project --task slice-1 --reviewer reviewer-b --decision approved --evidence "reviewed ledger"
```

`agent dispatch` requires a prepared task ledger and enforces worker/reviewer separation. It writes dispatch and reviewer-evidence files under `.harness/orchestration/<task>/`; it does not run a worker or accept worker output automatically. Loop orchestration records must point back to declarative loop contracts, replayable evidence, budget/hard-stop status, and reviewer gates.

## Team Distribution

V5 adds local team distribution metadata:

```sh
node scripts/harness.js team inspect --target path/to/project
node scripts/harness.js team install --target path/to/project --version 1.0.0 --preset safe-bootstrap
node scripts/harness.js team update --target path/to/project --version 1.1.0 --dry-run
node scripts/harness.js team update --target path/to/project --version 1.1.0 --confirm
node scripts/harness.js team rollback --target path/to/project --version 1.0.0 --confirm
node scripts/harness.js team pin --target path/to/project --version 1.0.0
```

Team state is stored under `.harness/team/`. Installs, updates, pins, and rollbacks write lock/snapshot metadata only; they do not seed or overwrite root project files.

## Maintenance

V5.5 adds continuous maintenance checks and proposals:

```sh
node scripts/harness.js maintenance inspect --target path/to/project
node scripts/harness.js maintenance propose --target path/to/project
```

`maintenance inspect` reports stale Wiki docs, wiki-lint CI commands, migration and upgrade guidance, rule-pack drift, and repeated evolution findings. `maintenance propose` writes a reviewable proposal under `.harness/maintenance/proposals/`; it does not modify Wiki or standards files.

## Rollback And Uninstall Boundaries

V1 does not include an automatic uninstall command. Rollback means reviewing the scaffold output and removing only the files that were created for the Harness. Files that existed before `init` are never overwritten by default.

## Continuous Improvement Boundary

The scaffold includes continuous-improvement state and workflow-packet templates. These are static operating guides: they help agents choose one safe improvement slice, record evidence, and stop at approval gates. Later phase commands can prepare ledgers, dispatch records, locks, snapshots, and proposals, but they still do not execute dynamic workflows, invoke live subagents, or write to external systems.

## Non-Goals

- No dynamic workflow execution
- No live subagent runner invocation
- No automatic task command execution
- No remote/email task ingress that starts live agents
- No live loop scheduler, cron runner, or autonomous loop daemon
- No model/backend routing
- No permission-bypass or account-bearing CLI automation as default product behavior
- No automatic trace-derived code fixes or test-suite rewrites
- No MCP server
- No external marketplace publishing
- No GitHub or CI automation platform writes
- No automatic rewrite of old project documents

See [SPEC.md](./SPEC.md) for the product boundary and [ROADMAP.md](./ROADMAP.md) for deferred phases.
