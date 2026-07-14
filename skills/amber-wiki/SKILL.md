---
name: amber-wiki
description: Create or validate the repository-local Amber Protocol Wiki skeleton. Also manages the declarative Knowledge Plan and structured knowledge base.
x-amber-json: {"command":"node scripts/amber.js wiki --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-wiki"}
---

# Amber Wiki

Use when a user asks to create or validate the repository-local Amber Protocol setup Wiki.

## Workflow

1. Use the `templates/docs/wiki/` skeleton for new files.
2. Run `node scripts/amber.js wiki --target <repo>`.
3. Fix missing links only with explicit user approval when files already exist.

## Knowledge Plan + Structured Knowledge Base

Amber provides a declarative Knowledge Plan capability (compatible with certain external yaml formats for plans).

- A `docs/wiki/knowledge-plan.json` (or .yaml) declares:
  - High-level understanding notes
  - Desired documents (title + goal + hints)
  - Knowledge cards (concise facts)
- Commands:
  - `amber wiki knowledge plan --target <repo>` — inspection + propose the plan.
  - `amber wiki knowledge scaffold --target <repo>` — create the plan file.
  - `amber wiki knowledge build --target <repo>` — materialize pages under docs/wiki/knowledge/.
  - `amber wiki knowledge report --target <repo>` — read-only coverage report.

## Boundary

The Wiki is stable context. It is not a dynamic workflow runner.
Knowledge plans drive analysis and proposals — they do not auto-write or execute.
