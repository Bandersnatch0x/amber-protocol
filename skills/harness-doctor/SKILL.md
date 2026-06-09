---
name: harness-doctor
description: Validate that a repository-local Coding Harness is usable and internally consistent.
---

# Harness Doctor

Use when a user asks whether a repository Harness is usable.

## Workflow

1. Run `node scripts/doctor.js --target <repo>`.
2. Summarize errors before warnings.
3. Treat missing evidence, multiple active features, missing next action, and broken Wiki links as blockers.

## Boundary

Doctor validates the Harness itself. It does not promise full CI or end-to-end validation for the target project.
