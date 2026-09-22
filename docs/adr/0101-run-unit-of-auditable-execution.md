# ADR-0101: Run Is the Unit of Auditable Execution, With Its Own State Machine

**Status:** Proposed (2026-09-22)
**Date:** 2026-09-22
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
   strangler rule, and `src/` today holds only auxiliary modules) with the same discipline as
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
