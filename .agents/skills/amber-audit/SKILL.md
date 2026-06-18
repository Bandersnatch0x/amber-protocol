---
name: amber-audit
description: Inspect an existing repository for Amber Setup readiness without modifying project files.
x-amber-json: {"command":"node scripts/amber.js audit --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-audit"}
---

# Amber Audit

Use when a user asks to inspect an existing repository before installing the Amber Protocol setup.

## Workflow

1. Run `node scripts/amber.js audit --target <repo>`.
2. Report missing Amber starter files, existing agent docs, detected commands, and conflicts. For the Amber Protocol product repository, missing starter files at repo root are expected; scaffolds live under `templates/`.
3. Keep the target repository read-only.
4. Suggest additions without applying patches.

## Boundary

V1 audit never rewrites existing project documents.
