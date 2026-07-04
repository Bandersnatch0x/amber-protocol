# ADR-0005: Experimental Execution Removal — Supersedes ADR-0002 Preservation

**Status:** Accepted
**Date:** 2026-07-04
**Supersedes:** The "Preserve exploration" rationale in [ADR-0002](0002-v2-execution-scope.md) (Decision, point 1) and its cold-storage implementation. ADR-0002's boundary *intent* (no execution in V1 production paths) is upheld and strengthened.
**Context:** Architecture review (#4) + hands-on verification of `master @ v1.2.0`

---

## Context

ADR-0002 (2026-06-21) isolated `execution-engine`, `stage-executor`, and `autonomous-executor` into `src/experimental/execution/` rather than deleting them, citing *"Preserve exploration — code represents real engineering effort; isolation allows V2 reconsideration."*

Six weeks later, a 2026-07-04 review verified the preservation had failed in practice:

1. **Broken import chains (5+).** `execution-engine.js` requires `./checkpoint-manager` (never existed) and `./budget-tracker` (not present in the directory). `stage-executor.js` requires `./checkpoint-manager`. The canonical entry throws `MODULE_NOT_FOUND` on the first `require`.
2. **The repo's own entry is red.** `npm run test:experimental` (shipped in `package.json`) fails 3/5.
3. **Dead tree shipped to every installer.** `files: ["src/"]` publishes the unreachable specimen to all consumers.
4. **Peripheral modules orphaned.** Five modules left behind in `scripts/lib/` (`daemon`, `notifier`, `health-checker`, `budget-tracker`, `error-recovery`) had zero production references — kept alive only by their own unit tests. The hidden `amber daemon` command had no help, no docs, and no live start path.

## Decision

**Delete the experimental execution scope and the orphaned peripherals. Do not repair.**

### Rationale

- **Repairing is worse than the break.** Fixing the chains means copying *live* production modules (a working `checkpoint-manager`, `budget-tracker`) into the specimen — creating dual copies that drift apart. A broken chain is honest about being dead; a "repaired" specimen is a silently-divergent second source.
- **Preservation had its chance.** The "V2 reconsideration" window produced rot, not reconsideration. Six weeks of zero active references is the empirical signal that this code has no customers.
- **Archival is non-destructive.** `git tag v1.2.0` is the removal checkpoint. Any deleted module is recoverable verbatim via `git show v1.2.0:<path>`.

## Implementation (1.3.0)

- Deleted `src/experimental/` (entire tree) and `tests/experimental/`.
- Deleted 5 peripheral modules from `scripts/lib/` + their unit tests + `tests/e2e/daemon-lifecycle.test.js`.
- Removed the `daemon` command from the CLI surface and dispatcher.
- Removed the `test:experimental` npm script; dropped `experimental` from the test-runner ignore set.
- Updated the `--mode autonomous` refusal message (behavior unchanged: still refused) to cite ADR-0001/0005 instead of the deleted README.
- See issue #4 and `docs/superpowers/plans/2026-07-04-amber-dead-code-and-facade-removal.md`.

## Consequences

### Positive
- ✅ The published package no longer carries unreachable, un-loadable dead code.
- ✅ Every file in `scripts/lib/` has an active caller; `grep` once again equals the dependency graph.
- ✅ "Governance, not execution" (ADR-0001) now holds at the file-tree and package level, not just the CLI level.

### Negative
- ⚠️ `amber daemon` command removed (semver **minor**, recorded under 1.3.0 Removed).
- ⚠️ Any consumer depending on `src/experimental/execution/*` (undocumented and broken) must vendor from `git show v1.2.0:...`.

### Neutral
- Session CRUD, route inspection, adoption/doctor/audit workflows unaffected.

## V2 Considerations (migrated from ADR-0002)

ADR-0002's V2 criteria — that any reintroduced execution must be **governed, inspectable, explicit, constrained, documented** — are retained and now *exemplified*. [ADR-0003](0003-governance-gated-execution.md) is the realized form: governance-gated, human-triggered execution of declared commands behind policy + approval + worktree + ledger. The deleted autonomous executor was not that, and pretending otherwise (by keeping it cold-stored) muddied the boundary.

## Related

- [ADR-0001](0001-governance-first-artifact-first.md) — governance-first, artifact-first
- [ADR-0002](0002-v2-execution-scope.md) — the superseded isolation decision
- [ADR-0003](0003-governance-gated-execution.md) — the realized V2 execution model

---

**Approved by:** Project lead
**Implementation:** 2026-07-04 (1.3.0)
