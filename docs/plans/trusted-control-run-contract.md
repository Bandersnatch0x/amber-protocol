# Plan: Trusted Control Run Contract implementation

Spec: `docs/specs/trusted-control-run-contract.md` (spec_id `trusted-control-run-contract`, status `proposed`, updated 2026-09-16)
Feature: F062
Status: implementation-ready
User Confirmation: confirmed
Origin ticket: `issues/0050-run-runscope-snapshot.md` (correction appended 2026-09-16)
Baseline HEAD: `0a9cbeab85898bd043e1ab9f7c89ea71193cbb78`
No new F-number is introduced; F064 and the feature catalog are untouched.

## Context manifests

Knowledge surfaces only (specs, ADRs, plan contracts); code paths ride F062's booked paths.

- implement: docs/specs/trusted-control-run-contract.md, docs/plans/trusted-control-run-contract.md, docs/adr/0028-ledger-family-factory-and-decision-primitives.md, docs/adr/0012-schema-growth.md, issues/0050-run-runscope-snapshot.md
- review: docs/specs/trusted-control-run-contract.md, docs/plans/trusted-control-run-contract.md, .scratch/orchestration/run-contract-impl-2026-09-19/REVIEW-spec-plan.md

## Goal

Implement the trusted-control run contract end to end: per-attempt frozen admission
records (values + hashes) in the session ledger, pre-effect gate verification in the
governed runner, three-hash + attempt-identity authorization binding, evidence/timeline
join fields, and offline replay over frozen values — across every 0050 consumer
(0051/0054/0055/0056 surfaces), with compatibility boundaries that never upgrade
legacy records.

## High Level Design

- **Context:** audit P1-01 (Run identity/freeze contradictions) resolved by the
  verified rereview v2 (`.scratch/orchestration/0050-contract-rereview-2026-09-16-W5CoFK/RESULT.md`;
  model checks 10/10; coordinator regression all-negative). The canonical contract now
  lives in the spec; this plan turns it into tracer-bullet slices. The frozen unit is
  the existing attempt (`session-stage-runner.js`); no new ledger family, no new schema
  object, no parallel state machine.
- **Approach:** extend the existing append-only surfaces in place —
  `stage_attempt_requested` gains frozen value+hash fields; admission outcomes become
  explicit appended events; the governed runner's gate path gains the pre-effect
  verification and eligibility checks; approval grants gain the binding tuple; the
  bundle carries per-attempt frozen slices; timeline/metrics consume by fold. Each
  slice is a vertical cut with red-first tests at the public seams (ledger folds and
  CLI-level outcomes, not internal calls).
- **Risks:** (1) consumer-ticket overlap — 0051/0054/0055/0056 owners must not
  diverge from the field names pinned here; mitigation: this plan lists exact field
  names and marks each shared file with its owning ticket, and cross-ticket slices
  land only after that ticket's own rereview is adopted. (2) legacy attempts without
  frozen fields must not break existing folds; mitigation: all new fields optional
  (ADR-0012), readers fail closed to `NON_REPLAYABLE`/gap, never to a crash.
  (3) The `capabilityHash` over full registered capability records must match the
  registry fold exactly; mitigation: compute from the same fold the registry exports,
  red-first fixtures pin the canonical form.

## Vertical Slices (tracer bullets)

Order matters and follows the real dependency: a grant can only bind an attempt
that was durably captured first (spec §5 R-AD-6), and gates can only consume a
binding that grant writers already produce. Slices 1→2→3 are therefore
capture → grant-binding → gate-consumption; 4-7 are the consumers, each gated on
its owning ticket's adopted rereview.

- [x] **Slice 1 — Attempt capture: durable admission record (core, F062 surface).**
  Files: `scripts/lib/session-stage-runner.js` (primary),
  `scripts/lib/core/context-hash.js` (reuse, no change),
  `tests/unit/session-stage-runner*.test.js` (new/extended).
  Work: extend `buildRequest`/`executeAttempt` to freeze `scopeInputs` (including
  optional `context_constraints` per spec §6 R-AU-1 when 0053's fields exist),
  the resolved command/argv, parsed rules object, pinned capability records,
  Loadout hash, and `execution_context` into `stage_attempt_requested` with the
  five base hashes + `contractHash` + `inputDigest` (filling the native
  `:481` field per spec R-FR-0); serialize/clone at the ledger append boundary;
  append `attempt_admitted` (with recorded policy verdict) / `attempt_denied`
  (with explicit reason) events; derive attempt status by fold; keep the existing
  idempotency key untouched; **add the capture-first path**: when an
  approval-requiring stage has no eligible grant, append the durable request and
  return `awaiting-authorization` without executing (spec R-AD-6 step 1 —
  proposed evolution of `:507-512`, using the host-agent pending precedent
  `:548-556`).
  Acceptance: spec §10 tests 1/2/5/7/10 (same-prefix IDs, duplicate/retry,
  mutation isolation, ordered arrays, crash-left-requested, capture-then-pending).

- [x] **Slice 2 — Authorization binding fields (grant writers).**
  Files: `scripts/lib/core/loop-ledger.js` (no shape change — fields live on
  callers), `scripts/lib/core/loop-execution.js` and route/session callers writing
  `approved` records, `scripts/lib/core/approval-registry.js`.
  Work: grants gain `{scopeHash, policyVersion, capabilityHash, boundAttemptId?}`
  (attempt-bound by default per spec §7 R3); the grant step accepts a captured
  attemptId/runId and refuses one that does not exist in the ledger (spec R-AD-6
  step 2 — proposed API/CLI evolution, classified as proposed). **Shared ownership
  with 0051 — land only against 0051's adopted rereview; field names are pinned by
  the spec and must not be renamed locally.**
  Acceptance: grant bound to a captured attempt is recorded; grant naming a
  non-existent attemptId is refused.

- [x] **Slice 3 — Pre-effect gate verification and consumption (core, governed-runner).**
  Files: `scripts/lib/core/governed-runner.js` (primary), `tests/unit/governed-runner*.test.js`.
  Work: in the gate path, before policy evaluation/execution/consumption — verify
  the resolved request hashes to the frozen `inputDigest`; verify the gate-loaded
  rules hash equals the attempt's frozen `policyHash`; verify the current registry
  capability records hash equals the frozen `capabilityHash`; run the real policy
  evaluation; check consumption eligibility (spec §6 order) including
  `boundAttemptId`. Refusals append `denied` records with explicit reasons and
  leave the approval unconsumed; an `awaiting-authorization` attempt with a bound
  grant proceeds to execution in the same call (spec R-AD-6 step 3).
  Acceptance: tests 3/6/9 of spec §10 (consumed/capability-drift/mismatched-attempt
  grants; gate-time drift refuses pre-effect; request-digest mismatch refuses).

- [x] **Slice 4 — Evidence receipt join fields (0054 consumer).**
  Files: `scripts/lib/core/governed-runner.js` (`recordExecutionEvidence`),
  `scripts/lib/core/evidence-receipts.js` (RECEIPT_FIELDS is closed — extend the
  `environment` contents, not the top-level set, unless 0054 adopts otherwise).
  Work: `environment.runId` + `environment.scopeHash` as join keys; a receipt that
  cannot join to an admission record scores an evidence-completeness gap.
  Acceptance: join present on new receipts; unjoinable receipts flagged, not
  silently accepted. **Gated on 0054 rereview adoption.**

- [x] **Slice 5 — Replay bundle per-attempt slices (0055 consumer).**
  Files: `scripts/lib/core/handoff-bundle.js`, new `replayPolicyDecision` read path.
  Work: `--replay-scope <sessionId|runId>` emits per-attempt frozen-record slices
  plus hash-pinned policy copies (one per policy version seen); replay verifies
  value-hash integrity then re-evaluates with the existing pure
  `evaluateCommandPolicy` over stored values; `NON_REPLAYABLE` per attempt on
  hash-only/missing/tampered.
  Acceptance: test 4/8 of spec §10; offline bundle reproduces recorded verdicts with
  the working copy absent. **Gated on 0055 rereview adoption.**

- [x] **Slice 6 — Timeline run events (0056 consumer).**
  Files: `scripts/lib/session-commands.js` / timeline append path,
  `schemas/timeline-event.schema.json` (optional fields only).
  Work: `run_started`/`run_completed`/`run_failed` per attempt carrying the full
  derived `runId`; stored-vs-derived mismatch fails the fold.
  Acceptance: events fire per attempt lifecycle; legacy events unchanged and never
  upgraded. **Gated on 0056 rereview adoption.**

- [x] **Slice 7 — Metrics fold (0054 consumer).**
  Files: metrics projection (`governance-report` fold or the location 0060's PR
  sequence assigns).
  Work: attempt counters per spec §7 R2 — `attempts_requested_total`,
  `attempts_admitted_total`, `attempts_denied_total`, `attempts_settled_total{status}`
  with the stated inclusion relations; session terminal states counted separately.
  Acceptance: a fail→gate-refused→succeed sequence reads
  `requested 3 / admitted 2 / denied 1 / settled{failed:1, succeeded:1}`, never
  one merged `completed`. **Gated on 0054 rereview adoption.**

## File ownership candidates (summary)

| Path | Slice | Shared with |
| --- | --- | --- |
| `scripts/lib/session-stage-runner.js` | 1 | — |
| `scripts/lib/core/loop-execution.js` + `approved`-record callers | 2 | 0051/0052 |
| `scripts/lib/core/approval-registry.js` | 2 | 0051 |
| `scripts/lib/core/governed-runner.js` | 3, 4 | 0054 (join fields) |
| `scripts/lib/core/evidence-receipts.js` | 4 | 0054 |
| `scripts/lib/core/handoff-bundle.js` | 5 | 0055 |
| `scripts/lib/session-commands.js`, `schemas/timeline-event.schema.json` | 6 | 0056 |
| metrics fold location | 7 | 0054/0060 |
| `scripts/lib/core/context-hash.js`, `loop-policy.js`, `loop-ledger.js` | 1-3 | reuse only — no behavioral change to them |

## Compatibility and migration boundaries

- All new record fields are optional additions (ADR-0012 schema growth); no schema
  version bump for existing consumers, no `.amber/` re-layout (0060 scope), no new
  CLI verbs, no new ledger family (0045 conclusion).
- Legacy attempts without frozen fields: reads fail closed to
  `NON_REPLAYABLE`/completeness-gap; never default-filled, never upgraded, never
  re-chained (0056 owns legacy chaining).
- `glx-` worktree names, existing idempotency keys, `session continue` semantics,
  and the four-gate structure are unchanged.
- Existing suites must stay green per-slice; the known-flaky apps/web vitest set is
  out of this plan's blast radius.

## Acceptance Criteria

1. Every spec §10 test exists and passes at the public seam (ledger folds / CLI
   outcomes), not by testing internals.
2. All four v2 counterexample regressions stay refused in product tests (they are
   already refused in the model checks): truncated-ID collision, consumed-grant
   acceptance, capability-drift acceptance, hash-only replay acceptance.
3. A fail→drift→new-grant→succeed story is fully attributable across records, and
   offline replay reproduces verdicts from bundle values only.
4. No consumer surface diverges from the field names pinned by the spec; shared
   files land only with their owning ticket's adopted rereview.
5. Full gates (`npm test`, `manifests`, `doctor`, `gen:agents:check`) pass at the
   end of the slice sequence — run by the implementing packet, verified by the
   coordinator; this plan does not self-approve.

## Verification

- Per-slice: red-first unit tests at the seams listed above; targeted suite runs
  recorded with exact commands and exit codes.
- Model-to-product bridge: the proposal checks at
  `.scratch/orchestration/0050-contract-rereview-2026-09-16-W5CoFK/CHECKS.cjs`
  (10/10, read-only) remain the semantic reference; product tests must cover the
  same ten scenarios at the real seams.
- Final: full test gates + coordinator Standards and Spec reviews (two-axis) before
  any ticket Log records acceptance. Evidence of "not yet delivered" today: no
  frozen fields exist in `stage_attempt_requested` at HEAD `0a9cbeab`.

## Resume Checkpoint

- Resume Point: all seven slices delivered 2026-09-19 (session `24f45d7a`). Spec
  §10 tests 1–10 pass at the public seams (19 new tests in
  `tests/unit/run-contract.test.js`); full gates green —
  `.scratch/orchestration/run-contract-impl-2026-09-19/` (`B8-dual-axis-review.md`,
  `root-npm-test.log`, `gates.log`, `eslint.log`). Implementation choices the
  review recorded: argv `[]` for shell-string commands; `constraints`/`context_scope`/
  `contextHash` null until their owning surfaces derive them; grant selection by
  mutual binding (R-AD-6) with R-AU-3 refusals evaluated against the selected
  grant; `rejected` settlements excluded from `attempts_settled_total` so
  `settled ⊆ admitted` holds; dry-run projects an open capture as a resume.
- Blockers: the session's two human route gates (`user-approval-plan`,
  `user-approval-implement`) await the user — the worker does not self-approve.
- Next Action: user approves the two gates, then `amber session complete`.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  slice; do not regenerate unless the plan file is missing.

## Evidence Schema

- Command: npm test / node scripts/run-tests.js tests/unit/<suite> / npm run manifests / npm run doctor / npm run gen:agents:check
- Result: pass/fail counts + exit codes per gate, logged under .scratch/orchestration/run-contract-impl-2026-09-19/
- Date: 2026-09-19
- Notes: per-slice targeted suite commands recorded beside the logs; two-axis review verdict in the same directory.
