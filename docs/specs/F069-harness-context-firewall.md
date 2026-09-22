# F069: Harness H3a — Context Firewall (Grants, TTL, Purpose, Denials)

**spec_id:** F069
**Status:** accepted
**Updated:** 2026-09-22
**Provenance:** Harness v2 proposal §4.3/§11/§32 (Context Firewall) and §23 (threat table); the existing governed context surfaces — F017 lifecycle, F027 role-scoped manifests, `schemas/context-loadout.schema.json` (classification is fixed, not caller-settable; redactions ledger with `classification-ceiling` / `purpose-mismatch` reasons), `docs/architecture/context-threat-model.md` — as the composed authority; ADR-0102 (additive event types; amended 2026-09-22: runId is required only for run-scoped kinds — context.* events carry actor/action instead); wayfinder map `issues/0066`; user confirmation 2026-09-22 (`issues/0094`, 「按推荐」)
**Feature:** F069

## Problem Statement

The governed context surfaces already classify artifacts (the loadout's fixed classification,
its redactions ledger omitting fields for `classification-ceiling` or `purpose-mismatch`) —
but the missing layer is the **runtime grant**: nothing answers, deterministically and from
records, "may subject S see resource R for purpose P right now, until when, and why was
something hidden". Harness v2 §11 defines the shape (Grant = Subject × Resource × Purpose ×
Time × Policy) and §32 demands the firewall: classification, purpose binding, TTL, provenance,
redaction, grant event, denied-access event. Without grants, the redaction reasons are computed
but never bound to an authorization record a reviewer can inspect.

## Solution

A **ContextGrant artifact + deterministic report-first firewall check**, composing the existing
classification machinery:

- **ContextGrant** (`schemas/context-grant.schema.json`, `apiVersion amber.dev/v1`): the
  admitted, immutable declaration `{subject, resource (path/pattern prefixes), purpose,
  classificationCeiling, validFrom/validUntil (half-open TTL), policy pin}` — the H0 pattern
  (Snapshot Hash, immutability, tombstones) under the harness state area. §11's formula,
  literally.
- **Revocation** is a governed follow-up record (not an edit): a revoke entry terminalizes a
  grant; revoked grants stay listable forever (the retention discipline of every other
  registry).
- **Firewall check, report-first** (`amber harness context check --subject S --resource R
  --purpose P [--now ISO]`): the deterministic verdict from the granted set — `allow` with the
  covering grant pointer, or `deny` with a closed reason (`no-grant`, `expired`, `revoked`,
  `purpose-mismatch`, `classification-above-ceiling`). The check reads labels only, never
  values (threat-model discipline); enforcement of what an agent actually loads stays with the
  existing host/context surfaces (H3b boundary, below).
- **Events**: the harness event type enum grows additively (`context.granted`, `context.denied`,
  `context.revoked`) per ADR-0102's additive rule; denials record the closed reason and the
  checked triple, never resource values.
- **Run integration is optional and additive**: a run may cite the grants it operated under
  (pointer list) — no forced coupling in H3a.

## User Stories

1. As a maintainer, I want to admit a grant binding one subject to resource prefixes for one
   purpose with a half-open TTL and a classification ceiling, so that access has one
   reviewable authorization record.
2. As a maintainer, I want to revoke a grant terminally without deleting it, so that revocation
   is visible forever and never a silent rewrite.
3. As a reviewer, I want `context check` to tell me allow/deny with the exact reason
   (`expired`, `purpose-mismatch`, `classification-above-ceiling`, …), so that "why was it
   hidden / when did access expire" is one command.
4. As a reviewer, I want grant and denial events on the tamper-evident trail, so that access
   history is unfalsifiable.
5. As a maintainer, I want the firewall to read labels only, so that the check itself never
   becomes a value-exfiltration surface.
6. As a successor agent, I want a run to cite the grants it operated under, so that context
   authority is traceable per run.

## Implementation Decisions

- **Compose, never duplicate**: classification values and redaction reasons reuse the existing
  loadout vocabulary (no new taxonomy, no cross-module rewrite); grants reference the same
  resource identifiers the loadout already carries.
- **Report-first (H3a)**: the check never gates the existing context lifecycle (F017/F027
  unchanged); wiring the firewall into the actual context-loading path is **H3b**, a separate
  ticket behind this evidence (same staged pattern as H2a/H2b).
- **Admission follows the H0 pattern** (Snapshot Hash, immutability, tombstones); grants live
  under the harness state area; no new ledger family — grant/denial facts ride the existing
  event ledger.
- **TTL is half-open** `[validFrom, validUntil)` with no clock-skew tolerance (the approval
  registry's discipline); expiry is a read-time projection, never an edit.
- **Events are additive** (event.schema.json + enum table), never a second trail.
- **CLI stays untyped, expert tier**; `harness context` subcommands join the
  untyped-subcommand list; schema-count pin 27→28 in the same batch.

## Testing Decisions

- Conformance tests at the existing seams: grant admit/immutable/tombstone (the tools pattern);
  the deterministic check across every closed deny reason and the allow path (with TTL
  boundaries: before window, inside, after); revocation terminality; additive event types on
  the real ledger; run citation round-trip.
- A good test asserts externally observable behavior (verdicts, reasons, pointers), never
  internals.

## Out of Scope

- H3b: wiring the firewall verdict into the actual context-loading path (host entry/loadout
  build) — separate ticket behind this evidence.
- Value-level redaction changes (the loadout's redactions ledger is composed, not modified);
  MCP projection; replay (H5); scheduler (H7); homepage/charter change.

## Further Notes

- Design decisions above are **recommendations adopted per the standing 「按推荐」 directive**;
  the HITL confirmation ticket for this spec is `issues/0094`.
- Naming/seam/guard constraints identical to F065–F068 batches; schema-count pin 27→28 in the
  same batch.
