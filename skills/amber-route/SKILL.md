---
name: amber-route
description: List, inspect, validate, or dry-run Amber route definitions.
x-amber-json: {"command":"node scripts/amber.js route list","args":[],"manualName":"amber-route"}
---

# Amber Route

Use when a user asks about available Amber routes or wants to inspect, validate, or test a route definition.

> Command prefix: in an Amber checkout run `node scripts/amber.js`; when Amber is installed as a package (npm, pi, Claude Code) run `npx -p amber-protocol amber`.

## Workflow

1. Run `amber route list` to show available routes.
2. Run `amber route inspect <route-name>` to show a route definition.
3. Run `amber route validate routes/<route-name>.route.json` to validate a route file.
4. Run `amber route test <route-name> --dry-run` to simulate a route.
5. Report route metadata, stages, gates, and any validation errors.

## Boundary

Route commands are read-only or dry-run. They do not execute live workflows or modify repository state.
