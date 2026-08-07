# ADR-0011: Safety Philosophy Upgrades — Confidence Gating and Explicit Fail-Closed (T1)

**Status:** Accepted
**Date:** 2026-08-07
**Builds on:** ADR-0003 (governance-gated execution), ADR-0005 (experimental execution removal).
**Scope:** wayfinder map #102, T1.

---

## Context

ADR-0001 committed Amber to "trust and inspectability over automation velocity": the layer produces
only inspectable artifacts (plan/report/ledger) and never runs dynamic workflows or schedules live
agents. ADR-0003 then opened a narrow, gated governed-execution surface (`loop run --execute`,
route command-stages) behind five preconditions. ADR-0005 deleted the autonomous executor entirely.

Two gaps remain in the safety posture:

1. **Execution shape is binary, not graded.** Today a governed command either runs or it does not.
   There is no declared policy for the *intermediate* cases — a plan exists but has not passed its
   gate, or a route template has never been verified. The natural response is to degrade the *shape*
   of execution (dry-run instead of run) rather than to make an all-or-nothing choice with no
   guidance for the middle band.
2. **Fail-closed is implicit, not explicit.** The existing gates fail closed in practice (missing
   policy file → built-in defaults; failed worktree creation → abort), but these behaviours are
   scattered across implementations and could silently acquire a "degrade to main branch" or
   "run without policy" escape hatch during future maintenance. The safety property must be a
   stated, auditable invariant, not an accident of the current code.

The OWASP ASI frame and Amber's own evidence model (hash-chain ledgers, verification evidence)
agree on the same ordering: **uncertainty flows downward, never upward.** A low-confidence decision
must never escalate toward more autonomous execution; it must only fall toward more review.

## Decision

### 1. Confidence-driven execution shape (degradation, never escalation)

Each governed request is classified into one of three confidence bands, and the band determines the
maximum execution shape allowed:

| Confidence | Preconditions | Allowed execution shape |
| --- | --- | --- |
| **High** | Verified route template exists **and** plan has passed its plan gate | Governed execution (the ADR-0003 surface: policy + approval + worktree + ledger) |
| **Medium** | Plan exists but has not passed its gate | **Dry-run only** — plan/report is produced, nothing executes |
| **Low** | No plan, or no standard/route match | **Human review; execution refused** — an explicit owner decision is required before any governed execution may be considered |

The invariant is **"uncertainty flows downward, never upward"**: a request can only move from a
higher confidence band to a lower one (High → Medium → Low) as gates fail or evidence is missing.
There is no path from Low/Medium to High except the completion of the *actual* preconditions
(a passed plan gate, a verified route template) — never by overriding the band.

### 2. Explicit fail-closed

The following gates are **fail-closed by declaration**, not by default. Each failure mode aborts
the attempt and refuses to proceed; there is **no permissive-mode downgrade path**:

- **Worktree creation failure → refuse execution.** A failed `git worktree` creation must never
  degrade to running the command on the user's main checkout.
- **Policy file missing → refuse.** A missing/unreadable `rules.json` must not cause the governed
  surface to run "without a policy"; it falls back to built-in deny-by-default rules, and the
  failure is surfaced as an explicit diagnostic so the operator knows their custom policy is not
  in force.
- **Hash-chain verification failure → refuse and flag potential tampering.** A broken ledger chain
  (failed `verifyLedgerChain`) blocks the governed surface and raises a `ledger-tampered` finding;
  evidence continuity is a precondition, never a post-hoc note.
- **All gate checks are fail-closed.** A check that cannot run, cannot be evaluated, or is missing
  its inputs yields the same outcome as a failed check. There is no "warn but continue" escape
  hatch on the governed surface.

### 3. Agent dispatch requires_approval marker

Dispatch records for **swarm-class** operations (multi-worker, or any dispatch whose worker set or
command falls below the high-confidence band) carry a `requiresApproval: true` marker. The marker is
a first-class field on the dispatch record (`scripts/lib/core/agent-orchestration.js`,
`dispatchAgentTask`), defaulting to `false` and set to `true` when the caller passes
`options.requiresApproval`. A low-confidence swarm does not execute a swarm at all — it degrades to
a **bounded loop** (a single, hard-stopped, reviewable loop contract) that never impersonates a
parallel dispatch. The marker makes the approval requirement visible in the artifact, so any
consumer (report, audit, handoff) can see that human approval is a precondition of the dispatch.

## Consequences

**Positive.** The confidence bands give operators and downstream tooling a single, legible answer
for every governed request, including the middle band (dry-run) that previously had no defined
shape. Fail-closed becomes a documented invariant that audits can check against, closing the
"degrade to main branch" / "run without policy" class of future regressions. The
`requiresApproval` marker is machine-readable evidence of human-approval requirements on swarm
dispatches.

**Negative.** Some requests that a permissive policy might have allowed will now refuse (low
confidence) or downgrade (medium confidence) instead. This is the intended cost: the philosophy
explicitly trades convenience for the absence of autonomous escalation.

**Neutral.** Existing governed-execution preconditions (ADR-0003) are unchanged; the bands are a
*grading* layer on top of them, not a replacement. `executesAnything: false` keeps its meaning.

## Related

- [ADR-0001](0001-governance-first-artifact-first.md) — governance-first, artifact-first (the
  "trust and inspectability" root this ADR operationalizes).
- [ADR-0003](0003-governance-gated-execution.md) — the governed-execution surface the high-confidence
  band may use.
- [ADR-0005](0005-experimental-execution-removal.md) — why no autonomous executor exists and why
  escalation paths are forbidden.
- Implementation: `scripts/lib/core/governance-readiness.js` (`computeConfidenceClasses`),
  `scripts/lib/core/loop-policy.js` (optional `confidence_gating` block),
  `scripts/lib/core/agent-orchestration.js` (`requiresApproval` dispatch field),
  `tests/governance-confidence.test.js`.
