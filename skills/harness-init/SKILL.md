---
name: harness-init
description: Install the V1 Coding Harness scaffold in a repository without overwriting existing files.
---

# Harness Init

Use when a user asks to initialize or install the Coding Harness in a repository.

## Workflow

1. Confirm the target repository path.
2. Run `node scripts/scaffold-harness.js --target <repo>`.
3. Report created and skipped files.
4. Do not overwrite existing files.
5. Do not merge old `AGENTS.md`, `CLAUDE.md`, or docs automatically.

## Boundary

This skill only installs the V1 Safe Harness Bootstrap. It does not run dynamic workflows or dispatch subagents.
