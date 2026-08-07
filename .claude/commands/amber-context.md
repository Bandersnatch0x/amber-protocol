---
description: Run the Amber Protocol Context layer (ADR-0009) — emit distillation contracts, execute them with your own model, and gate the result at ingest. Closes the write path so session evidence becomes provenance-backed knowledge pages instead of sinking.
argument-hint: [action] [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-context** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js context $1 --target $2`

Report the command output faithfully; never overwrite user-authored files without approval.
