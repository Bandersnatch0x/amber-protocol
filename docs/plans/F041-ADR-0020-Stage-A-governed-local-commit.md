# Plan: ADR-0020 Stage A governed local commit

Feature: F041
Status: accepted
User Confirmation: confirmed

## Goal

amber sync session push --execute --yes runs git add .amber/sync/envelopes + git commit behind the full gate set (identity, policy, single-use approval, path-and-state confinement, transport ledger); push stays report-only

## High Level Design

- Context: ADR-0020 (accepted) authorizes Stage A — Amber's first governed mutation of the user's real checkout. The gate mapping reuses three proven precedents rather than a new dialect: the loop approval shape (reviewer + single-use approvalKey, one approval = one execution, `latestUnconsumedApproval`), the loop policy gate (deny-wins `.amber/governance/rules.json`, `required: true` — missing/invalid policy refuses execution), and the memory identity gate (non-TTY without `--yes` fails closed). F040 just published the structured report contract; adjudication 4 narrows the add path to `.amber/sync/envelopes/` plus a transport decision record, and adjudication 2 downgrades to preparation-only when conflicts are pending.
- Proposed approach: new module `scripts/lib/core/sync-transport.js` with `approveTransport({target, reviewer})` (appends an `approved` record with a UUID approvalKey to `.amber/sync/transport/ledger.jsonl`, hash-chained via `appendLedgerRecord`) and `executeTransport({target, yes})`, which gates in order: (1) build the F040 report; no envelopes → typed no-change outcome; (2) `conflictCount > 0` → preparation-only downgrade (ADR adjudication 2 — a typed downgrade outcome, not an error); (3) identity gate — non-TTY without `--yes` → `AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED`, and `--execute` without `--yes` returns the F019-shaped `approvalRequired: true` envelope, exit 1 (implemented at the sync seam; MCP Action registration stays the conditional F018 surface per the ADR's "if ever exposed"); (4) policy — `loadPolicyRules(required: true)` then `evaluateGovernedPolicy` over each derived op shell line (add/commit only; push is never evaluated or executed in Stage A), deny-wins → `AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED`; (5) approval — `latestUnconsumedApproval` on the transport ledger → `AMBER_E_SYNC_TRANSPORT_NOT_APPROVED`; (6) path-and-state confinement — pre-staged index (any `git diff --cached --name-only` entry) → `AMBER_E_SYNC_TRANSPORT_DIRTY_TREE` (a pathspec add cannot sweep working-tree changes, but `git commit` commits the whole index — the empty-index check is the load-bearing one), and realpath confinement: every staged path must resolve inside the repo root (symlinked sync paths refuse); (7) execution — write decision record `.amber/sync/transport/decisions/<batchId>.json` (batchId, approvalKey, envelopeIds, opsFingerprint), `git add .amber/sync/envelopes .amber/sync/transport/decisions` (pathspec-confined; ledger.jsonl itself is never staged), `git commit -m "amber sync: N envelope(s)"` with nothing-to-commit mapped to a typed idempotent-retry outcome, non-zero otherwise → `AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED` with captured stderr; commit sha recorded. Every attempt (denied/unapproved/downgraded/failed/executed) appends to the transport ledger with the ops fingerprint (envelope ids + affected paths), git exit codes, stderr, and consumed approvalKey. New verbs: `amber sync session approve --reviewer <name>` and read-only `amber sync session ledger` (chain verify). The F040 report's add op narrows to paths [".amber/sync/envelopes", ".amber/sync/transport/decisions"] per adjudication 4.
- Risks: first real-checkout mutation — confinement must be adversarially tested (pre-staged index outside .amber/sync, pre-staged inside .amber/sync, symlinked envelopes dir/file, dirty working tree). `git commit` runs the repo's own hooks — a hook failure is COMMIT_FAILED, typed and recorded, never silent. The commit uses the repo's configured git identity. F040 tests pinning `paths.includes(".amber/sync")` update to the narrowed path set (anticipated in F040's evidence note). Default path (no --execute) must remain byte-identical report-only behavior — the downgrade target and permanent fallback.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/adr/0020-governed-live-git-transport.md, docs/adr/0003-governance-gated-execution.md, docs/specs/sync-envelope-contract.md
- review: docs/adr/0020-governed-live-git-transport.md, docs/specs/sync-envelope-contract.md

## Vertical Slices

- [x] Slice 1 (catalog + ledger + approve): red-first tests for the AMBER_E_SYNC_TRANSPORT_* catalog family (APPROVAL_REQUIRED, NOT_APPROVED, POLICY_REFUSED, DIRTY_TREE, COMMIT_FAILED — title/cause/remedy/layer present) and `approveTransport` (hash-chained approved record with reviewer + UUID approvalKey; single-use via latestUnconsumedApproval). CLI: `amber sync session approve --reviewer <name>`.
- [x] Slice 2 (gates): red-first tests for executeTransport gate order — no-change outcome (no envelopes), conflict downgrade (exit 0, preparation-only outcome, ledger record), identity gate (non-TTY without --yes), approvalRequired envelope (--execute without --yes), policy refusal (missing rules.json / no allow rule / deny rule), NOT_APPROVED, DIRTY_TREE (pre-staged index), symlink realpath refusal. Every refusal appends a ledger record.
- [x] Slice 3 (execution): decision record written and staged with envelopes; commit with derived message; nothing-to-commit typed idempotent outcome; COMMIT_FAILED with stderr; executed record with commit sha + exit codes + consumed approvalKey; approval consumed (second execute → NOT_APPROVED). CLI: `push --execute [--yes]` wiring with report-only default unchanged.
- [x] Slice 4 (report narrowing + adversarial): F040 report add op paths → [".amber/sync/envelopes", ".amber/sync/transport/decisions"]; update F040 tests; adversarial suite: pre-staged file outside .amber/sync, pre-staged inside .amber/sync, symlinked envelopes dir pointing outside the repo, symlinked file inside envelopes, dirty working tree outside .amber/sync (must NOT block — nothing can be swept), ledger never staged.
- [x] Slice 5 (docs): restate the boundary everywhere the "Amber never runs git" one-liner appears — sync help (command-registry.js), agents.md, docs/specs/sync-envelope-contract.md Stage A section, ADR-0020 Stage-A-shipped note; regenerate platform products (npm run gen:agents) if agents.md changes.

## Resume Checkpoint

- Resume Point: all five slices implemented; unit tests green; full-suite verification pending.
- Blockers: none.
- Next Action: run npm test, then session verify / complete / handoff / accept.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Default `amber sync session push` is byte-identical report-only behavior (F040 contract unchanged in shape; add-op path values narrowed per adjudication 4).
- `--execute` without `--yes` returns approvalRequired: true, exit 1; with `--yes` in a non-TTY it still requires a prior unconsumed approval; every refusal is typed (AMBER_E_SYNC_TRANSPORT_*) and recorded in the hash-chained transport ledger.
- Execution stages exactly .amber/sync/envelopes + .amber/sync/transport/decisions (never the pull-side ledgers, never the transport ledger), commits with the derived message, and records the commit sha; retry after success is a typed nothing-to-commit outcome, not a duplicate empty commit.
- Pending conflicts downgrade to preparation-only (exit 0, recorded).
- `git push` is never executed, evaluated, or proposed by the executing path in Stage A.
- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/sync-transport.test.js
- npm test

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
