---
id: index
title: "Troubleshooting Hub: Error → Fix"
sidebar_label: "Troubleshooting Hub"
description: "Single authoritative resolution matrix for common Amber Protocol setup and session errors."
slug: /troubleshooting
---

# Troubleshooting Hub: Error → Fix

This page is the single authoritative entry point for diagnosing and resolving errors encountered when running Amber Protocol commands.

---

## Resolution Matrix

| Error Message / Symptom | Root Cause | Exact Resolution |
| --- | --- | --- |
| `Target repository not found` | The path passed to `--target <path>` does not exist or cannot be accessed. | Pass an existing directory path: `amber doctor --target .` or verify file system permissions. |
| `Amber setup incomplete or missing` | `.amber/` directory has not been initialized. | Run `amber init --target .` to scaffold missing starter files. |
| `Doctor failed with N errors` | Required governance rules in `.amber/governance/rules.json` failed. | Run `amber doctor --target . --json` to inspect detailed failure reasons per rule. |
| `Active session already exists` | A previous session was started without being completed or aborted. | Run `amber session status` to check active ID, then either `amber session continue` or `amber session abort <id>`. |
| `complete-check failed: missing evidence` | Route stages or checkpoints lack recorded verification receipts. | Run `amber session verify --session <id> --command "<cmd>" --result "<claim>"` before completing. |
| `complete-check failed: gate unapproved` | Route requires a gate confirmation before settling. | Run `amber session approve --session <id> --gate <gate-id>` to record gate passage. |
| `Drift detected in CI` | Artifacts, schemas, or wiki files differ from declared baseline. | Run `amber drift --target .` locally to inspect the diff and update or regenerate artifacts. |
| `Generated CLI reference is stale` | `scripts/lib/command-registry.js` was modified without updating docs. | Run `npm run docs:gen` to regenerate CLI reference documentation. |
| `Node version incompatible` | Current Node version does not satisfy `^20.19.0 \|\| ^22.12.0 \|\| >=23`. | Upgrade Node.js to Node 20.x (`>=20.19.0`) or Node 22.x (`>=22.12.0`). |
| `Handoff validation failed: missing sections` | `session-handoff.md` was edited manually or truncated. | Run `amber handoff --target .` to regenerate valid handoff sections from session history. |

---

## Recovery Workflow

If you ever encounter an unrecoverable local session lock or corrupt temporary state:

1. Inspect active session state:
   ```bash
   amber session list
   ```
2. Abort stuck sessions safely:
   ```bash
   amber session abort <session-id>
   ```
3. Re-verify repository health:
   ```bash
   amber doctor --target .
   ```
