---
name: amber-init
description: Install the V1 Amber Protocol scaffold in a repository without overwriting existing files.
x-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-init"}
---

# Amber Init

Use when a user asks to initialize or install the Amber Protocol in a repository.

## Workflow

1. Confirm the target repository path.
2. Run `node scripts/amber.js init --target <repo>`.
3. Report created and skipped files.
4. Do not overwrite existing files.
5. Do not merge old `AGENTS.md`, `CLAUDE.md`, or docs automatically.

## Boundary

This skill only installs the V1 Amber scaffold (safe-bootstrap team preset). It does not run Dynamic Workflows or dispatch subagents.
