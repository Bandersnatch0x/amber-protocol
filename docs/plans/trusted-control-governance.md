# Plan: Trusted Control Governance Contract implementation

Spec: `docs/specs/trusted-control-governance-contract.md` (spec_id `trusted-control-governance-contract`, status `proposed`, updated 2026-09-16)
Feature: F062
Status: implementation-ready
User Confirmation: confirmed
Origin tickets: `issues/0044`, `issues/0045`, `issues/0046`, `issues/0049`, `issues/0051`, `issues/0052`, `issues/0054`, `issues/0055`, `issues/0056`, `issues/0060` (D0 consolidation Log entries appended 2026-09-16)
Baseline HEAD: `0a9cbeab85898bd043e1ab9f7c89ea71193cbb78`
No new F-number is introduced; the feature catalog is untouched by this packet.

## Context manifests

Knowledge surfaces only; code paths ride F062's booked paths.

- implement: docs/specs/trusted-control-governance-contract.md, docs/plans/trusted-control-governance.md, docs/specs/trusted-control-run-contract.md, docs/specs/trusted-control-context-runtime-contract.md, docs/adr/0012-protocol-and-schema-versioning.md
- review: docs/specs/trusted-control-governance-contract.md, docs/plans/trusted-control-governance.md, .scratch/orchestration/governance-impl-2026-09-19/REVIEW-spec-plan.md

## Evidence Schema

- Command: npm test / node scripts/run-tests.js tests/unit/<suite> / npm run manifests / npm run doctor / npm run gen:agents:check
- Result: pass/fail counts + exit codes per gate, logged under .scratch/orchestration/governance-impl-2026-09-19/
- Date: 2026-09-19
- Notes: per-slice targeted suite commands recorded beside the logs; dual-axis review verdict in the same directory.

## Goal

Implement the governance contract end to end: the Core/Adapter dependency
guards and splits, the timeline event extension with the `run-events` chained
family, the session BLOCKED state, the four-level risk model and registry
field extensions, the five-value PDP enumeration with v2 capability rules and
the approval tuple binding on the loop surface, the evidence outcome columns
(`sideEffects[]`, ATTESTED reserved value, `verificationStatus` fold,
`evidenceContract` settle validation), the R0 replay bundle and R1 decision
replay with the drift fold, the metrics fold, and the read-only web drift
badge — with zero default-verb growth, zero forced migrations, and every
legacy surface tolerated as pre-field.

## High Level Design

- **Context:** the ten tickets' rulings are consolidated in the spec; this
  plan turns them into tracer-bullet slices (G-1…G-11, spec §11.6). The
  extend-only discipline is the design: every slice touches an existing
  surface (registry, PDP, receipts, timeline, handoff bundle) and adds
  optional fields or new closed-set members — never a parallel system.
- **Approach:** vertical slices at public seams (ledger folds, CLI outcomes,
  schema validation), red-first tests per slice. Cross-packet gates are
  explicit: session-surface approval binding rides the A0 run-contract plan's
  slices 1–3; `context_granted`/`context_denied` stay reserved-disabled until
  the context-runtime plan's Slice A lands and this plan's own slice G-2
  extends the enum; the evolution plan's rules deriver unblocks after G-5.
- **Risks:** (1) closed-set schema growth (`timeline-event.schema.json`
  enum + optional fields; `REQUEST_INPUT_FIELDS`/`RECEIPT_FIELDS` discipline)
  must be one coordinated change per schema or validation breaks — each slice
  lists its exact schema edits; (2) the governed-runner split (G-9) has the
  largest blast radius and lands last among splits behind the F062/F052
  suites; (3) CLI flags must register in FLAG_SPECS in the same slice that
  adds them (known blind spot: unregistered flags parse as positionals while
  unit tests stay green); (4) `RISK_POLICY_VERSION` bump invalidates stale
  approvals by design — the release note must say so.

## Slices (each lands green with tests)

- [x] **Slice G-1 — Core/Adapter dependency guards (spec §5.5/§5.6).**
  Files: new `tests/unit/core-domain-separation.test.js`; a layer marker
  (`scripts/lib/core/core-layer.json` or header-comment convention —
  implementation choice); no product-code moves.
  Work: AST-scan require paths; Core-marked files must not require
  `git-exec`/`git-state`/`git-workflow-detector`/`worktree-manager`; the
  current not-yet-split files sit in a known-deviation allowlist so the guard
  is red only on new violations.
  Acceptance: guard green at HEAD with the recorded allowlist; a deliberately
  injected forbidden require turns it red (tested once in the suite's
  fixture).

- [x] **Slice G-2 — Timeline schema extension + `run-events` family (spec §10.2/§10.3).**
  Files: `schemas/timeline-event.schema.json` (+11 kinds with
  `context_granted`/`context_denied` reserved-disabled; optional
  `runId`/`actor`/`sequence`/`prevHash`/`hash`), new
  `scripts/lib/core/ledger-run-events.js` (`defineLedgerFamily` declaration,
  legacy-prefix `preLink`), the timeline append path in
  `scripts/lib/session-commands.js`.
  Acceptance: chained events verify by fold; legacy plaintext lines read
  without backfill; reserved kinds are emitted by no code path (negative
  test); `run_started`/`run_completed`/`run_failed` carry the full derived
  `runId` (A0 plan slice 6 alignment).

- [x] **Slice G-3 — Session BLOCKED + `budget.exhausted` (spec §10.1, §7.4).**
  Files: `scripts/lib/session-state-machine.js` (STATES/TRANSITIONS/
  EVENT_TYPES + BLOCKED), `scripts/lib/core/governed-runner.js`
  (`budget.exhausted` event), `scripts/lib/session-commands.js` (blocked
  entry/exit via the `rejectResume` guard).
  Acceptance: EXECUTING→BLOCKED on budget exhaustion;
  BLOCKED→EXECUTING|ABORTED only; BLOCKED→COMPLETED illegal; run-level
  exhaustion still settles FAIL directly.

- [x] **Slice G-4 — Registry risk model + field extensions (spec §7).**
  Files: `scripts/lib/core/runner-registry.js` (`RISK_LEVELS` +critical,
  `RISK_POLICY_VERSION` 2, escalation rules in `riskOf`, registration fields
  `targetSchema`/`constraints`/`idempotency`/`evidenceContract` with
  `schema-contract.js` compilation for targetSchema).
  Acceptance: `rollback:"none"` high-effect ⇒ critical; scoped credential +
  deploy/rollback ⇒ critical; version bump makes a stale approval refuse
  (drift); old events read new fields as null/unknown; registration of the
  fields requires the committed Decision path (F052 discipline).

- [x] **Slice G-5 — PDP five-value enumeration + v2 rules + loop-surface binding (spec §6).**
  Files: `scripts/lib/core/loop-policy.js` (decision enumeration, v2
  capability-rule path, schemaVersion dispatch), new
  `schemas/loop-policy.schema.json`, `scripts/lib/core/loop-execution.js` +
  the loop `approved`-record writers (three-hash tuple),
  `scripts/lib/core/staleness-registry.js` (reuse only),
  `scripts/lib/core/governed-runner.js` (`policy.evaluated` event).
  Acceptance: deny-wins across v1+v2; unknown fail-closed with
  `no-rule-matched`; require_approval drives the capture→grant→execute path
  (A0 plan slices 1–3 gate); policy change writes the staleness receipt and
  stale grants refuse at consumption; no DEFER value exists (negative test).
  **Gated on the A0 plan's slices 1–3 for the session-surface binding
  fields; the loop-surface tuple may land independently.**

- [x] **Slice G-6 — Evidence outcome columns (spec §8).**
  Files: `scripts/lib/core/evidence-receipts.js` (`RECEIPT_FIELDS` +
  `sideEffects[]`; `ASSURANCE_LEVELS` + `attested` reserved —
  `RECORDABLE_ASSURANCE` unchanged; `projectEvidenceRecord` derives
  `verificationStatus`), `scripts/lib/core/governed-runner.js`
  (settle-side `evidenceContract` validation).
  Acceptance: record with `attested` refuses; fold derives
  UNVERIFIED/PASSED/FAILED/PARTIAL/UNKNOWN with the conflict→UNKNOWN rule;
  a receipt missing a declared `evidenceContract` field refuses settle with
  the `AMBER_E_RUNNER_EXECUTION_INVALID` family; a FAILED verification never
  rewrites `status` (both orders tested).

- [x] **Slice G-7 — Replay R0/R1 + drift fold (spec §9).**
  Files: `scripts/lib/core/handoff-bundle.js` (`--replay-scope` + `replay/`
  nine files; `validateHandoffBundle` hash verification), new
  `replayPolicyDecisions` read path (CLI verb surface per §11.3 — outside the
  default projection, FLAG_SPECS-registered), drift fold in the run read
  path.
  Acceptance: offline bundle rebuilds the authorization chain; tampered
  body ⇒ `NON_REPLAYABLE`; R1 report is a comparison (not pass/fail) with
  exact/compatible/drifted/nonReplayable; Model/External-state dimensions
  annotate only; R2 absent; R3 stays `replayOf` + read/diagnose-only.

- [x] **Slice G-8 — Metrics fold (spec §8.4).**
  Files: metrics projection (fold over attempt records + §6.5/§7.4 events +
  approval registry; location per the A0 plan slice 7 alignment).
  Acceptance: the A0 worked example reads `requested 3 / admitted 2 / denied
  1 / settled{failed:1, succeeded:1}`; `tool_calls_total` and
  `context_grants_total` do not exist (negative test); the projection never
  writes back.

- [x] **Slice G-9 — Core/Adapter splits + adapter seam (spec §5.5 order).**
  Files: per the migration order — `ledger-seal`/`artifact-drift`/
  `team-governance-advisor`, then `sync-session`/`sync-transport`, then
  `identity`, `scaffold`, finally `governed-runner`; new
  `scripts/lib/core/execution-domain-adapter.js` (five-method contract).
  Acceptance: G-1 guards tighten from known-deviation to strict at each step
  (allowlist shrinks monotonically); F062/F052 suites green after the
  governed-runner split; `src/` untouched (second-consumer precondition
  unchanged).
  **Progress (2026-09-19, B10): the seam + identity + rows 4-10 splits
  landed; `governed-runner` (row 11, the largest blast radius) remains the
  recorded continuation with its suites as the acceptance net. The AST guard
  is scope-blind — the split files' lazy-injection requires stay on the
  allowlist with the state recorded; a scope-aware scan is the tightening
  path.**

- [x] **Slice G-10 — Web drift badge + R1 report link (read-only). (spec §9.4)**
  Files: `apps/web` run-detail projection.
  Acceptance: badge renders the four-state fold; R1 report is a read-only
  table; no interactive replay control exists (negative test).

- [x] **Slice G-11 — Layout/versioning docs (spec §11.2/§11.4).**
  Files: documentation of the `.amber/` projection map and the version-field
  table (docs only).
  Acceptance: no physical directory moves (git diff shows docs only).

## Ticket acceptance mapping (ticket → contract sections → plan slices)

| Ticket | Contract sections | Plan slices |
| --- | --- | --- |
| 0044 umbrella | §2 (plane ownership), §12 (invariants) | all (G-1…G-11 realize the D0-owned planes) |
| 0045 gap ledger | §3 (reconciliation), §5.5 (22-file reconstruction) | G-1, G-9 (the two "missing" planes it drove) |
| 0046 positioning | §4; ADR-0030 amendment (delivered by this packet) | G-11 (docs); CONTEXT.md Harness entry + Intent annotation ride G-11 per the amendment's ruling |
| 0049 Core/Adapter | §5.1–§5.6 | G-1 (guards), G-9 (splits + adapter seam) |
| 0051 PDP | §6.1–§6.5 | G-5 (+ G-3 for the `budget.exhausted` event face) |
| 0052 capability | §7.1–§7.4 | G-4 (+ G-3 for budget exhaustion) |
| 0054 outcome | §8.1–§8.4 | G-6, G-8 |
| 0055 replay | §9.1–§9.4 | G-7, G-10 |
| 0056 lifecycle | §10.1–§10.3 | G-2, G-3 |
| 0060 closeout | §11.1–§11.7 | G-1…G-11 (the sequence itself), G-11 (layout/versioning docs) |

## File ownership candidates (summary)

| Path | Slice | Shared with |
| --- | --- | --- |
| `tests/unit/core-domain-separation.test.js` | G-1, G-9 | 0049 spec |
| `schemas/timeline-event.schema.json`, `ledger-run-events.js`, `session-commands.js` | G-2, G-3 | 0056; A0 slice 6; context-runtime plan Slice A (reserved kinds) |
| `session-state-machine.js` | G-3 | 0056 |
| `runner-registry.js` | G-4 | 0052; context-runtime plan Slice C (same file — coordinate) |
| `loop-policy.js`, `schemas/loop-policy.schema.json`, `loop-execution.js` | G-5 | 0051; evolution plan slice 5 (rules deriver consumer) |
| `approval-registry.js`, `staleness-registry.js` | G-5 | A0 slice 2 (binding fields); reuse-only here |
| `evidence-receipts.js`, `governed-runner.js` | G-3, G-5, G-6 | A0 slices 3/4; 0054 |
| `handoff-bundle.js`, replay read path | G-7 | A0 slice 5; 0055 |
| metrics fold | G-8 | A0 slice 7; 0054 |
| split targets (§5.5 rows) | G-9 | 0049 |
| `apps/web` run-detail | G-10 | 0055; web eslint/typecheck gates |

## Compatibility and migration boundaries

- Zero forced migrations: rules v1, approvals, execution ledgers, session
  manifests, loop contracts, timeline plaintext (legacy prefix), pre-field
  attempts/receipts/Loadouts all read as pre-field records (spec §11.1).
- Zero default-verb growth: every new subcommand/flag registers outside the
  journey/core projection AND in FLAG_SPECS.
- Zero physical `.amber/` re-layout beyond the two directories authorized by
  the four contracts (research citations, suggestion review ledger).
- Existing suites stay green per-slice; the known-flaky apps/web vitest set
  is out of blast radius.

## Acceptance Criteria

1. Every spec section's test obligations exist at public seams and pass
   (ledger folds / CLI outcomes / schema validation, not internals).
2. The extend-only discipline holds: no second PDP/state machine/ledger
   implementation/identity system appears in the diff.
3. Default help output is byte-identical to the F063 seven-verb surface.
4. Legacy tolerance is proven per surface (pre-field reads, legacy prefix,
   NON_REPLAYABLE) — never an upgrade, never a default fill.
5. Full gates (`npm test`, `manifests`, `doctor`, `gen:agents:check`; web
   typecheck/test when G-10 lands) pass at the end of the sequence — run by
   the implementing packet, verified by the coordinator; this plan does not
   self-approve.

## Verification

- Per-slice: red-first unit tests at the seams listed above; targeted suite
  runs recorded with exact commands and exit codes in the packet results.
- Cross-packet: shared-file slices (runner-registry with the context-runtime
  plan's Slice C; approval fields with A0 slice 2) land only in the gated
  order; a slice landing out of order is a review blocker, not a style issue.
- Final: coordinator Standards + Spec two-axis review before any ticket Log
  records acceptance. Evidence of "not yet delivered" today: no
  `core-domain-separation.test.js`, no `run-events` family, no BLOCKED state,
  three-level `RISK_LEVELS`, two-value PDP at HEAD `0a9cbeab`.

## Open dependencies (visible, not resolved here)

1. **SOURCE-V31** (V3.1 FINAL text absent) — blocks S1–S11 traceability
   (spec §11.7); does not block any slice (all rules trace to local decisions
   and HEAD sources).
2. **A0 run-contract slices 1–3** gate G-5's session-surface binding fields.
3. **Context-runtime plan Slice A** gates any future enabling of
   `context_granted`/`context_denied` (G-2 lands them reserved-disabled
   regardless).
4. **Evolution plan slice 5** (rules deriver) unblocks after G-5.

## Resume Checkpoint

- Resume Point: G-1…G-8, G-10, G-11 delivered in full; G-9 delivered as the seam module (`execution-domain-adapter.js`), the identity split, and the rows 4-10 injected-adapter splits — the `governed-runner` split (row 11) is the recorded continuation. Full gates green on the final tree (root 3756/3756, manifests/doctor/gen:agents:check/typecheck exit 0) — `.scratch/orchestration/governance-impl-2026-09-19/` (`B10-dual-axis-review.md`, `root-npm-test.log`, `gates.log`).
- Blockers: none for the delivered set; the governed-runner split and a scope-aware guard scan are the named continuations.
- Next Action: user approves the two human route gates of session `7e4e09ec`, then `amber session complete`.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  slice; do not regenerate unless the plan file is missing.
