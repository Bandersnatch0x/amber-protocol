---
name: amber-audit
description: Inspect an existing repository for Harness readiness without modifying project files.
x-amber-json: {"command":"node scripts/amber.js audit --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-audit"}
---

# Amber Audit

Use when a user asks to inspect an existing repository before installing the Amber Protocol setup.

## Workflow

1. Run `node scripts/amber.js audit --target <repo>`.
2. Report missing Harness files, existing agent docs, detected commands, and conflicts.
3. Keep the target repository read-only.
4. Suggest additions without applying patches.

## Boundary

V1 audit never rewrites existing project documents.
