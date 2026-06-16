---
description: Install the V1 Amber Protocol scaffold in a repository without overwriting existing files.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-init** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js init --target $1`

Report the command output faithfully. Do not overwrite user-authored files without approval.
