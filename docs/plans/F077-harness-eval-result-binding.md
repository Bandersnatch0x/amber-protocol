# F077 Plan: Harness Eval-Result Binding (the First Eval-Prefixed Pointer Producer)

**Feature:** F077
**Status:** implementation-ready (spec `docs/specs/F077-harness-eval-result-binding.md`, accepted 2026-09-24 via `issues/0126`)
**User Confirmation:** confirmed (「全部按推荐」, 2026-09-24 — `issues/0126`; standing directive「继续剩余项」, 0066 close-out follow-ups)
**Date:** 2026-09-24
**Decision records:** Harness v2 §16/§17/§26/§35; F073 (the validator this binds onto), F074 (the disclosed pointer-leg gap this closes), F058 (the eval-result artifact shape), F054 (the pin grammar), ADR-0021 (the revision reference form)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F077-harness-eval-result-binding.md` |
| The one binding seam | `scripts/lib/harness/validation-core.js` (`validateRun` grows the optional `evalResult` pin; the `eval` check; the pointer rendering) |
| Composed readers (never re-implemented) | `scripts/lib/core/canonical-artifacts.js` (`showArtifact`), `scripts/lib/core/artifact-graph-projection.js` (`artifactGraphNodeId`), `scripts/lib/command-helpers.js` (`parseRevisionPin`) |
| CLI | `scripts/lib/harness/harness-commands.js` (`validate` parses `--eval-result`), `scripts/lib/command-registry.js` (help + usage) |
| Consumers that light up unchanged | `harness eval --run`, `harness trace --run` (F074) |
| Tests | `tests/unit/harness-replay.test.js` (the H5 suite grows the bound cases), `tests/unit/harness-control-plane.test.js` (the pointer-carrying `harness eval --run` case) |

## Slices

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

## Verification

- Focused: `node --test tests/unit/harness-replay.test.js tests/unit/harness-control-plane.test.js`.
- Full gates: `npm test` (log to file, read whole), manifests/doctor/gen:agents/lint/format/docs:gen.

## Evidence schema

Recorded in `feature_list.json` F077 `evidence[]`. The acceptance demo: a committed
F058-shaped `eval-result` bound onto a real run → `eval=pass`, receipt `evalResult`
block, `validation.completed` pointers `validation-receipt:… | eval-result/…@n |
eval/…@n`; `harness eval --run` cites exactly the two eval-prefixed pointers; the same
run validated without the flag produces bytes identical to F073.

## Non-goals

Producing eval-results from a run; replay/diff consuming the eval leg; multiple
bindings per receipt; `harness execution terminate` (own spec decision); MCP
projection.
