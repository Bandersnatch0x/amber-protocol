---
name: amber-adoption
description: Generate a read-only adoption report for an existing project.
x-amber-json: {"command":"node scripts/amber.js adoption report --target {{target}} --output-dir docs/examples/adoptions","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-adoption"}
---

# Amber Adoption

Use when a user wants to assess how ready an existing repository is for the Amber Protocol.

> Command prefix: in an Amber checkout run `node scripts/amber.js`; when Amber is installed as a package (npm, pi, Claude Code) run `npx -p amber-protocol amber`.

## Workflow

1. Confirm the target repository path.
2. Run `amber adoption report --target <repo> --output-dir docs/examples/adoptions`.
3. Summarize the report: existing files, missing files, conflicts, and recommended next actions.
4. Optionally run follow-up adoption commands such as `list`, `index`, `validate`, `compare`, `gate`, `status`, `bundle`, or `next-actions`.

## Boundary

Adoption reports are read-only by default. They do not install files or rewrite existing project documents without explicit approval.
