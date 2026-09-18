# Plan: Trusted Control Context / Runtime Boundary implementation

Spec: `docs/specs/trusted-control-context-runtime-contract.md` (spec_id `trusted-control-context-runtime-contract`, status `proposed`, updated 2026-09-16)
Status: proposed — **awaiting coordinator two-axis review; implementation NOT started**
Revised 2026-09-16 (C0R repair): F056 payloadHash ceiling narrowed to declared-hash
binding; session lease binding completed (full `ownerId`/`tokenHash`/`fence` proof at
authorize + prepare + settle); classification stored-field vs effective-projection
distinction made explicit.
Origin tickets: `issues/0047`, `issues/0053`, `issues/0058`, `issues/0059` (2026-09-15 rulings; corrections appended 2026-09-16)
Baseline HEAD: `0a9cbeab85898bd043e1ab9f7c89ea71193cbb78`
No new F-number is introduced; F064 and the feature catalog are untouched.

## Goal

Implement the context/runtime boundary contract end to end: classification/purpose/TTL
metadata through governed ingest into the Loadout snapshot, declaration-based egress
constraints at the real F056 and Research seams, the evidence-class-corrected scope
detection, the F052 request's frozen policy/capability/scope bindings with session lease
and context authority, the two MCP projections, and the Research adapter's three
capabilities with the citation store — with every spec §8 invariant covered by a product
test at the real seam.

## High Level Design

- **Context:** audit P1-04/P1-08 corrected four false mechanical claims in the tickets;
  the canonical contract now lives in the spec. All implementation reuses existing
  primitives: the ledger-family factory, the F052 request lifecycle, the F050 approval
  registry, the Loadout builder, the MCP action-contract parity surface. No new ledger
  implementation, no scanner, no parallel state machine, no sandbox.
- **Approach:** vertical slices at the public seams (CLI commands, ledger folds, schema
  validation), red-first tests per slice. Each slice lists its exact write set; shared
  files with other tickets are marked and gated.
- **Risks:** (1) `context-loadout.schema.json` is `additionalProperties: false` at every
  level — the schema growth must be one coordinated change with the builder, or every
  Loadout fails validation; (2) `REQUEST_INPUT_FIELDS`/`RESULT_RECEIPT_FIELDS` are closed
  sets — adding fields is a breaking change for existing ledgers unless readers tolerate
  unknown fields on old versions (ADR-0012 optional-growth discipline; verify the fold
  tolerance first); (3) timeline `context_granted`/`context_denied` enabling collides
  with 0056's slice — gated; (4) the F063 default verb surface must not grow.

## Vertical Slices

Dependency order: ingress metadata (A) precedes egress validation (B) because the egress
ceiling needs labeled sources; the F052 binding fields (C) precede the Research adapter
(E) because the research capabilities ride the F052 registry; the run-contract bridge (F)
lands with the run-contract plan's Slice 1; MCP (D) and observation wiring (G) are
independent of A-C except for the seam shapes they project.

- [ ] **Slice A — Ingress metadata and snapshot extension (0053 §3.1-3.3).**
  Files: `schemas/context-page.schema.json` (page fields `classification`/`purpose`/`ttl`),
  `schemas/context-loadout.schema.json` (pages[] + required-artifact entries gain
  `classification`/`purpose`/`expiresAt`; top-level `redactions[]`; `excluded.reason`
  gains `classification` and `expired`), `schemas/context-request.schema.json`
  (`sources[]` gains `classification` incl. `unknown`), `scripts/lib/core/context-ingest.js`
  (validate + downgrade-Decision refusal), `scripts/lib/core/context-loadout.js` (copy
  metadata, compute effective `expiresAt` and the §3.1 effective-classification
  projection with recorded `classificationSource`, exclusion reasons, redactions),
  `scripts/lib/core/context-request.js` (emit source classification), tests under
  `tests/unit/`.
  Acceptance: spec §8 cases 2 (load-build half), 3 (exclusion half); unlabeled ad-hoc
  content is `unknown` and refused under any ceiling; a governed-ingest page without a
  stored label projects effective `internal` with recorded `classificationSource`
  ("effective-default") — never a stored write-back, so pre-field pages gain no stored
  classification; downgrade without Decision refuses.

- [ ] **Slice B — Egress declarations at the F056 seams (0053 §3.5 R-EG-1).**
  Files: `scripts/lib/core/external-registry.js` (`proposeExternalEffect` +
  `executeExternalEffect` gain `payloadSources[]` validation and re-derivation; effect
  registration gains `maxPayloadClassification`/`requiresPayloadProvenance`),
  `scripts/lib/external-commands.js` (propose flags), `schemas` for the effect contract
  if separately validated, tests under `tests/unit/`.
  Acceptance: spec §8 cases 1, 4 (F056 half); refuses are explicit
  (`classification-ceiling` / wrong-scope / provenance-required), never hash-miss
  passes. The `payloadHash` binding enforces declared-hash identity only (spec §3.5):
  no claim of actual payload-byte integrity, actual-payload identity, or leak
  prevention — the bytes actually sent are an executor claim (E2).

- [ ] **Slice C — F052 request frozen bindings, lease, context authority (0059 §5.1-5.2).**
  Files: `scripts/lib/core/runner-registry.js` (`REQUEST_INPUT_FIELDS` +
  `requestShapeProblem` gain optional `sessionBinding`/`contextAuthority`;
  Amber-computed `policyHash`/`capabilityHash`/`scopeHash` frozen on the `requested`
  event; `requestDriftProblem` gains policy/capability/scope re-derivation; the full
  lease proof `sessionBinding: { sessionId, attemptId?, ownerId, tokenHash, fence }`
  is verified at `authorize`, `prepare`, and `settle` — lease unexpired and
  `ownerId`/`tokenHash`/`fence` still identifying the current holder),
  `scripts/lib/runner-commands.js` (request-action flags; the submit stage is the
  `request` action, `:245`), tests under
  `tests/unit/`.
  Acceptance: spec §8 cases 5, 7, 9 (lease displacement: a displaced or expired lease
  fails prepare and settle; the displaced owner cannot settle; the current owner
  resolves under their own proof); direct non-session
  requests with bindings refuse on policy drift; `contextAuthority` honors
  `expiresAt` (case 3 consumption half).

- [ ] **Slice D — MCP projections (0059 §5.4).**
  Files: `action-types/runner-request.json` + `action-types/runner-settle.json`
  (Action Types `amber.runner.request` → `amber runner request`, `amber.runner.settle` →
  `amber runner settle`), `scripts/lib/mcp-action-contracts.js` (capability entries,
  both `directReadOnlyExec: false`), parity tests.
  Acceptance: both actions return `approvalRequired` with the exact command contract and
  never execute; contract-parity invariants stay green (F018 discipline).

- [ ] **Slice E — Research adapter (0058 §6).**
  Files: new `scripts/lib/core/research-adapter.js` (ResearchProcess ExecutionBoundary —
  the 0049 five-method contract, second implementation; no worktree, scope = citation
  store path + read-only retrieval), `scripts/lib/core/citation-store.js`
  (`.amber/research/citations.jsonl` via ledger-family factory),
  `scripts/lib/research-commands.js` or extension of `runner-commands.js` surface,
  capability registrations for `search`/`extract`/`cite` (constraints per R-EG-2),
  verification helpers (`citation_exists`, `source_accessible`), fixture for the §6.5
  flow, tests under `tests/unit/`.
  Acceptance: spec §8 cases 1 (query half), 4 (query half), 6 (settlement half), 8
  (claim stays `claimed`); the §6.5 end-to-end flow runs in a fixture; dependency guard
  (`tests/unit/core-domain-separation.test.js`) stays green; no directory moves (§6.4).

- [ ] **Slice F — Run-contract context capture bridge (0053 §3.1 / spec §4).**
  Files: `scripts/lib/session-stage-runner.js` **only as the run-contract plan's Slice 1
  lands** (shared write set — gated on that plan's adoption): `scopeInputs.context_scope`
  capture per spec §4 (constraints-only structure; `null` = honest absence),
  consumption-time `context-expired` refusal in `scripts/lib/core/governed-runner.js`
  gate path.
  Acceptance: spec §8 cases 2, 3 at the session seam; R-CA-1 refresh-tolerance and
  R-CA-2 drift-refusal both observable in one story.

- [ ] **Slice G — Evidence-class-corrected scope detection wiring (0047 §2.3 D2).**
  Files: the finish-time/handoff surface that consumes `classifyDirtyPaths`
  (`scripts/lib/core/dirty-paths.js` is pure and unchanged) — record the `outsideScope`
  classification as a FAIL fact with the §2.3 statement (file state observed, actor
  unknown, network unobserved); tests under `tests/unit/`.
  Acceptance: spec §8 case 8; no assurance value asserts network absence; the ADR-0001
  amendment's wording matches the recorded semantics.

## Compatibility and migration boundaries

- All new record/schema fields are optional additions (ADR-0012); existing ledgers fold
  unchanged; readers fail closed to explicit refusal/gap states, never to a crash and
  never to a silent default (spec §3.1 `unknown`, §4 R-CA-4).
- No `.amber/` re-layout (0060 scope) beyond the new `.amber/research/` store; no new
  default-surface verbs (F063); new CLI subcommands register outside the default
  journey/core projection per `command-help.js` tiers, and every new flag registers in
  the CLI output specs (FLAG_SPECS) — the known blind spot from memory: a flag not
  registered is parsed as a positional argument while unit tests stay green.
- `context_granted`/`context_denied` timeline enabling lands only with 0056's adopted
  rereview (0056 owns the schema enum).
- No new ledger family (0045); the citation store uses the existing factory.
- Legacy Loadouts/requests without the new fields read as pre-field records. Pre-field
  governed-ingest Context Pages and Required Artifacts never gain a **stored**
  classification (no backfill, no silent write-back); the spec §3.1 compatibility
  **effective projection** treats exactly those sources as effective `internal`,
  recorded via `classificationSource` so it is explicit and testable. Every other
  unlabeled source (ad-hoc, tool output) reads as `unknown` and fails closed under any
  ceiling. Pre-field requests never gain session bindings or context authority by
  inference.

## Acceptance Criteria

1. Every spec §8 invariant case exists as a product test at the real seam and passes.
2. The four audit counterexample families stay refused: encoded/excerpted restricted
   content in a declared flow; undeclared-flow honesty (no "safe" record); prepare
   without authorization; duplicate/missing settlement handling.
3. The §6.5 Research flow is demonstrated end to end in a fixture with the two
   timestamps distinct and `claim_supported` judged by an independent principal.
4. No surface claims containment, network absence, sole-human verification, or
   actual-payload identity (the F056 `payloadHash` binds declared hashes only — the
   bytes actually sent are an executor claim, E2).
5. Full gates (`npm test`, `manifests`, `doctor`, `gen:agents:check`) pass at the end of
   the slice sequence — run by the implementing packet, verified by the coordinator;
   this plan does not self-approve.

## Resume Checkpoint

- Resume Point: spec and plan proposed; zero slices started; run-contract container
  resolved in the spec (§4) and the run-contract spec edited surgically.
- Blockers: coordinator two-axis review of this spec/plan; 0056's rereview for Slice
  A's timeline half; the run-contract plan's Slice 1 for Slice F.
- Next Action: coordinator Standards + Spec review; then Slice A.
- Recovery Instructions: reopen this plan and continue at the first unchecked slice;
  do not regenerate unless the plan file is missing.
