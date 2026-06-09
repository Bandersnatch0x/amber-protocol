---
name: harness-audit
description: Inspect an existing repository for Harness readiness without modifying project files.
---

# Harness Audit

Use when a user asks to inspect an existing repository before installing the Harness.

## Workflow

1. Run `node scripts/audit-project.js --target <repo>`.
2. Report missing Harness files, existing agent docs, detected commands, and conflicts.
3. Keep the target repository read-only.
4. Suggest additions without applying patches.

## Boundary

V1 audit never rewrites existing project documents.
