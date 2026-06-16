---
description: Prepare session continuity using Progress, feature state, and handoff files.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-handoff** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js handoff --target $1`

Report the command output faithfully. Do not overwrite user-authored files without approval.
