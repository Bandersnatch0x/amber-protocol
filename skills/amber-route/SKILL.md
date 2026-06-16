---
name: amber-route
description: List, inspect, validate, or dry-run Amber route definitions.
x-amber-json: {"command":"node scripts/amber.js route list","args":[],"manualName":"amber-route"}
---

# Amber Route

Use when a user asks about available Amber routes or wants to inspect, validate, or test a route definition.

## Workflow

1. Run `node scripts/amber.js route list` to show available routes.
2. Run `node scripts/amber.js route inspect <route-name>` to show a route definition.
3. Run `node scripts/amber.js route validate routes/<route-name>.route.json` to validate a route file.
4. Run `node scripts/amber.js route test <route-name> --dry-run` to simulate a route.
5. Report route metadata, stages, gates, and any validation errors.

## Boundary

Route commands are read-only or dry-run. They do not execute live workflows or modify repository state.
