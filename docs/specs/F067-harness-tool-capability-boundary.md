# F067: Harness H1 — Tool / Capability / Effect / Credential Boundary

**spec_id:** F067
**Status:** draft
**Updated:** 2026-09-22
**Provenance:** Harness v2 proposal §9/§12/§25/§30 (Capability Boundary); F052 runner registry (`scripts/lib/core/runner-registry.js`, `resolveRequestCapability`) and F056 external-effect contracts as the existing authority surfaces; ADR-0100/0101/0102; wayfinder map `issues/0066`
**Feature:** F067

## Problem Statement

The Harness v2 proposal's H1 acceptance demands four separations that today live only as
conventions: **Tool ≠ Capability ≠ Credential ≠ Permission**, a closed effect taxonomy, and a
tool registry snapshot that can enter a Run. The governed runner (F052) and external-effect
registry (F056) already own capability resolution and approval, but there is no Tool
declaration artifact: nothing answers, for one declarable unit, "what is it, which capability
does it name, what effect class does it carry, which credential does it reference, and under
what policy does it sit" — and no run records which tool set it operated under. Without that,
tool drift (proposal §23) is undetectable and the capability boundary stays prose.

## Solution

One **Tool declaration artifact** and one **report-only policy check**, composing the
existing registries instead of duplicating them:

- **Tool schema** (`schemas/tool.schema.json`, `apiVersion: amber.dev/v1`): `metadata` (id,
  version), `capability` (a **reference** resolved through the existing F052 runner or F056
  external-effect pin — the tool never defines executable authority itself), `effect` (closed
  taxonomy per proposal §9), `credential` (a reference name, never material), `input`/`output`
  (schema refs), `limits` (timeout/rate), `governance` (approval policy reference),
  `observability` (record fields). Deliberate consolidation: proposal §30 lists four
  deliverable schemas; capability, effect class, and credential reference ride this one
  artifact as closed sub-shapes because each is meaningless outside a tool declaration.
- **Admission follows the H0 pattern**: `amber harness tool admit|list|inspect` — schema
  validation, canonical-JSON SHA-256 snapshot hash, immutable after admission, stored under
  the harness state area. `list` shows flagged tombstones for corrupt records; single reads
  refuse closed (F065 semantics, reused).
- **Connector ≠ Permission, test-enforced** (proposal §25): admitting a tool grants zero
  authority. The registry is a declaration surface; the invariant is a conformance test that
  proves an admitted tool's capability resolves only through the existing runner/external
  gates, and that the tool check is report-only.
- **Policy integration, report-only in H1** (proposal §30 acceptance 4): `amber harness tool
  check --tool <id>` evaluates the declared tool against the **existing** policy surface
  (loop-policy v2 capability rules / F050 policy outcomes) and reports the verdict it would
  receive; enforcement stays exactly where it is today — the runner/external gates.
- **Tool snapshot enters the Run** (proposal §30 acceptance 5): `run.schema.json` gains an
  additive optional `tools` section (registry snapshot hash + tool ids); a run started after
  H1 records the tool set it operated under, so tool drift is detectable per run (proposal
  §23).

## User Stories

1. As a maintainer, I want to admit a Tool declaration that names its capability through the
   existing F052/F056 pin, so that the registry describes authority without creating any.
2. As a maintainer, I want the tool to declare its effect class from a closed taxonomy, so
   that read-only and irreversible actions cannot blur.
3. As a maintainer, I want the tool's credential to be a reference name only, so that no
   secret material ever enters the harness state area.
4. As a reviewer, I want `amber harness tool check` to tell me which verdict the existing
   policy surface would give this tool, so that the boundary is inspectable without new
   enforcement.
5. As a reviewer, I want every run to record its tool-registry snapshot hash, so that tool
   drift between runs is detectable.
6. As a maintainer, I want re-admitting a changed tool under the same id to refuse, so that
   tool declarations are as immutable as contracts.
7. As a successor agent, I want `amber harness tool list` to show every admitted tool with
   its effect class and capability pin, so that the boundary is readable without code.

## Implementation Decisions

- **Compose, never duplicate**: the capability reference resolves through
  `resolveRequestCapability` (F052) or the F056 external-effect pin by id; a tool whose
  capability pin does not resolve refuses at admission (drift-bound, like the proposal's
  break-glass pins).
- **Closed effect taxonomy** (`read_only`, `local_write`, `command_execution`,
  `external_read`, `external_write`, `credential_use`, `destructive`, `irreversible`) with the
  proposal §9 default posture table recorded in the schema description; the taxonomy enum is
  shared with the tool schema only (loop-policy keeps its own vocabulary — no cross-module
  rewrite in H1).
- **Registry storage** reuses the contract pattern: `.amber/harness/tools/<id>.json` admission
  records with snapshot hashes; no new ledger family (tools are declarations, not events).
- **Run integration is additive** (`run.schema.json` + `tools` section; ADR-0012
  conventions): pre-H1 records stay valid; the snapshot hash is computed over the sorted
  admitted-tool set at run creation.
- **No new policy engine, no enforcement changes, no MCP projection** — `harness` stays
  untyped CLI-only; `tool` subcommands ride the untyped-subcommand list.

## Testing Decisions

- Conformance tests at the existing seams: tool admit/inspect/list through the command
  dispatcher; capability-pin resolution refusal when the F052/F056 pin is absent; the
  connector-≠-permission invariant as an explicit test (an admitted tool produces no new
  authorized action); tool-check verdicts against fixture policy rules; run snapshot section
  round-trip with the F065 run flow.
- Registry/parity pins update in the same batch (schema count 25→26; no new command — `tool`
  is a `harness` subcommand).

## Out of Scope

- Enforcement changes: the runner/external gates keep sole authority (H1 is declaration +
  report-only check).
- Execution adapters beyond the existing surfaces (H2); context firewall (H3); lifecycle
  unification beyond F065/F066 (H4); replay/validation receipts (H5); scheduler (H7).
- Credential material handling of any kind (references only).
- MCP projection of `harness tool` (untyped CLI-only).

## Further Notes

- Design decisions above are **recommendations adopted per the standing 「按推荐」 directive**
  (the standing pattern from F065/F066); the HITL confirmation ticket for this spec is
  `issues/0082`.
- Schema-count pin moves 25→26 in the same batch; naming/seam/guard constraints identical to
  F065/F066 batches.
