# ADR-0100: HarnessContract Is the Versioned, Immutable Total Contract of a Run

**Status:** Proposed (2026-09-22)
**Date:** 2026-09-22
**Builds on:** [ADR-0028](0028-ledger-family-factory-and-decision-primitives.md) (ledger factory),
[ADR-0029](0029-named-governed-commands-and-stage-verbs.md) (governed execution),
[ADR-0030](0030-coding-agent-enabled-repositories-and-trusted-continuation.md) (trusted continuation),
the F050 canonical-artifact contract, and the Harness v2 architecture proposal
(2026-09-14, `AMBER_HARNESS_ARCHITECTURE_V2-2.md` §5.1/§13/§14/§22).

---

## Context

The Harness v2 proposal (user-approved 2026-09-22) makes Amber the governed boundary around an
agent run. Its first foundational object is the **HarnessContract**: the total, immutable
contract for one run — which agent, under which policy, with which tools/context/execution
boundary, validated by what. Today no such object exists: the governed one-shot execution path
(ADR-0003) composes four gates ad hoc, and plans/sessions carry intent, not a frozen run-time
contract. H0 must add the object without granting new authority, duplicating the existing
F050 artifact/envelope machinery, or violating the two standing constraints: the homepage
story stays "trusted continuation" (six-audit decision 2026-09-22) and `harness` enters as an
expert-tier command, not a default verb.

## Decision

1. **One schema, full sections, minimal required.** `schemas/harness-contract.schema.json`
   declares `kind: HarnessContract`, `apiVersion: amber.dev/v1`. Sections follow the proposal:
   `agent`, `context`, `tools`, `execution`, `lifecycle`, `governance`, `observability`,
   `validation`. Required: `metadata.id`, `metadata.version`, `agent` (id + role),
   `governance.policy` reference. All other sections optional so a minimal contract is
   expressible on day one; absence of a section means "governed by the referenced policy",
   never "unbounded".
2. **Immutable after admission; identity is a snapshot hash.** Admission validates the schema,
   then freezes a canonical-JSON SHA-256 snapshot hash. The admitted bytes live under
   `.amber/harness/contracts/`. A Run records the hash, never a mutable reference. Contract
   or policy changes cannot silently reshape a started Run.
3. **Admission records checks; it grants no authority.** The AdmissionReceipt
   (`identity`, `contract`, `policy`, `context`, `execution`, `approval`) records each check
   as pass or refuse; a missing check is a refusal, not a warning. In H0 the checks bind to
   the **existing** governed gates of the first consumer (`loop run --execute`, ADR-0003):
   Harness admission records pointers to those gate outcomes and remains subordinate to them.
   Harness admission never executes anything and never self-approves.
4. **Surface is expert-tier only.** `amber harness admit|inspect|status` registers through the
   F063 tier mechanism as `expert`; the default seven-verb help surface is unchanged.
5. **Vocabulary.** CONTEXT.md carries **Harness Contract**, **Harness Admission**, and
   **Snapshot Hash** as governing terms.

## Consequences

A run's authority question ("凭什么允许它这么做") becomes answerable from one immutable
artifact plus its gate pointers. The cost: a new schema and state directory enter the
registry (blast radius tracked in `issues/0067`), and contracts must be re-admitted on any
structural change — cheap for the single-consumer H0, real later.

## Rejected alternatives

- **Embedding policy text inside the contract** duplicates the F050 policy object and creates
  a second authority; reference-plus-snapshot keeps Policy the ceiling.
- **Reusing the session manifest as the contract** overloads a settled continuity record
  (CONTEXT.md Session SSOT) with run-time authority semantics.
- **Making admission itself an execution gate** would give Harness new authority in H0;
  instead admission is a recorded witness of gates that already exist.
