# Amber Agent Operating Manual

Last Reviewed: 2026-07-08

This manual captures the operating rules an agent should carry when working on
Amber Protocol. It is process documentation, not a command reference. Use it to
keep agent work reviewable, gated, evidence-backed, and handoff-ready.

## 1. Identity And Boundary

Amber Protocol is a repository-local governance layer for agent-assisted
engineering. It is not a general agent framework, live orchestration runtime,
CI replacement, project-management system, or automatic execution platform.

Default goals:

- Constrain agent work inside explicit policy boundaries.
- Verify repository state before claiming readiness.
- Record inspectable evidence for important claims.
- Produce artifacts another human or agent can review.
- Preserve handoff state outside chat history.

Default prohibitions:

- Do not auto-execute dynamic workflows.
- Do not dispatch live agents as a hidden side effect.
- Do not auto-rewrite existing project documents.
- Do not create external PRs, issues, notifications, or account-bearing side
  effects without an explicit integration contract and approval gate.
- Do not run high-risk commands without approval, isolation, and evidence.

## 2. Control Layer Priority

When two choices conflict, use this priority order:

1. Governance: approval records, policy boundaries, adoption controls.
2. Verification: doctor, audit, validation, review, and gate surfaces.
3. Observability: timelines, manifests, ledgers, reports.
4. Lifecycle: routes, sessions, checkpoints, worktrees.
5. Context: wiki pages, starter docs, manifests, handoff artifacts.
6. Tooling: CLI commands, schemas, validators, workflow packs.
7. Execution: minimal, explicit, and governed.

If faster execution conflicts with clearer governance, choose governance.

## 3. Standard Lifecycle

Use this lifecycle unless the user or route explicitly narrows the work:

```text
audit -> init -> plan -> gate -> verify -> approve -> handoff
```

Operating rules:

- Inspect state before proposing mutation.
- Prefer read-only and dry-run commands before writes.
- Create or validate the plan before implementation.
- Treat gates as real checkpoints, not narrative headings.
- Record evidence before marking work as passing, accepted, or done.
- Leave handoff state before ending a session.

## 4. Route-Specific Discipline

### Feature Work

1. Capture requirements.
2. Create a plan.
3. Get plan approval.
4. Implement the approved slice.
5. Verify behavior and record evidence.

### Bug Fixes

1. Reproduce the bug first.
2. Record the failing behavior.
3. Get approval to apply the fix when a gate requires it.
4. Apply the smallest fix that addresses the reproduced failure.
5. Verify the regression is gone.

### Refactors

1. Characterize existing behavior before restructuring.
2. Get approval before changing structure when the route requires it.
3. Refactor under a test or verification safety net.
4. Verify behavior did not change except where explicitly intended.

## 5. Evidence Rules

Any claim that work is complete, passing, accepted, ready, or safe must carry
evidence.

Good evidence includes:

- The command, inspection, or review that was performed.
- The result, exit code, or observed state.
- The relevant file path, session id, ledger entry, or timestamp.
- Remaining risk, blocker, or scope limitation.

Without evidence, a passing or accepted state is only a claim.

## 6. Approval Rules

Approval is a reviewable artifact, not a vague impression from chat.

Require explicit approval for:

- File mutation when policy requires it.
- Command execution behind governed gates.
- External writes or notifications.
- Issue, branch, commit, or PR creation.
- Dependency, permission, secret, migration, or release changes.
- Destructive git or filesystem operations.

One approval authorizes one governed execution. A repeat run needs a new
approval.

## 7. Governed Execution Gates

Execution is allowed only when every required gate passes:

1. Policy gate: the command is allowed by policy; deny wins; default-deny is the
   safer posture.
2. Approval gate: an unconsumed human approval exists.
3. Isolation gate: mutating work runs in an isolated git worktree, not the main
   checkout.
4. Evidence gate: the attempt is recorded in a tamper-evident ledger.

If any gate is missing, fall back to dry-run, inspection, or report-only mode.

## 8. Handoff Rules

A session is not handoff-ready until another human or agent can continue without
reading the chat transcript.

Handoff state must include:

- Current goal.
- Work completed.
- Current feature or session status.
- Verification evidence.
- Blockers.
- Next action.
- Recovery instructions.

## 9. Wiki And State Separation

Stable knowledge belongs in the Wiki. Current state belongs in feature state,
progress files, session manifests, handoff files, and ledgers.

Do not put temporary status into durable architecture pages. Do not invent
architecture, commands, or business rules for the Wiki. Unknowns must be marked
as needing confirmation.

## 10. Continuous Improvement Slice

When running continuous improvement work:

1. Read the current agent entrypoints, progress, handoff, feature state, Wiki
   index, and loop state.
2. Inspect the worktree. Treat pre-existing dirty files as user-owned.
3. Select one coherent, high-value, low-risk slice.
4. Write a contract: goal, scope, files, verification, stop conditions.
5. Implement only that slice.
6. Run a separate review pass.
7. Verify with the narrowest reliable command or file evidence.
8. Update progress, handoff, evidence, and loop state when project state changes.

## 11. Web Viewer Product Rules

When changing `apps/web`, keep the viewer data-first and developer-native:

- Every pixel should serve information delivery.
- Prefer dense, predictable tool surfaces over marketing-style composition.
- Loading, error, empty, and live states are first-class.
- Semantic colors communicate state only.
- Avoid flashy gradients, hero metrics, heavy shadows, excessive animation, and
  decorative UI that competes with the data.

## 12. Failure Patterns

Stop and re-check the work when any of these appear:

- Implementation starts before the plan or gate is clear.
- A dry-run result is described as if real execution happened.
- A completion claim has no evidence.
- Chat history is treated as a durable handoff.
- User-authored files are overwritten or normalized without approval.
- A worker reviews or approves its own output.
- A route or workflow pack is treated as a live execution engine.
- Policy, approval, isolation, or ledger requirements are bypassed for speed.
- A future or out-of-bound capability is documented as already supported.

## 13. Core Maxim

Execution is cheap. Trusted execution requires artifacts, gates, evidence, and
handoff.
