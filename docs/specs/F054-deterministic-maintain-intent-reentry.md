# F054: Deterministic Maintain & Intent Re-entry

**Status:** Proposed  
**Depends on:** F050  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#214](https://github.com/Bandersnatch0x/amber-protocol/issues/214)

## Problem Statement

Maintenance observations can currently become informal recommendations without a deterministic
rule, stable fingerprint, owner triage, or governed re-entry into planning. An Agent or detector
could repeatedly create work, treat correlation as a decision, or jump from a production symptom
to mutation without a new Intent and Gate.

## Solution

Add versioned deterministic Control Band detection, immutable Findings and Trigger Proposals, and
service-owner triage. Detectors are model-independent and target-read-only. Triage is restricted to
fix, schedule, or dismiss. Only an explicit human fix Decision creates a candidate Intent, which
must pass normal Intent admission. A shipped fix adds or updates an Eval.

## User Stories

1. As a service owner, I want version-controlled detectors, so that a Finding is reproducible.
2. As an operator, I want detector input, baseline, rule, window, and version recorded, so that alerts are explainable.
3. As an operator, I want a detector to create a Finding rather than mutate production, so that observation never becomes remediation.
4. As a service owner, I want Trigger Proposals distinct from formal Intent, so that automation cannot start work unilaterally.
5. As a service owner, I want triage limited to fix, schedule, or dismiss, so that maintenance decisions use a closed vocabulary.
6. As a service owner, I want only my verified fix Decision to create a candidate Intent, so that re-entry remains human-governed.
7. As a product owner, I want candidate Intent to pass normal scope, Policy, and Acceptance, so that incidents do not bypass planning.
8. As an operator, I want stable fingerprints and cooldown windows, so that repeated observations do not create proposal storms.
9. As an auditor, I want dismissals and schedules preserved with reasons, so that ignored Findings remain reviewable.
10. As an Eval owner, I want detector and threshold changes versioned, so that prior results become stale rather than silently reinterpreted.
11. As an Eval owner, I want a shipped fix to add or update an Eval, so that the defect becomes a regression signal.
12. As a security owner, I want diagnosis target-read-only unless a separate approved capability exists, so that maintenance cannot smuggle production writes.
13. As a query consumer, I want deterministic rollups without hidden truncation, so that maintenance reporting remains complete within declared bounds.

## Implementation Decisions

- A Control Band definition declares metric, source, baseline, deterministic rules, tiers, window,
  scope, version, resource limits, and permitted output type.
- Detector execution is target-read-only and model-independent. An Agent may analyze a Finding but
  cannot change the detector result or promote it to a Decision.
- Findings and Trigger Proposals are immutable governance records with stable fingerprints derived
  from subject, rule version, scope, and window.
- Repeated observations inside a cooldown append Evidence to the existing fingerprint rather than
  create duplicate Trigger Proposals.
- Triage Decisions are human, single-use across the maintain ledgers, and restricted to fix, schedule, or dismiss.
- Only fix creates a candidate Intent. Candidate Intent still requires canonical admission,
  Acceptance, Spec, Plan, and subsequent Gates.
- Detector, baseline, fixture, threshold, or Policy changes make dependent evaluations stale.
- A completed maintenance fix must reference a new or updated Eval definition and result.

## Testing Decisions

- The highest seam is observation fixture → detector → Finding and Trigger Proposal → triage →
  candidate Intent.
- Tests assert public Findings, fingerprints, Evidence, triage Decisions, candidate Intent, stable
  errors, and absence of target mutation.
- Exact fixtures cover detector definitions, output records, fingerprints, triage, and errors.
- Semantic fixtures cover each tier and triage outcome, cooldown, owner identity, no auto-Intent,
  no production mutation, Policy change, and Eval write-back requirement.
- Integrity fixtures cover changed inputs, baseline and detector hashes, duplicate observations,
  window boundaries under an injected clock, and tampered Evidence.
- Prior art is the maintenance finding and proposal, regression proposal, evolution rollup,
  organization audit, Eval-like verification, context benchmark, and ledger suites.

## Out of Scope

- Autonomous remediation, production mutation, scheduling or daemon execution, and model-defined thresholds.
- Deployment, external notifications, ticket creation, or break-glass.
- Treating a Trigger Proposal or Finding as an accepted Intent.

## Further Notes

This Feature closes the Maintain-to-Intent governance loop without granting a maintenance Runner.
