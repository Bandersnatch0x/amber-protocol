# Gate Loop Design Review - 2026-07-07

## Scope

Surface: Amber Web Viewer `/gates`.

Goal: close the gate review loop from discovery to context review, approve/reject decision, session follow-up, and auditable feedback.

## Initial Review Verdict

External design review verdict: not approved as originally stated.

Primary concern: the proposed `Approve and resume` copy over-promised real runner recovery. The current system can write a gate decision and emit a `session_resumed` event, but it does not prove a runner has acknowledged or resumed execution.

## Required Corrections Applied

- Button language changed to `Approve and request resume` to match actual backend capability.
- Backend now re-reads the gate before approval and rejects stale decisions when the gate is no longer pending.
- Backend verifies the session exists before approving through the combined flow.
- Combined flow distinguishes `resumeRequested: true` from approved-but-not-resumed states.
- Resume event emission failure is returned as partial-success feedback instead of being hidden.
- Reject requires a non-empty reason at both UI and API layers.
- Approve/reject decisions emit gate decision events in addition to writing decision files.
- `/gates` no longer nests action buttons inside a row link; actions are explicit buttons plus a separate session link.
- Inline review panel exposes full session ID, gate ID, type, stage, timestamps, reason, reviewer field, and local file source.
- Feedback is announced through an `aria-live` region and pending actions disable duplicate submissions.

## Product Loop

1. Operator lands on `/gates` and filters pending/approved/rejected gates.
2. Operator expands `Review` to inspect gate context and data source.
3. Pending gate can be approved with a resume request or rejected with a required reason.
4. API writes the decision file, emits the gate decision event, and optionally emits a resume request event for paused sessions.
5. UI refreshes the real gate list and displays whether resume was requested, skipped, or failed.
6. Operator can open the session to inspect follow-up timeline evidence.

## Remaining Risks

- A resume request event is not a runner acknowledgement; future work should add runner ACK/status persistence before copy can claim real resumed execution.
- Gate source validation still trusts parsed `.gate.json` shape; future work should surface malformed/orphan/stale gate diagnostics.
- Open session currently links to the session overview; a future deep link to the specific gate timeline event would tighten evidence review.

## Final Review Status

Approved for V1 after corrections above. The product copy now matches system capability, the core decision path is auditable, and partial resume states are visible rather than hidden.
