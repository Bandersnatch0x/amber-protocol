# F079: Bounded Live Runtime Charter Amendment

**spec_id:** F079
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** user decision 2026-09-24 (abandon push; execute items 2/4/5; reorder to Charter authority amendment → H7 → live-cancel → positioning evidence decision); Harness v2 §27/§36/§51/§55; Team Replication Layer Charter §5/§7; ADR-0003/0005; F065–F078 acceptance evidence
**Feature:** F079

## Problem Statement

H7 and a real cancellation protocol are currently forbidden by the effective Charter,
Operating Manual, LOOP product boundary, and ADR-0003 scheduling clause. Implementing
them first would invert the Charter's mandatory sequence: scope amendment and human
approval must precede runtime code. At the same time, Harness v2's H0–H6 acceptance
evidence now satisfies the architecture's prerequisite for discussing one narrow H7
candidate: read-only maintenance proposal generation.

## Solution

Amend authority before implementation, with a narrow distinction:

1. **Allowed H7:** repository-local scheduler/daemon for a closed registry of
   deterministic Amber Maintenance Jobs. Jobs may inspect the repository and append
   proposal/evidence/runtime records under `.amber/harness/runtime/`; they may not run
   target commands, dispatch agents, execute dynamic workflows, write external
   systems, approve proposals, mutate policy, or rewrite project documents.
2. **Authority tuple:** Maintenance Jobs remain `executesAnything: false`, set
   `schedulesJobs: true`, and keep `dispatchesAgents: false` /
   `writesExternalSystems: false`. Existing loop/workflow contracts remain
   `schedulesJobs: false`; H7 gets a separate contract/registry rather than weakening
   them.
3. **Required controls:** human-approved scoped/expiring/revocable schedules; closed
   job registry; repository confinement; lease/fence; budget ceiling; no-progress
   stop; append-only runtime ledger; crash recovery; replayable proposal/evidence
   output; proposals grant no authority.
4. **Cancellation authority:** only for an already-approved live governed execution
   with an ownership-bound persisted handle, separate cancellation approval,
   race-safe settlement, restart reconciliation, and a terminal Evidence-backed
   receipt. Cancellation grants no launch authority. F078 refusal remains until that
   protocol graduates.
5. **Still excluded:** autonomous agent loop/OS, live subagent dispatch, scheduled
   target commands, dynamic workflow execution, external writes/notifications/PRs,
   caller-supplied scheduled code, document rewrite, self-approval, and resurrection
   of ADR-0005 deleted modules.
6. **Positioning hold:** README/homepage positioning does not flip in F079. It remains
   “trusted control boundary / Trusted Continuation” until H7 + cancellation evidence
   exists and a later §55 HITL gate approves the final wording.

## Charter Patch Shape

After HITL acceptance, update `docs/TEAM_REPLICATION_CHARTER.md`:

- Purpose: Amber may own one bounded internal maintenance runtime; it still is not a
  general/second agent runtime.
- Own: add governed Maintenance Schedule / Runtime Ledger / cancellation control over
  already-approved owned executions.
- Integrate: coding engines still own models, agent loops, and general tools.
- Exclude: replace blanket daemon exclusion with the precise exclusions above.
- Change rules: runtime expansion requires separate spec + approval + acceptance
  evidence; homepage positioning remains separately gated.

Update boundary docs in lockstep:

- ADR-0103 becomes Accepted.
- ADR-0003 receives an addendum for the bounded maintenance-runtime exception.
- ADR-0005 receives an addendum that H7 is new code and never restoration.
- `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md`, `docs/product/LOOP.md`, and `AGENTS.md`
  distinguish bounded internal maintenance scheduling from forbidden target/agent
  scheduling.
- README remains unchanged in F079.

## User Stories

1. As a governance owner, I want authority changed before runtime code, so H7 cannot
   sneak past the Charter.
2. As a maintainer, I want a narrow scheduler for deterministic maintenance proposals,
   not an autonomous command/agent runtime.
3. As a safety reviewer, I want cancellation authority separated from launch
   authority and backed by owned handles and receipts.
4. As a product owner, I want positioning held until runtime evidence exists.

## Testing Decisions

- Add a boundary-document conformance test pinning all four H7 authority booleans and
  the preserved exclusions across Charter, ADR-0103, Operating Manual, LOOP, and
  AGENTS.
- Assert existing workflow-pack schemas/tests still reject `schedulesJobs: true` and
  every existing loop contract remains false.
- Assert README first-screen positioning is byte-unchanged by F079.
- Full repo gates + stage-7 dual-axis review.

## Out of Scope

H7 implementation (F080); live-cancel implementation (F081); README/homepage §55 flip
(F082 decision after evidence); external pilot; cross-repository scheduler.

## Further Notes

HITL gate `issues/0130` closed 2026-09-24: user selected 「全部按推荐」 for the
exact six-point boundary. No authority beyond this text is implied.
