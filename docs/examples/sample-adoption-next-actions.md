# sample Adoption Next Actions

Status: review only

Target: `D:\code_space\trae-project\sample`

Source bundle: `docs/examples/sample-adoption-bundle/`

Latest report: `docs/examples/adoptions/sample-adoption-report-2026-06-09t01-36-11-331z.md`

Gate decision: `wait`

Next safe action: review adoption gate findings before initializing or changing the target project.

## Boundary

This document is a read-only planning artifact.

- sample files written: false
- sample commands executed: false
- Dynamic Workflow executed: false
- Live subagents invoked: false
- Automatic overwrite allowed: false

## Gate Findings

| Finding | Count | Meaning | Resolution Type |
| --- | ---: | --- | --- |
| Missing required Harness files | 17 | sample has no required Harness bootstrap files yet. | Human approval before `init` or manual adoption |
| Candidate commands unconfirmed | 1 | A Python test command was inferred from tooling and tests layout, but not confirmed. | Human confirms, edits, or rejects |
| Unknowns unresolved | 3 | Verification command evidence is incomplete. | Human answers command questions |
| Conflicts | 0 | No existing Harness file conflicts were detected. | No conflict resolution required |

## Required Harness Files Pending Approval

These are the 17 required files that explain the gate blocker. Creating them would change sample and therefore requires explicit human approval.

- `AGENTS.md`
- `CLAUDE.md`
- `feature_list.json`
- `PROGRESS.md`
- `session-handoff.md`
- `clean-state-checklist.md`
- `evaluator-rubric.md`
- `docs/wiki/index.md`
- `docs/wiki/product/overview.md`
- `docs/wiki/architecture/system-map.md`
- `docs/wiki/engineering/runbook.md`
- `docs/wiki/engineering/verification.md`
- `docs/wiki/agent/harness.md`
- `docs/wiki/agent/continuous-improvement.md`
- `docs/wiki/agent/workflow-packets.md`
- `.workflow/continuous-improvement/state.json`
- `docs/wiki/glossary.md`

## Optional Starter Wiki Files

The full `init --dry-run` preview also includes starter wiki pages that are useful but should be reviewed separately from the required gate blocker.

- `docs/wiki/product/feature-map.md`
- `docs/wiki/product/user-scenarios.md`
- `docs/wiki/architecture/module-boundaries.md`
- `docs/wiki/architecture/data-flow.md`
- `docs/wiki/architecture/decisions/0001-record-architecture-decisions.md`
- `docs/wiki/engineering/local-development.md`
- `docs/wiki/engineering/release.md`
- `docs/wiki/engineering/troubleshooting.md`
- `docs/wiki/agent/working-rules.md`
- `docs/wiki/agent/prompt-recipes.md`
- `docs/wiki/agent/failure-patterns.md`
- `docs/wiki/features/F001-example-feature.md`

The dry-run preview also includes `.workflow/continuous-improvement/packets/README.md` as supporting workflow structure.

## Candidate Command To Confirm

Detected candidate:

```text
tests/: pytest -> python -m pytest
```

Confirmation needed:

- Is `python -m pytest` the correct default test command for sample?
- Should it be run from the repository root or a subdirectory?
- Does it require a virtual environment, environment variables, data files, or external services?
- Is there a lighter smoke command that should be used before the full test suite?

Until answered, this command remains a candidate only and should not be recorded as a confirmed project command.

## Unknowns To Resolve

1. No package, test, build, or verification command was detected from a confirmed entrypoint.
2. Tooling evidence exists through `pyproject.toml` and `requirements.txt`, but the exact verification command is unknown.
3. Python candidate verification commands require human confirmation before being treated as project commands.

## Human Approval Gates

### Gate A: Command Confirmation

Approve one of:

- Confirm `python -m pytest` as the default verification command.
- Replace it with a more accurate command.
- Leave verification command unknown for now.

### Gate B: Bootstrap Write Approval

Approve one of:

- Allow `node scripts/harness.js init --target "D:\code_space\trae-project\sample"` to create missing Harness files without overwriting existing files.
- Request a manual patch proposal for only selected files.
- Keep sample read-only and only maintain review artifacts in this repository.

### Gate C: Wiki Scope

Approve one of:

- Create required Harness files only.
- Create required files plus optional starter wiki pages.
- Defer wiki starter pages until after core Harness files are reviewed.

## Recommended Next Sequence

1. Human reviews this document and answers Gate A, Gate B, and Gate C.
2. If writes are approved, run `init` only after confirming the target path and expected file list.
3. Re-run `adoption report --output-dir docs/examples/adoptions` after any approved target change.
4. Rebuild the adoption index, status, gate, and bundle as new review artifacts.
5. Treat any command execution as a separate approval step after the command is confirmed.

## Commands That Remain Safe Without Target Writes

These commands inspect or summarize from the Harness side and do not modify sample:

```sh
node scripts/harness.js audit --target "D:\code_space\trae-project\sample" --summary
node scripts/harness.js init --target "D:\code_space\trae-project\sample" --dry-run
node scripts/harness.js adoption report --target "D:\code_space\trae-project\sample" --output-dir docs/examples/adoptions
node scripts/harness.js adoption gate --reports-dir docs/examples/adoptions
node scripts/harness.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md
```

Commands that write to sample or execute its tests require a fresh human approval.

