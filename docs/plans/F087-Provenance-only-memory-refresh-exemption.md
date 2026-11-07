# Plan: Provenance-only memory refresh exemption

Feature: F087
Status: accepted — implementation complete, pending mandatory two-axis review and coordinator acceptance
User Confirmation: confirmed

## Goal

A memory entry that names a real active/needs-re-review predecessor and exactly preserves its claim, knowledgeKind and targetSurface is admitted without consuming the five-per-168h gamma quota, while changed claims, invalid targets and ordinary admissions keep the existing limit and every other admission gate.

## High Level Design

- **Context.** γ (gamma) is a rolling 168-hour admission limit of five entries
  (`scripts/lib/core/memory-policy.js`). It counts every admitted `entryIds` value in the
  `memory-ingest` ledger window. Because `entryId` is content-addressed over
  `{claim, knowledgeKind, targetSurface, sources, supersedeTarget?}`, a *provenance refresh*
  (same claim, refreshed source hashes) can only be expressed as a new identity plus a
  supersession. That refresh therefore consumes the same quota as new knowledge, while doctor
  §11-2 designates supersede/abandon as the only durable exits for source drift. The audit
  reproduced this on an isolated target: with the window exhausted, a claim-preserving refresh
  is refused `AMBER_E_MEMORY_RATE_LIMITED` and the doctor error persists
  (`.scratch/claude-project-audit/gamma-probe-results.json`).
- **Proposed approach.** Define exactly one predicate — a *provenance-only refresh* — in
  `memory-policy`, and use it from every consumer: admission, the queued mixed pool, event
  accounting, status projection and doctor. The predicate is registry-backed: it reads the
  predecessor entry by `supersedeTarget` and compares `claim`, `knowledgeKind` and
  `targetSurface` for exact equality; the predecessor must be `active` or `needs-re-review`.
  No caller-declared flag participates. Exempt entries are admitted without consuming quota and
  without competing in the truncation pool; charged entries keep the existing K1/K2/K3
  all-or-nothing behavior. The ledger records both sets explicitly
  (`gammaChargedEntryIds`, `gammaExemptEntryIds`) while keeping `entryIds` complete; legacy
  events with neither field keep their prior accounting.
- **Risks.**
  1. *Laundering new knowledge through the exemption.* Mitigated mechanically: the entry's own
     claim/kind/surface must equal the predecessor's byte-for-byte, so no new claim text can
     ride the exemption. The human `approve` gate and every other admission stage stay.
  2. *Ledger/doctor divergence.* New events carry a partition; `gammaWindow` counts only the
     charged side; doctor §11-5 gains a partition-consistency check so a hand-edited ledger
     fails closed instead of silently changing the quota.
  3. *Surface drift from the documentation edit.* Root `MEMORY.md` prose must describe the new
     accounting; any edit changes the whole-file normalized hash and will drift the four
     currently-active entries' booked surface hash at the next doctor run. That is a known,
     recoverable consequence (`memory book --entry-id` is γ-free) and is reported rather than
     hidden; the real registry entries are not mutated by this change.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/specs/F087-provenance-refresh-gamma-exemption.md
- review: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/specs/F087-provenance-refresh-gamma-exemption.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [ ] Slice 1: add the single registry-backed refresh predicate and charged/exempt window accounting.
  - paths: scripts/lib/core/memory-policy.js
  - depends-on: none
  - verify: node --test --test-name-pattern="gamma" tests/integration/memory-commands.test.js
- [ ] Slice 2: charge only non-exempt candidates at admission, keep mixed batches all-or-nothing, record the partition in the ledger and the status projection.
  - paths: scripts/lib/memory-commands.js
  - depends-on: 1
  - verify: node --test tests/integration/memory-commands.test.js tests/unit/memory-dispatch.test.js
- [ ] Slice 3: make doctor §11-5 judge charged admissions and refuse an inconsistent ledger partition.
  - paths: scripts/lib/core/doctor.js
  - depends-on: 1
  - verify: node --test --test-name-pattern="rule 5" tests/integration/memory-commands.test.js
- [ ] Slice 4: synchronize the governed spec, the ADR amendment, the CLI reference and the delta spec; regenerate the knowledge corpus.
  - paths: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/CLI_REFERENCE.md, docs/specs/F087-provenance-refresh-gamma-exemption.md
  - depends-on: 1, 2, 3
  - verify: node scripts/amber.js knowledge context-sync --target . && npm run docs:verify
- [ ] Slice 5: align the memory help text and the status action-type goal with the charged/exempt projection; regenerate the CLI pages.
  - paths: scripts/lib/command-registry.js, action-types/memory-status.json
  - depends-on: 4
  - verify: npm run docs:gen:check && npm run gen:agents:check
- [ ] Slice 6: publish runner ACK files atomically and pin it with a deterministic overlap regression.
  - paths: apps/web/server/lib/runner-ack.ts, apps/web/tests/server/runner-ack.test.ts
  - depends-on: none
  - verify: npm --prefix apps/web run test -- tests/server/runner-ack.test.ts
- [ ] Slice 7: drop the duplicated `Error: ` prefixes in the session command family.
  - paths: scripts/lib/session-commands.js, scripts/lib/command-dispatcher.js
  - depends-on: none
  - verify: node --test tests/integration/session-commands.test.js
- [ ] Slice 8: correct F033's obsolete alpha description in the feature list.
  - paths: feature_list.json
  - depends-on: none
  - verify: npm run manifests

## Resume Checkpoint

- Resume Point: all slices implemented; evidence recorded below.
- Blockers: none. Independent Standards + Spec review and acceptance belong to the coordinator.
- Next Action: review the diff, then run the two-axis review; the MEMORY.md prose edit drifts the four active entries' booked surface hash and is repaired by four γ-free `memory book --entry-id` calls after the memory supersessions.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied: with the γ window exhausted, a claim-preserving refresh of an active or needs-re-review entry is admitted, a changed-claim supersession of the same predecessor is refused, and a mixed batch is admitted only when its charged subset fits the remaining quota.
- Existing Amber guardrails still pass: schema/binding/signal gates, the human approve gate, the book surface registration, ledger/registry consistency (doctor rules 1–2), and the phase-boundary rule that Amber never writes MEMORY.md itself.
- Reserved: the case-insensitivity of the predicate is exact string equality, so a cosmetic claim edit is a changed claim (charged), not a refresh.

## Verification

- targeted memory policy/command tests green
- npm test full suite green
- amber doctor rule 5 counts charged admissions only
- npm --prefix apps/web run test (runner ACK atomic regression)
- generator/manifest/doc gates: docs:gen:check, docs:verify, gen:agents:check, manifests, wiki, lint, format:check

## Evidence Schema

- Command: `node scripts/run-tests.js` (full suite), `node --test tests/integration/memory-commands.test.js tests/unit/memory-dispatch.test.js`, `npm --prefix apps/web run test`, `npm run docs:gen:check`, `npm run docs:verify`, `npm run gen:agents:check`, `npm run manifests`, `npm run lint`, `npm run format:check`, `node scripts/validate-wiki.js --target .`
- Result: recorded in `.scratch/claude-project-audit/implementation/` (full logs) and summarized in the F087 implementation report; every red is attributed before it is re-anchored.
- Date: 2026-11-07
- Notes: fix-then-revert proof is required for the γ exemption tests and the runner ACK atomic write; the full suite is mandatory because `scripts/lib/` and new tests changed.
