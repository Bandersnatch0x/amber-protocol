# Context Threat Model

Last Reviewed: 2026-08-10

This document defines the security boundary for Context Pages, Distillation Contracts, Source
Bundles, verification evidence, Loadouts, and derived projections. Accepted Context Pages and
accepted evidence are authoritative. Every index and report is disposable derived state.

## Trust Boundaries

- Source content is untrusted data, including target-local files, immutable excerpts, connector
  candidates, and explicitly selected transcripts.
- A Source Bundle candidate is not a Context Page. It must re-enter the normal Distillation Contract
  and ingest gate before any generated knowledge is accepted.
- The Target Repository boundary is mandatory. A lexical path, symlink, junction, or resolved real
  path outside the selected target is rejected.
- Context does not execute target-repository commands, call a model, dispatch agents, or grant
  governed execution authority.

## Threats And Controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Malformed or hostile source content | Schema validation, source provenance, hashes, citation checks, and explicit error codes | A valid source can still contain false claims; human review and source inspection remain necessary |
| Prompt injection embedded in a source | Source text is treated as quoted evidence, never as Amber instructions; connectors cannot execute commands or bypass ingest | A host agent may still follow hostile prose unless it preserves the Distillation Contract boundary |
| Lexical or realpath escape | Target-local resolution checks both the requested path and resolved filesystem target | Filesystem semantics can change after validation; load-time verification must remain immediate |
| Mutable source tampering | Raw and normalized hashes detect meaningful drift; changed sources require refresh | Normalization deliberately ignores cosmetic changes and is not a language parser |
| Immutable source tampering | Embedded excerpt and excerpt hash are checked independently | If all authoritative copies are rewritten together, repository history or external evidence is needed |
| Projection poisoning or drift | One projection writer records authoritative page hashes and a result hash; status fails closed on missing, corrupt, or mismatched state | A projection is unavailable until rebuilt; consumers must not silently use partial state |
| Cross-target access | Every connector call receives one explicit target, every path is resolved within it, and returned Source Bundles carry a hashed target binding | Operators can intentionally select the wrong target; consumers must validate the binding before later use |
| Sensitive artifacts | Transcript import is disabled by default, requires explicit selection and opt-in, and applies secret redaction | Redaction patterns cannot recognize every sensitive value; inspect candidates before persistence |
| Availability failure | Missing sources, projections, fixtures, and malformed evidence return explicit unavailable or error states | Amber does not provide a background repair service; recovery is operator-driven |
| Retention removes audit history | Retention is report-only; accepted pages and lineage evidence are always protected | Storage growth remains an operator concern |

## Verification Evidence

Successful ingest writes a verification record under `.amber/context/verification/`. The record binds
the page identifier, request identifier, accepted outcome, persisted page hash, and Amber-generated
verification time. Reports expose the time only while the page hash still matches. A time authored in
a Context Page is not verification evidence.

Assurance confidence and maturity are observations only. They do not affect source health, lineage,
Loadout eligibility, policy, approval, isolation, evidence gates, or execution confidence.

## Retention Matrix

| Artifact | Report eligibility | Protection |
| --- | --- | --- |
| Distillation Contract | Old and unreachable | Protected while it participates in accepted lineage |
| Agent payload | Old and unreachable | Protected while it supports accepted lineage |
| Accepted Context Page | Never eligible | Always protected |
| Verification evidence | Old and unreachable | Protected while it verifies an accepted or lineage-participating page |
| Loadout | Old and unreachable | Reported as disposable task-scoped state |
| Projection | Old and unreachable | Reported as disposable derived state |

The retention report does not delete, rewrite, archive, or move artifacts. Any future destructive
operation requires a separate governed design and explicit operator approval.

## Review Checklist

- Confirm every external input crosses the public Context interface and ingest gate.
- Confirm no connector writes an accepted page, Loadout, Feature State, or execution record.
- Confirm path checks cover lexical and resolved filesystem escape.
- Confirm transcript handling remains opt-in and redacted.
- Confirm projection consumers fail closed on missing, corrupt, incomplete, or drifted state.
- Confirm retention remains report-only and preserves accepted pages and lineage evidence.
