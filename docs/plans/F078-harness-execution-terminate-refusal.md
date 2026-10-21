# F078 Plan: Harness Execution Terminate — Explicit Refusal

**Feature:** F078
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** `显式拒绝面`, 2026-09-24 — preserve separate Run cancel / runner abort / workspace release semantics (`issues/0128`)
**Date:** 2026-09-24
**Decision records:** Harness v2 §20; F070 BLOCK posture; ADR-0101 Run lifecycle; F052 runner execution abort; F074 disclosed deferment

## High Level Design

- Context: `harness execution terminate` was deferred by F074 because no cancellable live handle
  existed. The open question was whether to fake a kill by composing cancel, abort and release.
  Faking one would claim an observation Amber never made.
- Proposed approach: an explicit refusal. The subverb recognizes itself, returns a stable
  `AMBER_E_INVALID_ARG`, names the three real alternatives, and performs zero reads and zero
  writes. Help and usage label the refusal honestly, and the docs that deferred to F078 point at
  this disposition.
- Risks: a refusal that still touches state is worse than the fake kill it replaces, so the test
  pins the whole target tree byte-identical; and the three alternatives must be named accurately,
  or a reader follows a path that does not do what they expect.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F078-harness-execution-terminate-refusal.md, docs/adr/0101-run-unit-of-auditable-execution.md, docs/specs/F070-harness-h2b-execution-wiring.md, docs/agents/dev-workflow.md
- review: docs/specs/F078-harness-execution-terminate-refusal.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **Explicit refusal**: recognize nested `execution terminate`, return stable
   `AMBER_E_INVALID_ARG`, name three alternatives, perform zero reads/writes.
2. **Help + close-out docs**: help/usage label refusal honestly; F074/F076/F077
   deferred notes point to the F078 disposition; docs regeneration.
3. **Conformance + review**: existing/missing/no-run raw and dispatcher cases; entire
   target tree byte pin over a real prepared execution; focused/full gates; stage-7
   dual-axis review; commit.

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0128` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F078, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F078-harness-execution-terminate-refusal.md` and the `issues/0127`–`0128` logs; never hand-edit the F078 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A real prepared run and workspace are snapshotted, and `harness execution terminate --run <id>` returns the specific no-live-handle refusal naming advance, runner abort and release.
- The target tree stays byte-identical: the refusal performs zero reads and zero writes.
- Missing and no-run invocations produce the same capability refusal, so the surface never claims a capability it does not have.
- Help and usage label the refusal honestly, and the docs that deferred to F078 point at this disposition.
- Existing guardrails still pass, and the current phase boundary is unchanged: no live cancellation protocol, no process handles or signals, no composed cancel+abort+release.

## Verification

- Focused: `node --test tests/unit/harness-execution.test.js`.
- Full gates: `npm test` (complete log), manifests, doctor, gen:agents:check, lint,
  format:check, docs:gen.

## Evidence Schema

- Command: `dual-axis review (issues/0127)`
- Result: pass — Spec axis 11 met / 0 partial / 0 contradicts; Standards axis pass with no findings
- Date: 2026-09-24
- Notes: the acceptance demo is a real prepared run snapshotted before the call, the specific no-live-handle refusal naming the three alternatives, and a byte-identical target tree afterwards.

## Non-goals

Live cancellation protocol; process handles/signals; lifecycle/runner/release changes;
composed cancel+abort+release.
