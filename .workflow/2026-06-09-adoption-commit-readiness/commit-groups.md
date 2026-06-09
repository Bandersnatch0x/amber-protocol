# Adoption Commit Groups

Status: proposed

## Group 1: Adoption CLI Chain

Suggested commit message:

```text
Add V1-safe adoption review commands
```

Files:

- `README.md`
- `docs/examples/README.md`
- `scripts/harness.js`
- `scripts/lib/harness-core.js`
- `tests/harness-cli.test.js`
- `tests/phase-v5-5.test.js`

Review focus:

- Adoption commands remain review-only unless an explicit output path is requested.
- `apply-plan` remains dry-run only in V1.
- `selected-files` rejects unknown and unsafe `--include` paths.
- Tests cover overwrite refusal and machine-readable JSON errors.

## Group 2: StockAgents Review Examples

Suggested commit message:

```text
Add StockAgents adoption review artifacts
```

Files:

- `docs/examples/stockagents-adoption-apply-plan.md`
- `docs/examples/stockagents-adoption-decision-record-decisions.md`
- `docs/examples/stockagents-adoption-decision-record.md`
- `docs/examples/stockagents-adoption-next-actions-cli.md`
- `docs/examples/stockagents-adoption-selected-files.md`

Review focus:

- Artifacts live under `docs/examples/`.
- Artifacts document review state only.
- Artifacts do not imply StockAgents was initialized, modified, or tested.

## Group 3: Prior Workflow Evidence

Suggested commit message:

```text
Record adoption workflow evidence
```

Files:

- `.workflow/2026-06-09-adoption-apply-plan-dry-run/`
- `.workflow/2026-06-09-adoption-decision-record-command/`
- `.workflow/2026-06-09-adoption-decision-record-decisions/`
- `.workflow/2026-06-09-adoption-integration-readiness-review/`
- `.workflow/2026-06-09-adoption-next-actions-command/`
- `.workflow/2026-06-09-adoption-selected-files-proposal/`

Review focus:

- Workflow artifacts are evidence, not executable Dynamic Workflow support.
- Each workflow records simulated packet results, spec review, quality review, and verification.
- No workflow records live subagent invocation.

## Group 4: Commit Readiness Evidence

Suggested commit message:

```text
Record adoption commit readiness review
```

Files:

- `.workflow/2026-06-09-adoption-commit-readiness/`

Review focus:

- This workflow records grouping and verification only.
- It did not stage or commit files.
- Include this group only if workflow run evidence belongs in repository history.

## Do Not Include

None currently identified.

## Hard Boundary

- Do not include any files from `D:\code_space\trae-project\StockAgents`.
- Do not stage or commit from this workflow without an explicit follow-up request.

