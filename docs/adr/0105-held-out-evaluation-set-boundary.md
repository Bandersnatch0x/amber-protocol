# ADR-0105: Held-Out Evaluation Sets Live Outside the Run Workspace as Pinned Governed Artifacts

**Status:** Proposed (2026-10-19)
**Date:** 2026-10-19
**Builds on:** [ADR-0100](0100-harness-contract.md) (contract as the immutable boundary),
[ADR-0104](0104-provider-enforcement-level.md) (provider enforcement level),
F077 (eval-result binding), F069/F071 (context firewall), F070 (prepared workspaces),
`issues/0053` (ContextSnapshot ≡ Loadout).

---

## Context

Increment D needs a held-out evaluation set that the agent under test cannot read, plus a leak
check. Where that set lives decides whether it leaks. The run workspace is a git worktree at
`.amber/worktrees/<sessionId>`; `.amber/` is gitignored, so it is outside the tracked tree — but
a held-out set placed anywhere in the tracked tree would be checked out into that worktree and
become trivially readable. F077 already establishes the pattern of binding a **committed,
revisioned, content-addressed artifact** by `{identity, revision}`
(`resolveEvalResultBinding`). The question is whether held-out content follows that pattern, sits
in the tracked tree, or is supplied per-run.

## Decision

1. **Held-out sets are committed governed artifacts**, revisioned and content-addressed, pinned
   by `{identity, revision}` exactly as F077 binds an eval-result. Not a plain file in the
   tracked tree, not per-run ad-hoc input.
2. **They live outside the run workspace** — Amber-controlled state, never inside the prepared
   worktree. A tracked-tree fixture is disqualified because the worktree checkouts it.
3. **Reachability is governed by the declared context scope and the filesystem deny list**,
   whose strength equals the provider capability (ADR-0104). Under `enforced`, a read is denied;
   under `observed-only`, a read is observable but not prevented.
4. **The leak check is the backstop.** It fails the eval when held-out content appears in the
   run's accessible context or events — the control that still holds when the provider is only
   `observed-only`.
5. **No held-out binding → the eval axis is `not-run`, never `pass`.** Absence of a held-out set
   is disclosed, not assumed clean.

## Consequences

- The set is auditable and reproducible (pinned by revision), unlike per-run input.
- Its protection is honestly bounded by provider capability: `observed-only` providers get
  detection, not prevention — and the receipt says so.
- The leak check must read the same context/event surfaces the run could reach, so it shares the
  context-firewall seam rather than inventing a second one.

## Rejected alternatives

- **Tracked-tree test fixtures.** Checked out into the worktree, readable by construction.
- **Per-run ad-hoc input.** Unauditable and unreproducible; nothing binds what was held out.
- **Relying on the provider deny list alone.** Under `observed-only` there is no enforcement, so
  a backstop is required; the deny list is the primary control, not the only one.
- **A second, held-out-specific context surface.** Duplicates the firewall seam (DRY) and would
  drift from the surfaces the run actually reads.
