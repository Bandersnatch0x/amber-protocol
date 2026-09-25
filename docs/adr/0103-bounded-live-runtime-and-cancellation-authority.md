# ADR-0103: Bounded Live Runtime and Cancellation Authority

**Status:** Accepted
**Date:** 2026-09-24
**Approved by:** Project lead via F079 HITL (`issues/0130`, 「全部按推荐」)
**Amends:** ADR-0003 (scheduling remains forbidden except for this bounded maintenance runtime); ADR-0005 (the deleted experimental runtime stays deleted; no code resurrection)
**Builds on:** ADR-0100/0101/0102; F065–F078; Team Replication Layer Charter

---

## Context

Harness v2 H0–H6 and its named close-out work are complete. The architecture source
allows H7 discussion only after Isolation, Evidence, Approval, Connector, Budget,
No-progress, Replay, and Reviewer Gate are stable; its first candidate is explicitly
limited to **read-only maintenance proposal generation**.

The current Charter and operating manual still reject every scheduler/daemon. That
blanket rejection was correct before H0–H6, but it now conflates two different things:

1. an autonomous agent runtime that launches target-project commands, agents, dynamic
   workflows, external effects, PRs, or notifications; and
2. a repository-local timer that invokes a closed registry of deterministic Amber
   maintenance jobs whose ceiling is read-only inspection plus append-only proposal /
   evidence records under `.amber/`.

The first remains outside Amber. The second can be admitted without granting execution
authority. Separately, F078 proved that truthful live cancellation cannot exist until
an approved governed execution exposes an ownership-bound cancellable handle and a
termination receipt. Cancellation authority must never imply launch authority.

## Decision

### 1. Admit one bounded H7 maintenance runtime

Amber MAY own a repository-local scheduler/daemon only for registered **Maintenance
Jobs** that satisfy all of these invariants:

- `executesAnything: false` — no target-project command, shell command, Route command
  stage, governed command, arbitrary executable, or package script;
- `schedulesJobs: true` — the runtime may wake and invoke the registered internal job;
- `dispatchesAgents: false` — no model, agent loop, subagent, dynamic workflow, or host
  tool dispatch;
- `writesExternalSystems: false` — no PR, issue, notification, network mutation, MCP
  write, connector effect, or account-bearing CLI;
- job implementation is a closed code registry, not caller-supplied code/command;
- reads are repository-confined; writes are limited to the job's declared append-only
  `.amber/harness/runtime/` record/proposal areas;
- schedule registration is human-approved, scoped, expiring, budgeted, and revocable;
- every wake, skip, refusal, start, completion, failure, budget stop, no-progress stop,
  and recovery is ledgered;
- one repository-local lease/fence prevents concurrent owners;
- no-progress and budget ceilings stop the job; they never widen it;
- outputs are proposals/evidence only. A proposal never approves, executes, edits
  project documents, changes policy, or creates an external effect.

The first admitted job family is limited to deterministic maintenance proposal
generation (stale documentation, rule-pack drift, workflow-pack candidates, and
failure-to-regression candidates). H7 does not schedule existing `loop run --execute`
or `harness execution run` commands.

### 2. Admit cancellation authority only over an already-approved live execution

Amber MAY later expose human-triggered cancellation only when the execution was
already admitted by the existing execution gates and carries a persisted cancellable
handle with:

- execution id, owner/lease/fence, process identity and start proof;
- exact target/workspace binding;
- expiry and one terminal settlement;
- a separate cancellation Approval/Decision (no self-cancel by worker output);
- request, signal/adapter action, acknowledgement, observation, and terminal receipt;
- race-safe resolution when normal settlement and cancellation compete;
- controller-restart reconciliation that never guesses success;
- Evidence binding the actual terminated/still-running/unknown outcome.

Cancellation grants **zero launch authority**. It cannot create an execution, widen a
contract, delete a workspace, rewrite a Run result, or treat an absent receipt as a
successful kill. F078's explicit refusal remains the command behavior until this full
protocol is delivered and verified.

### 3. Keep existing hard exclusions

Still forbidden:

- general agent OS/runtime, autonomous agent loops, live subagent dispatch;
- Dynamic Workflow execution;
- scheduled target-project commands or existing governed commands;
- autonomous external integrations, PRs, issues, notifications, or connector effects;
- caller-supplied scheduled code;
- hidden auto-approval or worker/self approval;
- direct rewrite of user/project documents by maintenance jobs;
- restoring or repairing the deleted ADR-0005 experimental runtime.

### 4. Positioning stays unchanged pending evidence

This ADR changes authority, not the homepage promise. README and product positioning
remain **trusted control boundary / Trusted Continuation** until H7 and cancellation
acceptance evidence exists and a separate §55 HITL decision approves any
“Governed Agent Harness” first-screen wording.

## Alternatives

### Keep every scheduler forbidden

Safest but ignores the architecture's explicitly gated first H7 candidate after H0–H6
completion. Rejected by user scope decision.

### Reintroduce the deleted daemon/autonomous executor

Rejected. ADR-0005 deleted broken, unowned code. H7 must be a new bounded design over
current ledgers, approvals, budgets, and replay evidence.

### Schedule existing governed commands

Rejected. A timer must not transform human-triggered L2 execution into unattended L3
execution. Maintenance jobs are internal deterministic functions under a stricter
ceiling.

### Let cancellation be cancel + release

Rejected by F078. Lifecycle cancellation and workspace deletion do not terminate a
process and can destroy evidence while it still runs.

## Consequences

### Positive

- H7 gains a narrow, truthful authority boundary.
- Current execution gates and `executesAnything: false` retain their meanings.
- Proposal generation can become timely without becoming autonomous execution.
- Live cancellation has explicit prerequisites instead of ad hoc PID signaling.

### Negative

- Amber now owns a small always-on local process and must handle leases, crashes,
  clocks, budgets, and recovery.
- More ledger/event volume and additional operational testing are required.
- Documentation must distinguish scheduling internal maintenance from scheduling
  target execution.

### Neutral

- Existing loop/workflow-pack contracts remain `schedulesJobs: false` and
  `dispatchesAgents: false`.
- Existing `loop run --execute`, route execution, runner execution, and external
  effects are unchanged.
- F078 refusal remains until the later cancellation protocol graduates.

## Security Impact

The principal new risk is converting time into authority. The closed registry,
repository confinement, schedule Approval, lease/fence, append-only ledger, budgets,
no-progress stop, and proposal-only output ceiling prevent a timer from becoming a
command runner. Cancellation adds process-control risk later and therefore requires
ownership proof, separate approval, terminal receipts, and unknown-outcome handling.

## Migration Impact

No existing contract changes in this decision packet. H7 introduces new schedule/job
records in its own feature. Existing loop contracts remain invalid if they set
`schedulesJobs: true`; H7 uses a separate contract and registry rather than weakening
the workflow-pack schema.
