# ADR-0004: Evidence-Grade Verification

## Status

Accepted (2026-07-03)

## Context

`amber session verify` recorded `--command` and `--result` as free text without
running anything. An agent that would falsely claim "tests pass" could record that
claim unchanged, and the tamper-evident session ledger then protected a statement
with no evidence behind it. `complete-check` accepted the claim as "verification
present", so an empty repository reached a passing `--strict` check.

The four-gate governed runner (ADR-0003) already executes policy-gated commands and
records them to a hash-chain ledger, but it runs mutating commands in an isolated
worktree behind an explicit approval — the wrong shape for verification, which reads
the working copy and is not itself a mutating action.

## Decision

Add `amber session verify --execute`. It runs the verification command **in the
working copy** (`cwd = target`) behind two of the four governance gates:

1. **Policy gate** — the command must satisfy `.amber/governance/rules.json`
   (deny-wins, default-deny), reusing `loop-policy.js`. A disallowed command is
   refused and recorded as `verification_denied`; nothing runs.
2. **Tamper-evident ledger** — the real exit code is appended to the session
   `ledger.jsonl` as `verification_passed` or `verification_failed`, reusing
   `loop-ledger.js`.

The worktree-isolation and approval gates are intentionally **not** applied:
verification reads the working tree in place, and collecting evidence is not an
action that needs human approval.

A non-zero exit records `verification_failed` on the timeline, does **not** mark the
stage complete, and exits non-zero. Without `--execute`, verify keeps its legacy
claim behavior but tags the event `executed: false`, so `complete-check --strict`
can require executed evidence (see the completion-check change).

This is human-triggered, policy-gated, in-place execution — NOT scheduling, NOT
autonomous work, NOT an agent runner. It sits in the Verification control layer.

## Consequences

- The product's "prevent false completion" claim gains real teeth: `--strict`
  completion now requires a command that actually ran and exited zero.
- `rules.json` becomes load-bearing for verification. The shipped default denies
  everything except a narrow allow-list (`npm test`, `npm run doctor|manifests`,
  `node scripts/amber.js …`); projects extend it for their own test command.
- Reused primitives keep the gate logic in one place (`loop-policy` + `loop-ledger`),
  shared with the governed runner.
