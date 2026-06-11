# Adoption Next Actions

Status: review only

Target: D:\code_space\trae-project\sample
Bundle: D:\code_space\coding-harness\docs\examples\sample-adoption-bundle
Latest report: D:\code_space\coding-harness\docs\examples\adoptions\sample-adoption-report-2026-06-09t01-36-11-331z.md
Gate decision: wait
Next safe action: Review adoption gate findings before initializing or changing the target project.

## Boundary

This document is a read-only planning artifact.

- Target project files copied: false
- Target project commands executed: false
- Dynamic Workflow executed: false
- Live subagents invoked: false

## Gate Findings

- missing-harness-files: 17 Harness files are still missing.
- candidate-commands-unconfirmed: 1 candidate command(s) require human confirmation.
- unknowns-present: 3 unknown(s) remain unresolved.

## Required Harness Files Pending Approval

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

## Candidate Command To Confirm

- tests/: pytest -> python -m pytest

Confirmation needed:

- Is this the correct default verification command?
- Should it run from the repository root or a subdirectory?
- Does it require a virtual environment, environment variables, data files, or external services?
- Is there a lighter smoke command that should run before the full suite?

## Unknowns To Resolve

- No package, test, build, or verification command detected.
- Tooling evidence found (pyproject.toml, requirements.txt), but the exact verification command is unknown.
- Python candidate verification commands require confirmation before being treated as project commands.

## Human Approval Gates

- command-confirmation: Confirm, replace, or reject the candidate verification command.
- bootstrap-write: Approve full init, selected manual patches, or keep the target read-only.
- wiki-scope: Choose required files only, required plus optional wiki starters, or defer wiki starters.

## Recommended Next Sequence

1. Human reviews this document and answers the approval gates.
2. If writes are approved, confirm the target path and exact file list before running init.
3. Re-run adoption report, index, status, gate, and bundle after any approved target change.
4. Treat target command execution as a separate approval step after the command is confirmed.

Commands that write to the target project or execute its tests remain outside this artifact.
