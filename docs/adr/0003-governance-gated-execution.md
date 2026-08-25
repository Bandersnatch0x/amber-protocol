# ADR-0003: Governance-Gated Execution (L2)

**Status:** Accepted
**Date:** 2026-06-30
**Supersedes (in part):** ADR-0001's absolute "without executing Dynamic Workflows" clause, for
approved loop-contract commands only.
**Builds on:** ADR-0002 (execution reserved for V2 under governance constraints).

---

## Context

ADR-0001 chose "trust and inspectability over automation velocity" and forbade execution outright.
ADR-0002 then cold-stored the execution modules in `src/experimental/execution/` and explicitly
reserved execution for a future version *under governance constraints* (`plan → review → approve →
execute`).

Two forces make a first execution step worthwhile now:

1. **The OWASP Top 10 for Agentic Applications (2026, ASI01–ASI10) reality.** Most ASI risks are
   mitigated only at *runtime* (inbound-prompt filtering, tool-call wrapping, circuit breakers). A
   purely static layer cannot touch them. An honest coverage report (`amber governance standards`)
   makes this explicit rather than pretending static governance is enough.
2. **`LOOP.md`'s L1→L2→L3 rollout.** L2 ("assisted: worktree + human approval before commit") is the
   intended next step, and it requires *some* governed execution.

The risk is obvious: Amber's trust comes from "it does not execute." Any execution must therefore be
narrow, gated, and clearly distinct from becoming an agent runtime.

## Decision

Amber MAY execute the command a loop contract declares in its **`governed.command`** field, via
`amber loop run --execute`. This is an **evolution** of ADR-0001 (still governance-first), not a
pivot to a runtime: Amber governs *its own maintenance loops*, it does not intercept other agents'
tool calls.

Execution is permitted **only when all five preconditions hold**:

1. **Declared** — the command is the contract's `governed.command` (not supplied ad hoc on the CLI).
2. **Policy-passed** — it satisfies `.amber/governance/rules.json` (deny-wins, `defaultAction: deny`).
3. **Approved** — an unconsumed `amber loop approve` record exists (one approval ⇒ one execution).
4. **Isolated** — it runs in a dedicated git worktree; the user's main checkout is never the cwd.
5. **Recorded** — every attempt (allowed, denied, executed) appends to a tamper-evident hash-chain
   ledger that `amber loop verify-ledger` can check.

`executesAnything: false` in the loop-contract schema is **preserved** and keeps its meaning — the
loop never runs anything on its own. A `governed.command` run is human-triggered and human-approved,
an orthogonal axis.

## Still forbidden (unchanged boundary)

- Scheduling / cron / daemon / hook-triggered execution (no unattended runs).
- External writes: PRs, issue trackers, notifications, account-bearing CLIs.
  - Boundary clarification ([ADR-0020](0020-governed-live-git-transport.md), adjudicated
    2026-08-25): pushing the repository's own `.amber/sync` tree to its own already-configured
    origin is **not** an external write in the forbidden class — it is self-owned governance state
    published through the same governed-execution gates as any other typed mutation, and only under
    ADR-0020 Stage B. Writes to any third-party surface (a caller-supplied remote URL, a PR, a
    tracker) remain forbidden.
- Auto-approval, or self-approval by loop output.
- Interception or wrapping of another agent's tool calls (the "runtime governance" market — out of
  scope; we complement Codex/Claude Code rather than compete with them).
- Running arbitrary, unlisted commands (default-deny).

## Consequences

**Positive:** a real, auditable L2 capability; `governance standards` can honestly claim coverage of
ASI04 (supply-chain command pinning), ASI06 (traceability), and ASI09 (human approval); the
experimental execution primitive is revived behind gates instead of rotting.

**Negative:** the "we never execute" one-liner is no longer strictly true and must be stated
precisely everywhere (README, SPEC, CLAUDE.md). The hash-chain detects tampering but does not prevent
a full-file rewrite (needs external anchoring — out of scope; stated honestly in docs).

**Neutral:** default `loop run` remains dry-run; nothing executes without `--execute` + approval.

## Addendum (2026-06-30) — Phase 3: route command-stages as a second consumer

The four gates were extracted into a reusable `runGovernedCommand` primitive
(`scripts/lib/core/governed-runner.js`). Loop governed execution now calls it (zero behaviour
change), and **route `command`-stage execution** is the second consumer: `amber route test <route>
--execute --stage <name>` runs a stage's `target` under the same policy / approval / worktree /
ledger gates, recorded in a route-scoped ledger (`.amber/routes/<routeId>/ledger.jsonl`).

This changes **nothing** about the boundary: the five preconditions still all hold (declared =
`stage.target`; policy; approval; worktree; ledger). It only proves the gates are general
infrastructure rather than loop-specific. Non-`command` stages (pack/skill/gate) refuse `--execute`.
The session `verify`/`approve` human-record flow is untouched; whole-route or whole-session
auto-execution remains disallowed.

## Related

- ADR-0001 (governance-first, artifact-first)
- ADR-0002 (V2 execution scope — experimental isolation)
- Design spec: `docs/superpowers/specs/2026-06-30-amber-governed-loop-execution-design.md`
- `LOOP.md` (L1→L2→L3 rollout)
