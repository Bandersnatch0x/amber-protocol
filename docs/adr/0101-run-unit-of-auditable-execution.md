# ADR-0101: Run Is the Unit of Auditable Execution, With Its Own State Machine

**Status:** Accepted (2026-09-22)
**Date:** 2026-09-22
**Approved by:** Project lead via F065 HITL (`issues/0069`, 「按推荐」) — the same ruling that
accepted `docs/specs/F065-harness-h0-foundation.md`; recorded here on 2026-10-21.
**Amended by:** 0176 (2026-10-20) — `settling` as the tenth state, below.
**Builds on:** [ADR-0100](0100-harness-contract.md) (HarnessContract),
[ADR-0003](0003-governance-gated-execution.md) (governed execution),
[ADR-0029](0029-named-governed-commands-and-stage-verbs.md) (stage verbs), the session
state-machine SSOT (`scripts/lib/session-state-machine.js`, CONTEXT.md), and the Harness v2
proposal §4.4/§6/§14/§52.

---

## Context

V2.2 separates **Task ≠ Run**: one task may produce many runs, and a Run is the auditable,
replayable unit of agent work (attempt, tools, context, decisions, evidence). Today that role
is split across session records (continuity, settled state machine), loop records
(governed one-shot execution), and execution records (F062 stage verbs). None is a
run-scoped execution unit bound to an immutable contract. H0 must introduce Run without
mutating the settled session contract, and must not fork the session state machine's SSOT
rule (web console must not keep a second allow-table — CONTEXT.md).

## Decision

1. **Run is a new record**, `schemas/run.schema.json`, `apiVersion: amber.dev/v1`, persisted
   under `.amber/harness/runs/` with a unique id, `subject` (agent/session/task refs),
   `harness` refs (contract snapshot hash, policy ref), `execution` ref, `events` stream ref,
   `evidence` ref, and `outcome`. One task → many runs; every terminal state is a record;
   runs are never edited after completion.
2. **A separate nine-state machine** (`CREATED`, `ADMITTED`, `RUNNING`, `PAUSED`, `BLOCKED`,
   `FAILED`, `COMPLETED`, `CANCELLED`, `EXPIRED`) lives with the governed core modules under
   `scripts/lib/harness/` (the repo's core home, covered by the state-dir seam guard; amended
   2026-09-22 — the Harness v2 proposal's `src/` target layout stays aspirational per its own
   strangler rule, and `src/` today holds only auxiliary modules; amended 2026-10-20 — `SETTLING`
   is the tenth state, so the shipped set is the ten in the Amendment below, never the nine
   listed here) with the same discipline as
   the session machine: exported `STATES`/`TRANSITIONS`/`isLegalTransition`/`legalTargets`/
   `isFinal`, illegal transitions rejected, pause/resume and failure/block distinction,
   immutable run identity. **The session machine is not modified in H0.** Mapping between
   session stages and run states happens in the vertical-slice adapter only.
3. **Runtime may only**: emit events, request tools/context, request approval, pause, fail,
   complete. It may never self-approve, silently widen scope, mutate immutable snapshots, or
   delete evidence.
4. **Legacy mapping is declared, not improvised** (proposal §52): `loop` record →
   `Task + Run + Evidence`; `session` → `Session`; `execution` → `ExecutionContract +
   ExecutionRun`; `result` → `ValidationReceipt`. The mappings land as adapters in the
   vertical-slice ticket, each with a conformance test.

## Consequences

Auditable execution gets a dedicated spine that can later carry replay (H5) without touching
continuity semantics. The cost: two state machines now coexist; the mapping adapter is the
single sanctioned bridge and must be the only place that translates between them.

## Rejected alternatives

- **Extending the session state machine with run states** couples continuity lifecycle to
  execution lifecycle and risks the established `created → routed → executing` contract.
- **Making Run an alias of session** — a session spans framing/approval/review; a run is one
  bounded execution; merging them loses both.
- **Free-form run states** — the closed state set is what makes BLOCKED/FAILED distinguishable
  and makes drift detectable.

---

## Amendment (0176, 2026-10-20): settling phase

Per `docs/specs/harness-execution-trust-hardening.md` R-ET-6 and
`docs/plans/harness-execution-trust-hardening.md` (`## Vertical Slices`, increment F), this ADR is
amended in place to add a tenth state, `SETTLING`, between `RUNNING` and the terminal states.

**Why.** Decision 2's nine states let `RUNNING → COMPLETED` fire directly, so `completed` reads
as two different claims at once: "the execution stopped" and "the work is done". A reader cannot
tell a converged run from one that finished without settlement (F081). The fix belongs in the
state set, not in a second field: a `converged: true` flag would be a boolean every writer must
keep in sync with `state`, the exact drift ADR-0101 rejected free-form states to prevent.

**The amended machine.**

```
RUNNING  → {PAUSED, BLOCKED, FAILED, CANCELLED, SETTLING}
SETTLING → {COMPLETED, FAILED, CANCELLED}
```

The rest is unchanged: `CREATED → ADMITTED → RUNNING`, `PAUSED → RUNNING`, `BLOCKED → RUNNING`,
and `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED` stay final. `RUNNING → COMPLETED` is removed;
`RUNNING → SETTLING` and `SETTLING → {COMPLETED, FAILED, CANCELLED}` replace it. The three
absences are deliberate:

1. **`RUNNING → SETTLING` is the only path to `COMPLETED`.** Settlement is the step where the
   attempt is closed, the receipt is written, and the outcome is cited; a run that skips it has
   no settled evidence to call its own.
2. **`SETTLING → RUNNING` is illegal.** The execution window is closed at this point. Reopening
   it would make "this run converged" unfalsifiable, because the run could keep working after
   the claim.
3. **`BLOCKED → SETTLING` is illegal**, for the reason the original machine already gives for
   `BLOCKED → COMPLETED`: unblocking precedes completion. `PAUSED → SETTLING` is illegal for the
   same reason: a paused run has not converged, so it resumes first.

**Only `COMPLETED` is gated.** `FAILED`, `CANCELLED`, and `EXPIRED` remain reachable from
`RUNNING` directly, because each already means "did not converge". Forcing a failure through a
settling phase would manufacture a stage whose evidence does not exist. `SETTLING` may therefore
be brief or immediate, and a run may reach `COMPLETED` in the same command that entered
`settling`. The amendment gates reachability, never dwell time: a required pause would turn
every successful run into an approval ceremony the spec does not ask for.

**The receipt stays independent (R-ET-6.3).** The ValidationReceipt's verdict is derived from its
own checks and evidence, never from the run's terminal state (ADR-0004, F073, R-ET-2.3). A
`completed` run may carry a `fail` receipt and a `failed` run a `pass` one: `completed` says
execution converged, the receipt says what the evidence showed. `gateVerdict` already reads
`run.state === "blocked"`; it gains no `settling` branch, because settlement is not a gate
outcome.

**Rejected alternatives.**

- **A `converged` boolean on the run record** — a second source of truth for a fact the state
  must encode, and the drift mode Decision 1's closed-state rule exists to prevent.
- **`settling` in place of `running`, as a sub-phase of execution** — the two answer different
  questions (is work happening, is the result being fixed); merging them removes the boundary
  the amendment exists to draw.
- **Gating `failed`/`cancelled`/`expired` through `settling`** — invents a settled outcome for
  runs that did not converge, and would leave `BLOCKED → SETTLING` the only escape from a
  violation, contradicting the BLOCK posture.
- **A required dwell in `settling`** — adds an approval step per successful run with no evidence
  requirement behind it. R-ET-6 asks that `completed` be unreachable without settlement, not
  that settlement wait.
- **A new ADR with an `Amends:` header** — reserved for reversing a standing prohibition
  (ADR-0103); adding a state extends the decision, so the in-place amendment is correct
  (ADR-0001 ← ADR-0019, 0047).

**Impact.** `scripts/lib/harness/run-state-machine.js` (state set + two edges),
`scripts/lib/harness/run-core.js` (the transition's event kind), `schemas/run.schema.json` (the
closed `state` enum), `schemas/event.schema.json` and `scripts/lib/harness/event-ledger.js`
(`HARNESS_EVENT_TYPES`) for the new event kind, and the callers that bind a real outcome
(`scripts/lib/harness/loop-adapter.js`). ADR-0102's closed event enum grows by one additive
entry; pre-amendment run records stay readable, since no existing state value changes meaning.
