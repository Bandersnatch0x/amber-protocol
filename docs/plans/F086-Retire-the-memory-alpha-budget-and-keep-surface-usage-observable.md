# Plan: Retire the memory alpha budget and keep surface usage observable

Feature: F086
Status: implementation-ready
User Confirmation: confirmed

## Goal

`amber memory status` reports physical `MEMORY.md` usage as entries and bytes with no ceiling or
utilisation percentage. `ingest` no longer refuses an entry because the surface is large.
Supersession keeps working as ordinary knowledge replacement rather than an exhaustion duty. And
`amber doctor` checks the memory layer for product repositories instead of returning before it.

## Decision

This plan is the #173-level record that spec §6.3 requires before the budget may change. It
replaces §6.3 (alpha budget) and §6.4 (beta one-in-one-out) and amends ADR-0018 D3.

Verdict: remove the hard budget, keep usage observable.

The removal rests on five defects measured on the shipped code, not on preference:

1. The admission projection is not a measurement. `bookText` renders the claim's first line plus a
   provenance stub, so a 20,009-byte claim projected as 50 bytes.
2. The beta credit is bookkeeping, not space. `alphaBudgetRefusal` subtracts registry entries
   without checking that the replaced entry is bound to the Markdown region it claims to free.
3. Admission does not reserve pending proposals and `book` does not re-check, so two batches can
   pass against one unchanged surface.
4. The spec contradicts itself at exhaustion: §6.3 refuses new admission, §6.4 requires that the
   same state admit a one-in-one-out pair.
5. The documented remedy ("split into several entries") cannot reduce content bytes.

A hard cap that misses all five is a false guarantee. Retaining the cap would keep the appearance
of a bound without the substance.

This plan accepts the loss of a total cap as a deliberate cost. Growth becomes a curation duty
under the `MEMORY.md` creed, and gamma keeps constraining intake rate to five entries per 168
hours. Gamma is not a substitute for a total cap, and the retirement record says so.

## High Level Design

- Context: the budget lives in `scripts/lib/core/memory-policy.js` (constants, `alphaState`,
  `bookText`), is enforced at ingest stage 4 in `scripts/lib/memory-commands.js`, and is projected
  into `amber memory status`. Doctor rule 6 warns at 50% utilisation. Beta's obligation is defined
  only in the exhausted state, so it cannot outlive alpha. Independent supersession is a separate
  capability that `approve` already runs without consulting alpha.
- Proposed approach: delete the constants, `alphaState`, `bookText` and `alphaBudgetRefusal`; drop
  the ingest stage; replace the status `alpha` object with a `surface` observation of physical
  entries and normalized bytes; retire the doctor rules and the live error code; move the
  memory-layer checks onto a path product repositories also reach. Supersession, the
  `supersedeTarget` pointer, the `superseded` state and the atomic approval pair stay.
- Risks: the status JSON loses `alpha`, which is a public contract change and must ship with release
  notes. Nothing in the repository schedules on `utilizationPct`, but external callers may read it.
  Product repositories begin seeing real memory findings, and a drifted active entry moves to
  `needs-re-review` on the first run, so the first rollout can turn a green doctor red.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/agents/dev-workflow.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md
- review: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [x] Slice 1: remove `ALPHA_MAX_ENTRIES`, `ALPHA_MAX_BYTES`, `alphaState` and `bookText` from the policy module.
  - paths: scripts/lib/core/memory-policy.js, tests/unit/memory-dispatch.test.js
  - depends-on: none
  - verify: node --test tests/unit/memory-dispatch.test.js

- [x] Slice 2: drop ingest stage 4 and `alphaBudgetRefusal` from the command layer, and project `surface: {entries, bytes}` instead of `alpha`.
  - paths: scripts/lib/memory-commands.js, tests/integration/memory-commands.test.js
  - depends-on: 1
  - verify: node --test tests/integration/memory-commands.test.js

- [x] Slice 3: retire the live budget error code and its rate-limit edge, and restate the status action goal as entries, gamma and surface.
  - paths: scripts/lib/core/error-catalog.js, action-types/memory-status.json
  - depends-on: 2
  - verify: node --test tests/unit/error-catalog.test.js

- [x] Slice 4: update the registry help text for `memory status` so it names the three observed sections and no budget.
  - paths: scripts/lib/command-registry.js
  - depends-on: 3
  - verify: node --test tests/unit/command-registry-parity.test.js

- [x] Slice 5: retire doctor rules 5 and 6, and run the memory-layer checks on a path product repositories reach.
  - paths: scripts/lib/core/doctor.js, tests/unit/doctor-remedy.test.js
  - depends-on: 4
  - verify: node --test tests/unit/doctor-remedy.test.js

- [x] Slice 6: update the MCP status assertion and the phase test so product-repo doctor and the new envelope are pinned.
  - paths: tests/integration/amber-mcp.test.js, tests/phase-v1-5.test.js
  - depends-on: 5
  - verify: node --test tests/integration/amber-mcp.test.js tests/phase-v1-5.test.js

- [x] Slice 7: replace spec §6.3 and §6.4 with the retirement record, amend ADR-0018 D3, and update the CLI reference.
  - paths: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/CLI_REFERENCE.md
  - depends-on: 6
  - verify: node scripts/verify-public-docs.js

- [x] Slice 8: restate the usage contract in the MEMORY.md template and the root memory file.
  - paths: MEMORY.md, templates/MEMORY.md
  - depends-on: 7
  - verify: node scripts/amber.js memory status --target . --json

- [x] Slice 9: regenerate the public CLI reference and the knowledge corpus from the amended sources.
  - paths: apps/docs/docs/reference/cli/memory.md, apps/docs/docs-manifest.json, docs/knowledge-corpus/knowledge-base.output.json, docs/knowledge-corpus/knowledge-context-manifest.json
  - depends-on: 8
  - verify: npm run docs:gen:check

- [x] Slice 10: record the breaking change in the changelog and close this plan's evidence.
  - paths: CHANGELOG.md, docs/plans/F086-Retire-the-memory-alpha-budget-and-keep-surface-usage-observable.md
  - depends-on: 9
  - verify: amber gate --target . --plan docs/plans/F086-Retire-the-memory-alpha-budget-and-keep-surface-usage-observable.md

- [x] Slice 11: run the whole suite, the public documentation seam and doctor, then mark the feature passing.
  - paths: feature_list.json
  - depends-on: 10
  - verify: npm test

## Resume Checkpoint

- Resume Point: slices 1-10 are implemented. The independent decision record is `.scratch/alpha-budget-decision/DECISION.md`. `npm test` on the whole tree is the remaining step.
- Blockers: none.
- Next Action: run slice 11 (`npm test`), record the result, and mark F086 passing.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice. Do not re-derive the verdict; it is settled in the Decision section. Do not regenerate the plan unless the file is missing.

## Acceptance Criteria

- `amber memory status --json` exposes `entries`, `gamma` and `surface: {entries, bytes}` and no `alpha` object, `maxBytes`, `maxEntries` or `utilizationPct`.
- An ingest batch whose projected surface exceeds the retired numbers is admitted like any other batch; no `AMBER_E_MEMORY_BUDGET_EXCEEDED` is emitted, and no code path reads a budget ceiling.
- Supersession still replaces an entry through `supersedeTarget` in the same approval call, and `needs-re-review` remains a valid source state for it. This is a same-call pairing, not a crash-atomic transaction.
- `amber doctor` reports memory findings for a product repository, including source drift, and runs the memory checks once.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/memory-dispatch.test.js tests/integration/memory-commands.test.js
- node --test tests/unit/doctor-remedy.test.js tests/phase-v1-5.test.js tests/integration/amber-mcp.test.js
- node scripts/verify-public-docs.js
- npm run docs:gen:check
- node scripts/amber.js doctor --target .
- npm test

## Evidence Schema

- Command: `node --test` on the memory, doctor, MCP and phase suites; `node scripts/verify-public-docs.js`; `npm run docs:gen:check`; `node scripts/amber.js doctor --target .`; `npm test`.
- Result: 4300 tests, 4296 passed, 4 skipped (`sh` is not on this host's PATH), 0 failed, exit 0; `docs:gen:check` and `verify-public-docs.js` exit 0; the memory, doctor, phase and MCP suites pass; `amber doctor` reports memory findings for the product repository and exits 1 on this checkout because ten entries genuinely drifted.
- Date: 2026-11-06
- Notes: The first whole-suite run failed only on the F063 stray-untracked-roots guard because the new plan file was untracked; the run above is on the committed tree. `amber doctor` now exits 1 here until the drifted entries are reviewed, superseded, or abandoned — that is the intended visibility change, not a regression.
