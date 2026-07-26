---
name: amber-init
description: Install the V1 Amber Protocol scaffold in a repository without overwriting existing files.
x-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-init"}
---

# Amber Init

Use when a user asks to initialize or install the Amber Protocol in a repository.

> Command prefix: in an Amber checkout run `node scripts/amber.js`; when Amber is installed as a package (npm, pi, Claude Code) run `npx -p amber-protocol amber`.

## Workflow

1. Confirm the target repository path.
2. Run `amber init --target <repo>`.
3. Report created and skipped files.
4. Do not overwrite existing files.
5. Do not merge old `AGENTS.md`, `CLAUDE.md`, or docs automatically.

## Boundary

This skill only installs the V1 Amber scaffold (safe-bootstrap team preset). It does not run Dynamic Workflows or dispatch subagents.
