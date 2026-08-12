---
description: Diagnose Amber readiness and adopt or repair governance without silently changing user files.
argument-hint: [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

User input: $ARGUMENTS

# Diagnosis And Adoption

1. Inspect repository instructions and classify the target before proposing writes.
2. Run `amber audit --target <repo>` first. Separate observed facts, unknowns, conflicts, and suggested additions.
3. Run `amber governance report` and `amber doctor` when Amber state exists. Errors outrank warnings; corrupt state fails closed.
4. For a new installation, preview with `amber init --dry-run`. Apply `init` only with approval; it skips existing files and must not merge or overwrite user-authored documents.
5. Create or validate the wiki only after scaffold ownership is clear. Treat generated pages and user pages differently.
6. Re-run audit, doctor, manifest validation, and wiki validation. Hand remediation work to `amber-delivery` when it becomes a code change.

Evidence order: target classification, read-only audit, readiness findings, proposed file set, approval, created/skipped files, post-change doctor and validation.

On failure, leave existing files untouched, report the exact conflict and recovery command, and retain any dry-run report. Deprecated `adoption` commands remain available through `amber --all`, but prefer audit/governance for new work.

Preserve the same approval, isolation, and ledger boundaries when diagnosis becomes a delivery change. This journey never treats a diagnostic result as write authority.
