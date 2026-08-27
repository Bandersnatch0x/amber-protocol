# F058: Instruction-Surface Adversarial Evals

**Status:** Proposed  
**Depends on:** F050  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#224](https://github.com/Bandersnatch0x/amber-protocol/issues/224)

## Problem Statement

Amber hardens the MCP adapter, Distillation Contract, and workflow-state breadcrumb, but those
controls are currently documented or adapter-enforced. A hostile source, a widened tool
description, or a forged `<amber-workflow-state>` block can still be treated by a host agent as
instructions. Without a versioned Eval, a passing test or a model red-team score can be mistaken
for authority, and the residual risk in the Context threat model stays untestable.

## Solution

Register the first F050 Eval suite, `instruction-surface`. Each Eval is a versioned, deterministic,
model-independent assessment of one instruction surface. Running the suite produces Eval results
that supply Evidence to a Gate. Results are not Approval, cannot execute target commands, and
cannot widen MCP or Runner authority. Assurance for a deterministic replay is `replayable`.

The suite covers three surfaces:

1. **MCP tool descriptions** — `tools/list` text is composed from the Action Type or Function
   contract and must not introduce instruction-override language or claim authority the contract
   does not grant.
2. **Context quote boundary** — Distillation Contract instructions and constraints treat source
   text as quoted evidence. Required Artifacts stay a closed non-page set; Context Pages cannot
   occupy the instruction tier.
3. **Breadcrumb authenticity** — only `hooks breadcrumb print` output for the current lifecycle
   snapshot is authentic. A Context Page (or other knowledge record) that embeds
   `<amber-workflow-state>` is an imitation, never next-step authority.

## User Stories

1. As an Eval owner, I want a versioned instruction-surface suite, so that the three surfaces are
   assessed together with a stable identity.
2. As a security owner, I want detectors to be model-independent and target-read-only, so that an
   Eval cannot become a red-team executor or a Gate-by-confidence.
3. As an MCP owner, I want tool descriptions derived from Action Type and Function contracts, so
   that `tools/list` cannot silently widen authority.
4. As an MCP owner, I want override phrases and unauthorized capability claims refused, so that a
   description cannot impersonate a system prompt or mutating verb.
5. As a Context owner, I want Distillation Contract instructions and constraints to declare the
   quote boundary, so that source text cannot be mistaken for Amber instructions.
6. As a Context owner, I want Required Artifacts kept off the Context Page path, so that ingested
   knowledge cannot enter the instruction tier.
7. As a lifecycle owner, I want printed breadcrumbs to carry a binding over the current snapshot,
   so that a copied or forged block fails verification.
8. As a lifecycle owner, I want embedded `<amber-workflow-state>` in Context Pages classified as
   imitation, so that knowledge records cannot impersonate the per-turn hook.
9. As a Gate consumer, I want a fail result to be Evidence with `replayable` assurance, so that it
   cannot impersonate Approval or `verified` assurance.
10. As an MCP consumer, I want `amber.eval.run` to execute read-only, so that the adapter never
    treats an Eval as a mutation.
11. As an operator, I want `amber eval run|list|show` to report without writing, so that CI can
    replay the suite without creating Canonical Artifacts.
12. As an auditor, I want stable finding codes, so that remediation does not depend on parsing
    prose.
13. As a test owner, I want one public seam at the suite result, so that detector internals can
    change without rewriting tests.
14. As a program owner, I want this Feature not to admit Canonical Eval Artifacts, so that F050
    remains the admission contract.

## Implementation Decisions

- Eval definitions live in the instruction-surface suite with closed identities
  `eval.instruction-surface.mcp-tool-description`,
  `eval.instruction-surface.context-quote-boundary`, and
  `eval.instruction-surface.breadcrumb-authenticity`.
- Detectors are deterministic and in-process. They do not call a model, spawn a host agent, or
  invoke ZeroLeaks / TAP / PAIR.
- MCP `tools/list` advertisements are produced by the shared tool surface
  (`mcpActionTool` / `mcpFunctionTool`). The Eval compares those advertisements to the contract
  composer and fails if `amber-mcp.js` no longer imports that surface.
- Instruction-override language is refused on every Action goal, Function description, and
  composed advertisement. Unauthorized mutating claims are refused on every read-only Action and
  every Function (contract text and composed advertisement).
- New Distillation Contracts are schemaVersion 1.3.0 with
  `constraints.treatSourcesAsQuotedEvidence` constantly true. The Eval scans persisted request
  files in the target and fails any contract that omits the flag or the quote-boundary instruction.
- Required Artifact kinds remain `operating-manual`, `route-manifest`, and `loadout-definition`.
  A path under `.amber/context/pages/` cannot be a Required Artifact.
- Breadcrumb print appends `Binding: amber-breadcrumb-v1 <hex>` over a canonical snapshot of
  target, focus, next step, and pending gate. Verification recomputes the snapshot; a missing or
  mismatched binding is a finding.
- Context Page block text containing `<amber-workflow-state>` is an imitation finding even when a
  binding happens to match. Amber never reads next-step authority from pages.
- Suite results use F050 Assurance `replayable`. They do not persist Canonical Eval Artifacts in
  this Feature; admission of Eval records remains F050.
- `amber eval run` is report-only. Exit 0 on an all-pass suite; exit 1 when any Eval has findings.
  MCP maps `amber.eval.run` as a registry-proven read.

## Testing Decisions

- The highest seam is the instruction-surface suite result, observed through `amber eval run`
  (CLI) or the same suite function the CLI calls. Detector functions are not a test seam.
- Tests assert public Eval identities, finding codes, assurance, suite pass/fail, exit code,
  `modelIndependent`, and the absence of writes.
- Semantic fixtures drive the suite: a drifted `tools/list` advertisement, an MCP server that
  drops the shared tool surface, an Eval source that references a model client, a persisted
  Distillation Contract without the quote boundary, a Loadout Required Artifact on the Context
  Page path, and a Context Page that embeds `<amber-workflow-state>`.
- Breadcrumb print binding remains covered on the existing F022 print seam; F058 only asserts
  authenticity through the suite (pass on a clean target, fail on page imitation).
- Prior art is MCP contract parity, Distillation Contract ingest, Loadout Required Artifacts, and
  breadcrumb print suites.

## Out of Scope

- Live LLM red-teaming, TAP trees, hosted scanners, or using a model score as Gate authority.
- Awarding `verified` assurance, human Approval, or Canonical Eval Artifact admission (F050).
- Changing MCP execution policy, ingest acceptance, or installing the breadcrumb hook
  automatically.
- Scanning Agent Entrypoints, wiki, or specs that mention the breadcrumb tag as documentation.

## Further Notes

This Feature is the first F050 Eval pack. It closes the residual risk named in the Context threat
model ("a host agent may still follow hostile prose") at Amber's own instruction surfaces without
granting execution authority. External red-team runs, if recorded later, enter as `observed`
Evidence and cannot satisfy a strict Gate by themselves.

Grilling (2026-08-27): the first report-only suite may land in the working tree before tracker
publish and is not rewound. Local Spec remains content authority; GitHub is the collaboration
mirror. Tests use one public suite seam. Canonical Eval admission and `verified` assurance stay
with F050.
