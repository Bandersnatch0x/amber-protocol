# Adoption Decision Record

Status: pending

Target: D:\code_space\trae-project\sample
Bundle: D:\code_space\coding-harness\docs\examples\sample-adoption-bundle
Latest report: D:\code_space\coding-harness\docs\examples\adoptions\sample-adoption-report-2026-06-09t01-36-11-331z.md
Gate decision: wait
Next safe action: Review adoption gate findings before initializing or changing the target project.

## Boundary

- Target project files copied: false
- Target project commands executed: false
- Dynamic Workflow executed: false
- Live subagents invoked: false

## Gate Findings

- missing-harness-files: 17 Harness files are still missing.
- candidate-commands-unconfirmed: 1 candidate command(s) require human confirmation.
- unknowns-present: 3 unknown(s) remain unresolved.

## Decisions

### Gate A: Command Confirmation

Status: pending

Decision: Confirm, replace, or reject candidate verification commands.

Evidence:

- Bundle: D:\code_space\coding-harness\docs\examples\sample-adoption-bundle
- Gate decision: wait

### Gate B: Bootstrap Write

Status: pending

Decision: Approve full init, selected manual patches, or keep the target read-only.

Evidence:

- Bundle: D:\code_space\coding-harness\docs\examples\sample-adoption-bundle
- Gate decision: wait

### Gate C: Wiki Scope

Status: pending

Decision: Choose required files only, required plus optional wiki starters, or defer wiki starters.

Evidence:

- Bundle: D:\code_space\coding-harness\docs\examples\sample-adoption-bundle
- Gate decision: wait

## Required User Action

- Fill in Gate A, Gate B, and Gate C before any target write or target command execution.
- Keep this record pending if the target project should remain read-only.

This record does not approve target writes or command execution by itself.
