---
description: Validate that a repository-local Amber Protocol is usable and internally consistent.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-doctor** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js doctor --target $1`

Report the command output faithfully. Do not overwrite user-authored files without approval.
