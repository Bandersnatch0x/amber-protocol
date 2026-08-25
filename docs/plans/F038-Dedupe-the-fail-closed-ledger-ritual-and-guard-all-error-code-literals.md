# Plan: Dedupe the fail-closed ledger ritual and guard all error-code literals

Feature: F038
Status: accepted
User Confirmation: confirmed

## Goal

jsonl.js owns the typed fail-closed ledger read (readLedgerFailClosed/foldLedgerFailClosed) and command-helpers.js owns the readFailure envelope; the four verbatim copies are deleted, and a guard test asserts every AMBER_E_* literal in scripts/lib resolves in the error catalog

## High Level Design

- Context: survey Findings 5+6 (docs/reviews/architecture-survey-2026-08-24.md). The fail-closed ledger ritual exists as four verbatim copies; 37+ AMBER_E_* literals across 9 files are unguarded against catalog drift (a typo'd code renders without its `[CODE] → fix:` remedy and nothing fails).
- Proposed approach: (a) `core/jsonl.js` gains `readLedgerFailClosed(filePath, code, label)` and `foldLedgerFailClosed(filePath, key, code, label)` — read/fold with `onCorrupt: "throw"`, rethrow carrying `.amberCode`; knowledge-base.js and organization-audit.js delete their byte-identical `corruptLedgerError` copies. (b) `command-helpers.js` gains `readFailure(args, err, fallbackCode)`; knowledge-commands.js and org-audit-commands.js delete their identical private copies. (c) Generalize the existing production-scan test (error-catalog.test.js:97 covers only `AMBER_E_CONTEXT_*`) to every `AMBER_E_[A-Z_]+` literal in scripts/lib, each resolving via `getEntry`.
- Risks: message-format drift (tests pin code-in-message + non-empty, not the prefix — verified); the two command adapters' fallback codes differ (KB_CORRUPT vs ORG_CORRUPT), so readFailure must take the fallback explicitly. Mitigation: keep message templates byte-identical via label param; full-suite baseline comparison.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/reviews/architecture-survey-2026-08-24.md
- review: docs/reviews/architecture-survey-2026-08-24.md

## Vertical Slices

- [x] Slice 1: red-first — generalize the error-catalog production scan to all AMBER_E_* literals (expect green; it proves the backfill held); add failing unit tests for readLedgerFailClosed/foldLedgerFailClosed shapes and the shared readFailure envelope; implement in jsonl.js and command-helpers.js (green).
- [x] Slice 2: migrate knowledge-base.js (readAllRecords, readRecordLineage), organization-audit.js (readAuditEvents), knowledge-commands.js, org-audit-commands.js onto the shared helpers; delete the four private copies; all existing fail-closed regression tests stay green.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F038-Dedupe-the-fail-closed-ledger-ritual-and-guard-all-error-code-literals.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The four verbatim copies are deleted (grep finds one definition each of the ledger-read ritual and the readFailure envelope).
- Every AMBER_E_* literal in scripts/lib resolves via getEntry (guard test).
- Existing fail-closed regression suites (knowledge-base, organization-audit, amber-cli-knowledge, amber-cli-organization-audit) stay green; full suite matches the 58-known-failure baseline.

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- Red-first: `rtk node --test tests/unit/ledger-fail-closed.test.js` → 12/12 fail pre-implementation → 12/12 pass after.
- Catalog guard: generalizing the scan to all `AMBER_E_*` literals went red on exactly one token — the `AMBER_E_CONTEXT_*` wildcard family mention in command-registry.js help prose (not a code); the scan skips wildcard-family references and now guards all 58 real codes green.
- Affected suites (ledger-fail-closed, knowledge-base, organization-audit, error-catalog, jsonl, amber-cli-knowledge, amber-cli-organization-audit): 104/104 pass.
- Full suite: `rtk node --test` → 2605 tests / 2547 pass / 58 fail = baseline + 12 new tests, zero new failures.
- Session evidence: `amber session verify --execute` ran `npm test` for real (exit 0, 150277ms), recorded against feature F038.
- Confirmation greps: `corruptLedgerError` has zero occurrences in scripts/; exactly one `readFailure` definition (command-helpers.js).

## Evidence Schema

- Command: `rtk node --test` (full suite)
- Result: 2605 tests / 2547 pass / 58 fail (baseline-identical + 12 new tests)
- Date: 2026-08-25
- Notes: implementation via subagent; coordinator-verified diffs, 104/104 affected suites, full suite. Commits 81b68d5 (implementation) + governance closeout. Session 3f42529a-5b47-4efc-888e-5c5f47f04238.
