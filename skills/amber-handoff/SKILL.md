---
name: amber-handoff
description: Prepare session continuity using Progress, feature state, and handoff files.
x-amber-json: {"command":"node scripts/amber.js handoff --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-handoff"}
---

# Amber Handoff

Use when a user asks to end a session or prepare continuity for another agent.

## Workflow

1. Read `PROGRESS.md`, `feature_list.json`, and `session-handoff.md`.
2. Confirm current feature status and evidence.
3. Ensure `session-handoff.md` includes summary, verification evidence, next action, and blockers.
4. Run `node scripts/amber.js doctor --target <repo>` when possible, and `node scripts/amber.js handoff --target <repo>` to validate the handoff file.

## Boundary

Handoff records state. It does not start new work or dispatch other agents.
