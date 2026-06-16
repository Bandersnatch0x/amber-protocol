---
name: amber-wiki
description: Create or validate the repository-local Amber Protocol Wiki skeleton.
x-amber-json: {"command":"node scripts/amber.js wiki --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-wiki"}
---

# Amber Wiki

Use when a user asks to create or validate the repository-local Amber Protocol setup Wiki.

## Workflow

1. Use the `templates/docs/wiki/` skeleton for new files.
2. Run `node scripts/amber.js wiki --target <repo>`.
3. Fix missing links only with explicit user approval when files already exist.

## Boundary

The Wiki is stable context. It is not a dynamic workflow runner.
