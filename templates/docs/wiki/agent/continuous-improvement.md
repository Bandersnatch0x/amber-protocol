# Continuous Improvement

Use this loop for recurring health passes, automation wakeups, goal-mode continuation, or "keep improving this project" requests.

This is a controlled operating mode, not dynamic workflow execution. It selects one safe slice, records evidence, and stops at approval gates.

## Required Inputs

- `AGENTS.md`
- `CLAUDE.md`
- `PROGRESS.md`
- `session-handoff.md`
- `feature_list.json`
- `.workflow/continuous-improvement/state.json`
- `docs/wiki/index.md`
- Current repo state such as `git status --short`

## Operating Loop

1. Restore context from rules, progress, handoff, feature state, and workflow state.
2. Inspect evidence: dirty files, failing checks, docs, known plans, and blockers.
3. Pick one task using this priority:
   - Failing verification or broken developer workflow.
   - Security, data-loss, or approval-gate clarity.
   - Small correctness or test coverage gaps.
   - Documentation that prevents future agent drift.
   - Low-risk cleanup that reduces repeated friction.
4. Write a small contract before editing:
   - Objective.
   - Files in scope.
   - Files out of scope.
   - Expected behavior or artifact.
   - Verification command or evidence.
5. Execute one coherent slice.
6. Run a separate review pass.
7. Verify with commands or file evidence matched to the slice.
8. Update `PROGRESS.md`, `session-handoff.md`, and `.workflow/continuous-improvement/state.json` when state changes.
9. Stop for completion evidence, a true blocker, or an approval gate.

## Safe Defaults

- Prefer small patches over broad rewrites.
- Improve files already relevant to the selected task.
- Treat generated output, logs, dependency folders, and unknown dirty files as out of scope.
- Do not invent a narrower goal to make completion easier.
- Keep final reports short and evidence-led.

## Approval Gates

Pause and ask before deletion, destructive git operations, dependency changes, migrations, deploys, external writes, secrets, broad codemods, product-flow changes, security-boundary changes, or other irreversible work.

## Result Note

```text
Date:
Task:
Workflow:
Changed files:
Evidence:
Review findings:
Skipped checks:
Next candidate:
```
