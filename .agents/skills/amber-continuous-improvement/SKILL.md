---
name: amber-continuous-improvement
description: Use when continuing a repository improvement goal, running an automation wakeup, or selecting the next safe Amber-backed improvement slice.
---

# Amber Continuous Improvement

## Workflow

1. Read `AGENTS.md`, `CLAUDE.md`, `PROGRESS.md`, `session-handoff.md`, `feature_list.json`, `docs/wiki/index.md`, and `.workflow/continuous-improvement/state.json`.
2. Inspect repo state and treat pre-existing dirty files as user-owned.
3. Select one coherent, high-value, low-risk slice.
4. Before editing, write a contract:
   - Objective.
   - Files in scope.
   - Files out of scope.
   - Expected result.
   - Verification evidence.
   - Approval gates.
5. Use `docs/wiki/agent/workflow-packets.md` for ambiguous or multi-track work.
6. Implement only the contracted slice.
7. Run a separate review pass.
8. Verify with the narrowest reliable command or file evidence.
9. Update progress, handoff, feature evidence, and continuous-improvement state when project state changes.

## Safe Defaults

- Prefer small patches over broad rewrites.
- Do not overwrite user-authored files without explicit approval.
- Do not delete, deploy, publish, change secrets, change dependencies, create migrations, or perform destructive git operations without approval.
- Do not execute Dynamic Workflows, dispatch subagents, orchestrate worktrees, or route models from the V1 Amber Protocol boundary.

## Result Note Template

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

## Loop Triage Compatible Output (when used inside a daily-triage loop)

When invoked as part of a loop (e.g. via `/loop` or `amber loop run`), prefer producing output in this structure so it can be directly merged into a `STATE.md` or loop ledger:

### High-Priority Items

- ...

### Watch Items

- ...

### Noise / Ignore

- ...

### State Updates

- Last run: <timestamp>
- Amber health score / doctor summary
- Candidate next actions (with links to commands)

This aligns Amber continuous improvement with loop-engineering `loop-triage` skill conventions while respecting Amber's governance and dry-run boundaries.
