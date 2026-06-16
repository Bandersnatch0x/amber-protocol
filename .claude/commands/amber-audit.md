---
description: Inspect an existing repository for Harness readiness without modifying project files.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-audit** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js audit --target $1`

Report the command output faithfully. Do not overwrite user-authored files without approval.
