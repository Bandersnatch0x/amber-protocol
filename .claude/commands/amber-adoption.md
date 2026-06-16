---
description: Generate a read-only adoption report for an existing project.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

Run the Amber **amber-adoption** workflow for the target repository.
If no target is given, use the current repository root (`.`).

Execute: `node scripts/amber.js adoption report --target $1 --output-dir docs/examples/adoptions`

Report the command output faithfully; never overwrite user-authored files without approval.
