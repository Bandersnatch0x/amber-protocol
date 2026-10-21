# F077 Plan: Harness Eval-Result Binding (the First Eval-Prefixed Pointer Producer)

**Feature:** F077
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (spec `docs/specs/F077-harness-eval-result-binding.md`, accepted 2026-09-24 via `issues/0126`)
User Confirmation: confirmed
**Confirmation source:** 「全部按推荐」, 2026-09-24 (`issues/0126`); standing directive 「继续剩余项」, `issues/0066` close-out follow-ups
**Date:** 2026-09-24
**Decision records:** Harness v2 §16/§17/§26/§35; F073 (the validator this binds onto), F074 (the disclosed pointer-leg gap this closes), F058 (the eval-result artifact shape), F054 (the pin grammar), ADR-0021 (the revision reference form)

## High Level Design

- Context: F073's receipt carried six checks, and F074 disclosed a gap: no check could cite an
  eval result, so a run could be validated without any eval evidence and the receipt could not
  point at the suite that backed it.
- Proposed approach: grow `validateRun` with an optional `evalResult` pin resolved through the
  existing canonical-artifact reader, append an `eval` check with the canonical pointer, and emit
  eval-prefixed pointers on `validation.completed`. The unbound path stays byte-identical to F073.
- Risks: the binding must compose `showArtifact` and `parseRevisionPin` rather than invent a
  second pin grammar; a pin that resolves to nothing must refuse rather than record an empty
  check; and the consumers (`harness eval --run`, `harness trace --run`) must light up unchanged
  from the pointer alone.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F077-harness-eval-result-binding.md, docs/specs/F073-harness-h5-eval-replay.md, docs/specs/F074-harness-h6-control-plane.md, docs/adr/0021-canonical-artifact-governance-graph-integration.md
- review: docs/specs/F077-harness-eval-result-binding.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

1. **The binding** (this delivery, one slice): `validateRun(target, { runId,
   evalResult: { identity, revision } })` — resolve through `showArtifact`, refuse
   null / missing `overall`, append the `eval` check with the canonical pointer, record
   the `evalResult` block, emit the eval-prefixed pointers on `validation.completed`;
   unbound path byte-identical to F073.
2. **CLI + docs lockstep** (same batch): `harness validate --run <id> --eval-result
   <identity>@<revision>` through `parseRevisionPin`; help/usage; CLI reference regen.
3. **Gates + review** (same batch): conformance (bytes pinned for the unbound path;
   the pointer-carrying `harness eval --run`; governance untouched incl. the artifact
   bytes), full gates, stage-7 two-axis review, commit.

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0126` confirmation and the dual-axis review).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F077, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F077-harness-eval-result-binding.md` and the `issues/0125`–`0126` logs; never hand-edit the F077 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A committed F058-shaped `eval-result` bound onto a real run yields `eval=pass`, a receipt `evalResult` block, and `validation.completed` pointers citing the receipt, the eval result and the eval check.
- `harness eval --run` cites exactly the two eval-prefixed pointers, without any change to that subverb.
- The same run validated without the flag produces bytes identical to F073's output.
- A pin that resolves to nothing, or a resolved artifact missing `overall`, is refused rather than recorded as an empty check.
- Existing guardrails still pass, and the current phase boundary is unchanged: no eval-result production from a run, no multiple bindings per receipt, no replay/diff consuming the eval leg.

## Verification

- Focused: `node --test tests/unit/harness-replay.test.js tests/unit/harness-control-plane.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence Schema

- Command: `dual-axis review (issues/0125)`
- Result: pass — Spec axis 13 met / 0 partial / 0 contradicts; Standards axis pass-with-findings (2xP2 + 2xP3), all findings fixed before the final gate
- Date: 2026-09-24
- Notes: the acceptance demo is a committed F058-shaped eval-result bound onto a real run yielding `eval=pass` with the three pointers, `harness eval --run` citing exactly the two eval-prefixed ones, and the unbound path reproducing F073's bytes.

## Non-goals

Producing eval-results from a run; replay/diff consuming the eval leg; multiple
bindings per receipt; `harness execution terminate` (settled by F078 as an explicit
zero-write refusal); MCP projection.
