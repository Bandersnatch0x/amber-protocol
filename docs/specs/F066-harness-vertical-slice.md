# F066: Harness Vertical Slice — One Governed Execution Through the Chain

**spec_id:** F066
**Status:** draft
**Updated:** 2026-09-22
**Provenance:** Harness v2 proposal §58 (vertical slice); ADR-0100 (decision 3: AdmissionReceipt), ADR-0101 (decision 4 + §52 mappings), ADR-0102 (execution/policy events); F065 accepted spec (`docs/specs/F065-harness-h0-foundation.md`, user stories 5–6 re-pointed here); wayfinder map `issues/0066`
**Feature:** F066

## Problem Statement

F065 built the Harness objects but nothing real has flowed through them: no Harness Contract
has ever been bound to an actual governed execution (`loop run --execute`, ADR-0003), no
AdmissionReceipt has ever recorded the six checks against real gate outcomes, and no run's
event chain reflects a real policy decision and execution. Until one real governed execution
walks Contract → Admission → Run → Policy → Execution → Events, the Harness objects are
records without a customer, and "one inspect view answers what this execution may do and did"
remains unproven.

## Solution

Bind **one existing governed execution path** — the ADR-0003 `loop run --execute` — to the
Harness chain, additively:

- **AdmissionReceipt** (ADR-0100 decision 3, user stories 5–6): the Run record gains an
  `admission` section recording six explicit checks — identity, contract, policy, context,
  execution, approval — each `pass` with a **pointer to the existing gate outcome** it
  witnessed, or a refusal. A missing check refuses; admission never creates authority and
  never executes anything. The receipt rides the Run record additively (ADR-0012
  allow/required conventions), and `run.admitted` carries the decision pointers.
- **Run lifecycle over a real execution**: one `loop run --execute` maps to
  Task + Run + Evidence (§52 rule 5): run created → admitted (receipt) → running while the
  governed command executes → completed/failed per the loop's real outcome, with
  `execution.started/completed/failed` and `policy.evaluated` events emitted into the harness
  ledger.
- **Mapping adapter** (ADR-0101 decision 4): `loop` record ↔ Run, one sanctioned bridge with
  conformance tests; the session machine stays untouched.
- **The §38 gate becomes real**: `amber harness inspect --run <id>` presents Contract →
  Run → AdmissionReceipt → Events for an execution that actually ran under the four existing
  gates.

H0's authority posture is unchanged: the loop's own gates (declarative policy, human approval
via `loop approve`, worktree isolation, tamper-evident execution ledger) remain the sole
authority; Harness admission witnesses them.

## User Stories

1. As a repository maintainer, I want `amber harness start` against a loop contract to
   produce an AdmissionReceipt whose six checks each cite the real gate outcome they
   witnessed, so that I can answer "凭什么允许" from one artifact.
2. As a maintainer, I want a missing or expired approval pointer to refuse admission, so
   that no run is ever admitted on a claim.
3. As a reviewer, I want the run's event chain to contain the real `policy.evaluated` and
   `execution.*` outcomes, so that the trail matches what actually happened.
4. As a reviewer, I want `amber harness inspect --run` to show Contract → Run → Admission →
   Events for a real execution, so that review needs no other surface.
5. As a maintainer, I want the loop record and its run bound by a conformance-tested
   mapping adapter, so that neither surface can drift from the other silently.
6. As a maintainer, I want a failed governed execution to leave a failed (not rewritten)
   run with its failure evidence, so that the terminal-immutability rule holds for real
   failures, not just fixtures.

## Implementation Decisions

- The admission receipt is an **additive section on the Run record**
  (`run.schema.json` + `admission`), not a separate artifact family — one inspect view, one
  record per run; additive growth follows the ADR-0012 allow/required split.
- The six checks read the **existing loop-execution admission surfaces** (contract
  policy gates, approval token, worktree execution contract); each check stores
  `{ result: "pass", pointer: <existing artifact path/id> }` — Harness re-derives nothing
  and owns no new gate.
- `loop` ↔ Run mapping lives in a dedicated adapter module; the loop's own ledgers are
  never written by Harness.
- Events: `run.*` (F065 machine), plus `execution.started/completed/failed` and
  `policy.evaluated` emitted at the real transitions.
- No replay, no validation receipt engine (H5), no scheduler — slice boundary per §58.

## Testing Decisions

- Conformance tests at the loop-execution seam: one governed dry-run-shaped execution
  (no live command; the existing dry-run/--execute gate surfaces as fixtures) mapped to
  Run + receipt + events, asserted through the public CLI.
- Refusal tests: missing approval pointer, unknown contract, non-admitted run id.
- Existing loop-execution suites remain unedited (ADR-0028 discipline).

## Out of Scope

- ValidationReceipt engine and replay (H5); capability registry (H1); context firewall (H3);
  any scheduler/daemon (H7); homepage/charter change; MCP projection.

## Further Notes

- Design decisions above are **recommendations adopted per the standing "按推荐" directive**;
  the HITL confirmation ticket for this spec is `issues/0076` (created with the ticket batch).
- Driven by user stories 5–6 re-pointed from F065 at the 0069 confirmation.
