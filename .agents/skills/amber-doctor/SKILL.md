---
name: amber-doctor
description: Validate that a repository-local Amber Protocol is usable and internally consistent.
x-amber-json: {"command":"node scripts/amber.js doctor --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-doctor"}
---

# Amber Doctor

Use when a user asks whether a repository Amber Protocol setup is usable.

## Workflow

1. Run `node scripts/amber.js doctor --target <repo>`.
2. Summarize errors before warnings.
3. Treat missing evidence, multiple active features, missing next action, and broken Wiki links as blockers.

## Boundary

Doctor validates the Amber Setup itself. It does not promise full CI or end-to-end validation for the target repository.
