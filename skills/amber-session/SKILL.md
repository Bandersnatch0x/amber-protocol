---
name: amber-session
description: Start, inspect, list, abort, or continue an Amber session.
x-amber-json: {"command":"node scripts/amber.js session status","args":[],"manualName":"amber-session"}
---

# Amber Session

Use when a user asks about Amber sessions or wants to start, list, abort, or continue a session.

## Workflow

1. Run `node scripts/amber.js session status` to inspect the current session.
2. Run `node scripts/amber.js session list` to list all sessions.
3. Run `node scripts/amber.js session start --goal "<goal>"` to create a new session.
4. Run `node scripts/amber.js session abort <session-id>` to abort a session.
5. Run `node scripts/amber.js session continue` to resume from the latest checkpoint.
6. Report session id, goal, status, and any blockers.

## Boundary

Session commands manage session lifecycle state only. They do not dispatch live agents or run target-project commands automatically.
