---
kind: "knowledge"
category: "cli-architecture-command-dispatch"
title: "CLI Architecture & Command Dispatch"
template: "architecture"
updated_at: "2026-07-14T07:07:21.794Z"
---

# CLI Architecture & Command Dispatch

Last Reviewed: 2026-07-16

Amber exposes one CommonJS CLI entry point and keeps command parsing, command routing,
and domain work in separate layers. The entry point validates the top-level command,
parses flags once, delegates to a registered handler, and owns result printing and the
process exit code. Handler modules translate CLI options into calls to reusable core
functions; durable behavior and artifact generation live under `scripts/lib/core/`.

## Key Files

- `scripts/amber.js` defines the supported top-level commands, parses arguments, calls
  `dispatch()`, prints text or JSON results, and returns non-zero when `result.errors`
  is non-empty.
- `scripts/lib/command-dispatcher.js` owns the central `HANDLERS` registry, thin
  wrappers for command families, and deprecation warnings.
- `scripts/lib/command-handler-families.js` contains the maintenance, adoption,
  ledger, session, and governance family adapters. For example, governance arguments
  are normalized before they reach `governanceDispatch()`.
- `scripts/lib/*-commands.js` modules own command-specific option handling, target
  guards, and presentation-oriented result shaping.
- `scripts/lib/core/` contains reusable inspections, validators, report builders,
  lifecycle logic, governed execution, and artifact writers.
- `scripts/lib/core/cli-output.js` provides the shared argument and output boundaries
  used by the entry point.

## Dispatch Flow

1. `run()` handles help and version requests, rejects unknown top-level commands, and
   parses the remaining arguments.
2. `dispatch(command, args)` looks up the command in `HANDLERS`; an unregistered
   command produces a structured error and exit code 1.
3. The selected wrapper delegates either to a command-family dispatcher or directly
   to a focused command module.
4. Command modules call core functions and return a result with `errors` and
   `warnings`. Async handlers are supported because `run()` awaits the dispatch result.
5. `scripts/amber.js` is the single output boundary unless a handler explicitly uses
   the `bypassPrint` contract for streaming or custom output.

```mermaid
flowchart LR
    Shell["node scripts/amber.js"] --> Entry["parse args and validate command"]
    Entry --> Registry["command-dispatcher HANDLERS"]
    Registry --> Family["family or *-commands adapter"]
    Family --> Core["scripts/lib/core domain logic"]
    Core --> Artifacts["repository artifacts and structured result"]
    Artifacts --> Output["text or JSON output and exit code"]
```

## Development Rules

- Add a top-level command to the supported command list and `HANDLERS` registry; do
  not add a second CLI entry point.
- Keep wrappers focused on CLI concerns. Put reusable inspection, validation, state
  transition, and rendering logic in an appropriate core module.
- Preserve the structured result contract. Expected failures belong in `errors` or
  `warnings`, not in ad hoc process exits inside core functions.
- Route mutating commands through the existing policy, approval, isolation, and
  evidence controls. A new handler must not become an execution bypass.
- Keep read-only and dry-run behavior as the default, and retain idempotent,
  non-overwriting behavior for scaffold commands such as `init` and `wiki`.
- The root CLI package intentionally depends only on `ajv` and `ajv-formats`; Web
  dependencies remain isolated in `apps/web/package.json`.
