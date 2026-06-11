---
name: amber-wiki
description: Create or validate the repository-local Amber Protocol Wiki skeleton.
---

# Amber Wiki

Use when a user asks to create or validate the repository-local Amber Protocol setup Wiki.

## Workflow

1. Use the `templates/docs/wiki/` skeleton for new files.
2. Run `node scripts/validate-wiki.js --target <repo>`.
3. Fix missing links only with explicit user approval when files already exist.

## Boundary

The Wiki is stable context. It is not a dynamic workflow runner.
