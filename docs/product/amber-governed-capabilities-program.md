# Amber Governed Capabilities Program

**Status:** Tracking  
**GitHub program issue:** [#208](https://github.com/Bandersnatch0x/amber-protocol/issues/208)  
**Source decisions:** Roundtable/grilling Q1–Q95, session `01a039a7-8fec-78e2-b28e-7572acf1cf99`

## Purpose

Ship the accepted Amber governance decisions as independently releasable increments. This is a
Program tracker, not a build-ready Spec and not a commitment to a particular release line or
version. Each child Feature has its own local Spec and GitHub mirror; only child Specs receive
`ready-for-agent`.

## Publication model

- The repository-local Spec is the content authority for each Feature.
- The corresponding GitHub Issue is a complete collaboration mirror and carries the local path and
  normalized UTF-8 SHA-256 hash.
- Changes are made as a new local Spec revision, then mirrored to GitHub. GitHub discussion does not
  silently mutate local authority.
- The RFC's “2.0” framing is source material, not the release label for these Features. Release
  assignment is decided separately by the release plan.

## Feature map

| Feature | Local Spec | Depends on | GitHub |
|---|---|---|---|
| F049 Canonical Planning Artifacts | `docs/specs/F049-canonical-planning-artifacts.md` | — | [#209](https://github.com/Bandersnatch0x/amber-protocol/issues/209) |
| F050 Decisions, Gates & Evidence Assurance | `docs/specs/F050-decisions-gates-evidence-assurance.md` | F049 | [#210](https://github.com/Bandersnatch0x/amber-protocol/issues/210) |
| F051 Read-only Adapters & Explicit Cutover | `docs/specs/F051-read-only-adapters-explicit-cutover.md` | F049 | [#211](https://github.com/Bandersnatch0x/amber-protocol/issues/211) |
| F052 Controlled Runner & Environment Boundaries | `docs/specs/F052-controlled-runner-environment-boundaries.md` | F050 | [#212](https://github.com/Bandersnatch0x/amber-protocol/issues/212) |
| F053 Release Prepare, Deploy & Rollback | `docs/specs/F053-release-prepare-deploy-rollback.md` | F052 | [#213](https://github.com/Bandersnatch0x/amber-protocol/issues/213) |
| F054 Deterministic Maintain & Intent Re-entry | `docs/specs/F054-deterministic-maintain-intent-reentry.md` | F050 | [#214](https://github.com/Bandersnatch0x/amber-protocol/issues/214) |
| F055 Retention, Coordinated Deletion & Proof | `docs/specs/F055-retention-coordinated-deletion-proof.md` | F051 | [#215](https://github.com/Bandersnatch0x/amber-protocol/issues/215) |
| F056 Registered External Side Effects | `docs/specs/F056-registered-external-side-effects.md` | F055 | [#216](https://github.com/Bandersnatch0x/amber-protocol/issues/216) |
| F057 Break-glass Authorization | `docs/specs/F057-break-glass-authorization.md` | F053, F056 | [#217](https://github.com/Bandersnatch0x/amber-protocol/issues/217) |
| F058 Instruction-Surface Adversarial Evals | `docs/specs/F058-instruction-surface-adversarial-evals.md` | F050 | [#224](https://github.com/Bandersnatch0x/amber-protocol/issues/224) |
| F059 Knowledge & Decision Map | `docs/specs/F059-knowledge-decision-map.md` | F049, F058 | [#246](https://github.com/Bandersnatch0x/amber-protocol/issues/246) |

## Dependency graph

```text
F049 → F050 → F052 → F053 → F057
  │       ├──────→ F054
  │       └──────→ F058 → F059
  ├──→ F059
  └──→ F051 → F055 → F056 → F057
```

## Program invariants

- Amber remains a governance layer, not a general Agent Runtime or arbitrary shell service.
- Governance Graph projections, GitHub Issues, Adapters, Markdown renderings, and Runner receipts do
  not become competing authorities.
- MCP executes only registry-proven read-only Actions; mutations remain approval-required and are
  never spawned by the MCP Adapter.
- AI cannot self-approve, self-verify, directly push main, mint standing production credentials, or
  invoke an unregistered external effect.
- Every target-write or external-write capability requires a dedicated accepted ADR before release.
- Existing narrow execution and Git transport exceptions remain unchanged until explicitly
  superseded by an accepted ADR.
