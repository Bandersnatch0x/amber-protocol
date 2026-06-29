---
name: amber-plan
description: Scaffold a new Amber plan file for a feature slice.
x-amber-json: {"command":"node scripts/amber.js plan --target {{target}} --feature {{feature}} --title {{title}}","args":[{"name":"target","hint":"repo path","default":"."},{"name":"feature","hint":"feature id"},{"name":"title","hint":"plan title"}],"manualName":"amber-plan"}
---

# Amber Plan

Use when a user asks to create a new plan for a feature slice.

## Workflow

1. Confirm the target repository, feature id, and plan title.
2. Run `node scripts/amber.js plan --target <repo> --feature <feature-id> --title "<title>"`.
3. Report the generated plan file path and a brief summary of its sections, including the Resume Checkpoint.
4. Optionally run `node scripts/amber.js gate --target <repo> --plan <plan-path>` to validate the plan.

## Resume Checkpoint

Generated plans include a Resume Checkpoint section so a future session can continue without reconstructing context. Keep these fields present and current:

- `Resume Point`
- `Blockers`
- `Next Action`
- `Recovery Instructions`

## Boundary

Plan scaffolding creates a new plan document. It does not execute the plan, dispatch agents, or modify existing approved documents.
