# Plan: F064 suggestion-review close-out (trusted-control packet follow-up backlog)

Feature: F064
Status: accepted
User Confirmation: confirmed

## Goal

Close the four open items in the trusted-control packet follow-up backlog
(`.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4/results/Follow-up-backlog.md`)
so the `trusted-control-evolution-contract` spec and its delivered code agree
explicitly, and the suggestion-review audit trail can represent a retry. The
web-visible card behavior is unchanged by every item.

1. **V1 evidence strictness (spec amendment).** Spec §6 V1 said "≥1 resolvable
   evidence reference"; the delivered `evolution-validity.js` requires every
   supplied reference to resolve. Amend §6 so the tightened reading is the
   normative text (≥1 supplied AND every supplied reference resolves). Rationale:
   citations are regenerated per scan from the signals themselves, so a dead
   citation signals a real defect worth refusing (the admission boundary's stated
   design); the strict behavior is the shipped, fully-tested behavior; the spec
   is canonical, so the disagreement is resolved on the spec side with zero
   regression risk.
2. **§8.6 write shapes (spec precision amendment).** Apply/Undo/Dismiss mutate a
   target before the audit append and use precheck + compensation. Promotion
   (`proposed`), admission validation (`validated`), and the admission validity
   rejection (`rejected`) are audit-only writes: the governed append IS the first
   durable write and already refuses fail-closed (lock, chain, ceiling) before
   any byte lands; there is no target mutation to precheck or compensate, and a
   caller-side pre-probe could false-refuse a dedup-skipped promotion. Amend §8.6
   to name the two shapes explicitly instead of implying promotion follows the
   precheck shape.
3. **Retry representable in the ledger (code change + spec §8.2 rounds).** A
   retry whose cluster evidence changed (different evidence digest or host set)
   opens a new proposal round: a second `proposed` event carrying the retry's own
   digests, followed by its own outcome. An unchanged re-surface rides the
   existing record (no second `proposed`), so repeated scans of a stable rejected
   cluster never grow the ledger. `validated` belongs to the current round only;
   validity rejections dedupe once per round. Fold integrity clauses and writer
   guards stay aligned; the folded record gains additive counters
   (`proposalCount`, `rejectionsSinceLastProposal`).
4. **Apply stale-branch rollback contract (test + comment, no behavior change).**
   The committed code already wraps the stale-refusal branch inside the commit
   loop's fail-closed catch, so a double failure (stale refusal + failing
   `rollback`) routes through `compensateApply`/`commitIoFailed` and returns the
   explicit `commit-io-failed`/`commit-io-degraded` result — it does not throw
   loudly, contrary to the recheck's residual observation. Add the regression
   tests that prove both compensated and degraded outcomes, and a comment naming
   the contract at the branch.

## High Level Design

- Context: post-land dual-axis review (`Final-codex-dual-axis-review.md`) confirmed
  three spec semantic concerns; the FINAL-ACCEPT recheck added the stale-branch
  hardening candidate. The packet plan (`docs/plans/trusted-control-evolution.md`)
  stays the authority for slices 1–6; this close-out is Slice 7 there and a
  standalone gate-format plan here.
- Proposed approach: two spec amendments + one ledger semantic extension
  (rounds) with its fold/guard/`.d.ts`/test surface + regression tests for the
  Apply stale branch. No event payload or schemaVersion change (old ledgers fold
  identically; the extension is backward compatible by construction).
- Risks: (a) round-opening keyed on evidence digest + hosts — operations are
  excluded because the planner's wiki body embeds the plan date, which would
  otherwise reopen a round daily for a stable rejected cluster; the new round's
  event still records current operations/attribution digests. (b) One existing
  review test expects `['proposed','rejected','validated']` for a
  changed-content retry; it now correctly gets a second `proposed` and is updated
  with justification. (c) Guard/fold drift — the fold re-derives every writer
  constraint, so a mismatch fails the chain walk, not silently passes.

## Context manifests

Knowledge surfaces only (specs, ADRs, plan contracts); code paths ride F064's booked paths.

- implement: docs/specs/trusted-control-evolution-contract.md, docs/specs/F064-improvement-suggestions.md, docs/plans/trusted-control-evolution.md, docs/adr/0028-ledger-family-factory-and-decision-primitives.md, docs/adr/0018-governed-memory-layer.md
- review: docs/specs/trusted-control-evolution-contract.md, docs/adr/0028-ledger-family-factory-and-decision-primitives.md, docs/plans/trusted-control-evolution.md, docs/plans/F064-suggestion-review-closeout.md

## Vertical Slices

- [x] Slice 1: spec amendments — §6 V1 tightened reading (normative), §8.6 two
  write shapes, §8.2 proposal rounds, §5 stage-2 retry pointer, header note;
  `evolution-validity.js` header cites the amended §6.
- [x] Slice 2: ledger proposal rounds — `ledger-suggestion-review.js` fold
  clauses, writer guards, the three ensure/record functions, additive fold
  fields; `web-adapter.d.ts` record type gains the counters.
- [x] Slice 3: tests — new retry-round suites (unchanged re-surface rides the
  record; changed evidence opens a round and re-records its own rejection;
  validated-after-rejection refused until re-proposal), the updated
  changed-content-retry expectation, and the Apply stale-branch double-failure
  tests (compensated + degraded) in `suggestions-apply.test.ts`; `apply.ts`
  branch comment.

## Resume Checkpoint

- Resume Point: all slices delivered; full gates green on the final tree (see `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4/results/B7-*.log` and `B7-dual-axis-review.md`).
- Blockers: the governed session's two human route gates (`user-approval-plan`, `user-approval-implement`) await the user — the worker does not self-approve (operating manual §7).
- Next Action: user approves the two gates (`amber session approve --session 41106dbc-c647-4c58-abad-a814582c2b96 --gate <id>`), then `amber session complete`.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Spec and code agree explicitly on V1 strictness, §8.6 write shapes, and §8.2
  proposal rounds; every amendment names its provenance (post-land review backlog).
- A changed-evidence retry is representable end to end: second `proposed` with
  its own digests, own validation or rejection, deduped per round; an unchanged
  re-surface appends nothing; a stable rejected cluster never grows the ledger.
- A currently-applied fingerprint never re-proposes; undo → re-apply keeps
  working on the same proposal round.
- The Apply stale-branch double failure returns `commit-io-failed` or
  `commit-io-degraded` (never a throw, never silent), proven by regression tests.
- Web-visible card behavior unchanged; no new CLI verb, MCP Action, schema file,
  or `amber next` change.
- **Phase boundary:** this close-out stays inside the trusted-control evolution
  contract's existing surface — spec text, the suggestion-review ledger fold, and
  their tests. It ships no new product behavior and no new default CLI verb, so
  the accepted F064 web mount is unchanged by this phase.
- Existing Amber guardrails still pass: root `npm test`, apps/web vitest,
  `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`, typecheck,
  targeted ESLint.

## Verification

- apps/web vitest: suggestions-review (rounds), suggestions-apply (stale branch), plus the full web suite.
- Root: npm test (full, logged to file), npm run manifests, npm run doctor, npm run gen:agents:check, npm run typecheck.
- Targeted ESLint on changed JS/TS files.

## Evidence Schema

- Command: npm test / apps/web vitest run / npm run manifests / npm run doctor / npm run gen:agents:check / npm run typecheck
- Result: pass/fail counts + exit codes per gate, logged under .scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4/results/
- Date: 2026-09-19
- Notes: session id, changed-file scope, and the adjudication of any red test (flake vs. regression) recorded beside the logs.
