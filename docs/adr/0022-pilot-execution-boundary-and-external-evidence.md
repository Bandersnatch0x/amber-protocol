# ADR-0022: 2.0 Pilot Is Governance-Only with Admissible External Evidence

**Status:** Accepted (2026-08-26)
**Date:** 2026-08-26
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (no live agent runtime),
[ADR-0003](0003-governance-gated-execution.md) (governed execution preconditions),
[ADR-0004](0004-evidence-grade-verification.md) (evidence-grade verification),
[ADR-0005](0005-experimental-execution-removal.md) (execution removal)

---

## Context

The 2.0 play model describes Build, Test, Deploy, and Maintain, but the first vertical slice must
prove artifact and gate contracts without expanding Amber into a target command runner. A governance
layer may still need to consume results produced by a human or an independently governed CI/runner.
Without a receipt contract, a claim that a command "passed" is indistinguishable from verified
Evidence.

## Decision

1. The first 2.0 Pilot is a single-repository, read-only governance slice covering
   Intent -> Spec -> Plan -> Gate -> Trace, schemas, stable failures, and projection rebuild. Amber
   does not modify target code, execute target commands, deploy, repair production, or dispatch live
   agents as part of this Pilot.
2. An external runner may submit an Evidence receipt, but strict Gates admit it only when the receipt
   identifies the runner or execution principal, command/test definition hash, inputs and target
   scope, environment and tool versions, timestamps, exit status, output reference or digest,
   artifact/commit hashes, and an integrity-protecting receipt.
3. Evidence Assurance is explicit: `unavailable`, `observed`, `replayable`, or `verified`. A Gate
   declares its minimum assurance and required fields. Claim-only, simulated, dry-run, stale, or
   scope-mismatched records cannot satisfy a `verified` Gate.
4. Executed, dry-run, simulated, and unavailable outcomes remain distinct in the ledger and in
   projections. Evidence of an external action grants Amber no execution authority.
5. Any future Amber execution capability, including production runbooks, requires a separate ADR
   that defines the closed Action Type, policy, approval, isolation, target confinement, credentials,
   recovery, and execution ledger.

## Consequences

The Pilot can be replayed and audited without making Amber a runner. CI integrations need a stable
receipt adapter and may initially produce only `observed` or `replayable` Evidence. The boundary
slows automation claims but prevents an evidence record from silently becoming an authority grant.

## Rejected alternatives

- Accepting arbitrary logs or a zero exit code would make assurance non-deterministic.
- Expanding the Pilot to code mutation, deployment, or auto-remediation would reopen execution
  boundaries already closed by the existing ADRs.

## Related

- Amber 2.0 RFC Roadmap, §§5–7 and M0 (Draft RFC-0.2, 2026-08-26)
- [ADR-0020](0020-governed-live-git-transport.md) (narrow, separately governed Git exception)

