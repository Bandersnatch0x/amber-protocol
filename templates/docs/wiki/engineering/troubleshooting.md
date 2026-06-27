---
type: runbook
title: Troubleshooting
description: Common problems and how to resolve them.
tags: [engineering]
updated: 2026-06-28
---

# Troubleshooting

## Known Issues

| Symptom | Likely Cause | Next Step |
| --- | --- | --- |
| Verification fails | Baseline changed | Record the error and fix baseline before new work |

## Amber Error Codes

> Snapshot of the Amber error catalog. Run `amber explain <code>` for the full cause + fix of a
> single code, or `amber explain --markdown docs/ERROR_CODES.md` to write a standalone reference.

| Code | Layer | Symptom | Fix |
| --- | --- | --- | --- |
| `AMBER_E_FEATURE_NOT_FOUND` | Context | Feature not registered in feature_list.json | `amber feature add --id <ID> --title "..."` |
| `AMBER_E_FEATURE_NO_EVIDENCE` | Verification | Feature claims completion without evidence | `amber feature verify --feature <ID> --command "<cmd>" --result <pass\|fail>` |
| `AMBER_E_GATE_UNCONFIRMED` | Governance | Plan gate not confirmed | `amber gate --confirm --target . --plan <path>` |
| `AMBER_E_HOOK_PRECOMMIT_BLOCKED` | Governance | Commit blocked by Amber governance guard | `Resolve the listed codes, or bypass once with: AMBER_SKIP_HOOKS=1 git commit ...` |
| `AMBER_E_MISSING_PATH_ARG` | Tooling | Required path argument missing | `Re-run with the documented --flag <path> (see amber <command> --help).` |
| `AMBER_E_PLAN_NOT_FOUND` | Context | Plan file not found | `amber plan --target . --feature <ID> --title "..."` |
| `AMBER_E_ROUTE_NOT_FOUND` | Lifecycle | No route matched the session goal | `amber route list   # then: amber session start --goal <g> --route <name>` |
| `AMBER_E_SESSION_INCOMPLETE` | Verification | Session completion check failed | `amber session verify --session <id> ...   then   amber session approve --session <id>` |

## Unknowns / Needs Confirmation

- Confirm recurring failures, known local setup issues, and recovery steps for this repository.
</content>
