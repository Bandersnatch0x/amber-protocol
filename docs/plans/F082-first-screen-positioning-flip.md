# F082 Plan: §55 First-Screen Positioning Flip (Governed Agent Harness)

**Feature:** F082
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (no F-spec; the positioning decision lives in ADR-0030's F082 amendment)
User Confirmation: confirmed
**Confirmation source:** 「翻首屏（记录 scope override）」, 2026-09-24 — the §55 gate ruling
**Date:** 2026-09-24
**Decision records:** ADR-0030 `## Amendment (F082, 2026-09-24)`; the 0046 amendment it amends; ADR-0103/F079; F080 and F081 acceptance evidence

## High Level Design

- Context: the 0046 amendment required an external signal before the first screen could lift, and
  that signal had not arrived. What had arrived was internal acceptance evidence: H0–H6 delivered
  and reviewed, a bounded maintenance runtime, and owned execution handles with truthful
  cancellation. The open question was whether that evidence substitutes for the external signal.
- Proposed approach: record the substitution as an explicit user ruling rather than as an
  implementation side effect, then apply it in two places — the README first screen in both
  languages, and the Web Viewer console title — and amend ADR-0030 in place so the decision keeps
  the rationale beside the change.
- Risks: a positioning flip can quietly widen the safety contract, so the amendment restates what
  does not change (the safety contract, the expert-surface clause, Trusted Continuation, and the
  Charter's Own/Integrate/Exclude split); and the ruling is reversible, which only stays true if
  the scope override is recorded as a decision rather than folded into prose.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/adr/0030-coding-agent-enabled-repositories-and-trusted-continuation.md, docs/TEAM_REPLICATION_CHARTER.md, README.md, README.zh-CN.md
- review: docs/adr/0030-coding-agent-enabled-repositories-and-trusted-continuation.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md

## Vertical Slices

1. **Record the scope override** in ADR-0030 as an F082 amendment: the internal acceptance
   evidence substitutes for the external-pilot prerequisite, and the ruling is reversible.
2. **Apply the first screen** in `README.md` and `README.zh-CN.md`, leading with "Governed Agent
   Harness for real engineering systems" and "the governed execution boundary between AI agents
   and real systems".
3. **Align the console title** so the Web Viewer and the README name the same boundary, disclosed
   in the amendment as a follow-up within the same decision.
4. **Conformance**: `tests/unit/h7-charter-boundary.test.js` asserts the amendment and the
   README first screen; full gates.

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries one evidence entry (the §55 gate ruling) and its conformance test.
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F082, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from ADR-0030's F082 amendment and `tests/unit/h7-charter-boundary.test.js`; never hand-edit the F082 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- `README.md` and `README.zh-CN.md` both lead with the governed-agent-harness wording, asserted by the conformance test.
- ADR-0030 carries the F082 amendment, marked as amending rather than superseding the 2026-09-04 decision and the 0046 amendment.
- The scope override is recorded as a user ruling: internal H7 and cancellation acceptance evidence substitutes for the external-pilot signal, and a later ruling can reverse it.
- What does not change is restated in the same amendment: the safety contract, the expert-surface clause, Trusted Continuation as the coding-domain outcome, and the Charter's Own/Integrate/Exclude split.
- Existing guardrails still pass, and the current phase boundary is unchanged: the flip moves the first screen, never the safety contract; no target command, agent, workflow or external write becomes permitted.

## Verification

- Focused: `node --test tests/unit/h7-charter-boundary.test.js`
- Full gates: `npm test`, `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`, `node scripts/validate-wiki.js --target .`, `npm run format:check`.

## Evidence Schema

- Command: `node --test tests/unit/h7-charter-boundary.test.js`
- Result: pass — the README first screen and the ADR-0030 amendment are asserted; the F079 positioning hold is replaced by the F082 flip
- Date: 2026-09-24
- Notes: the acceptance demo is the §55 gate ruling 「翻首屏（记录 scope override）」, with the positioning scope decision recorded in ADR-0030.

## Non-goals

Any change to the safety contract, the expert-surface clause, the seven-verb default surface,
the Charter's Own/Integrate/Exclude split, or any capability the boundary currently forbids.
