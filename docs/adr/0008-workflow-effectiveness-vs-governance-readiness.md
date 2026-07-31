# ADR-0008: Workflow Effectiveness Review — a separate read-only assessment beside Governance Readiness

**Status:** Accepted (P0–P2 implemented; P3 partially — see Status detail)
**Date:** 2026-07-30
**Builds on:** ADR-0003 (governance-gated execution), ADR-0004 (evidence-grade verification), ADR-0005 (experimental execution removal), ADR-0007 (web viewer role)

**Status detail:** P0 (ADR/schema/fixtures), P1 (repository-only assessment), P2a (amber-native session provider + session-correlated LD/VC checks, findings/compare), P2b (Claude transcript provider wired into `buildReport`; cwd positive binding — mismatch is a hard exclusion AND at least one matching cwd line is required; newest-20 transcript cap; redaction on summary fields) are implemented. P2 web visualization in `apps/web` is deferred. P3 structured intervention ledger (mechanism + validation-state vocabulary) is deferred; `il-3-intervention-validated` reports `not-applicable` honestly until the ledger lands. Longitudinal `compare` includes schema-version-mismatch detection and suspicious score↑/coverage↓ flags. The `workflow plan --dry-run` bridge emits plan-input or maintenance-proposal drafts.

---

## Context

Amber's Governance Readiness Report (`scripts/lib/core/governance-report.js` +
`governance-readiness.js`) answers one question well: *are the required controls,
evidence surfaces, and safety boundaries installed and valid?* A repository can
score 100/100 ready and still run an ineffective agent workflow — the readiness
vocabulary has no way to express that gap.

Research (`docs/quality/better-harness-reference-improvement-plan.md`) surveyed
an external reference ("Better Harness") and recommended adding a second,
separate read-only assessment: **Workflow Effectiveness Review** — "did the
agent understand the task, use a controlled path, validate the result, deliver
safely, and preserve learning?"

This ADR establishes that second assessment, fixes its boundary against
readiness, and — critically — fixes its **provenance boundary** so Amber does
not import the reference project's expression, only the general idea.

## Decision

Add a read-only **Workflow Effectiveness Review** beside the existing
Governance Readiness Report. The two answer different questions and are never
merged into a single score.

### Readiness vs Effectiveness

| Assessment | Owner | Question | Existing surface |
|---|---|---|---|
| Governance Readiness | `governance-readiness.js` / `governance-report.js` | Are required controls and evidence surfaces installed and valid? | Unchanged; 100/100 remains meaningful |
| Workflow Effectiveness | `scripts/lib/workflow-assessment/` (new) | Does available evidence support effective execution across the dimensions? | New `amber workflow assess` command family |

A 100/100-ready repository may still score low or `null` on effectiveness.
Effectiveness never reads readiness's `overall` score; readiness semantics are
unchanged. No combined overall effectiveness score ships until calibration
fixtures prove it adds meaning (deferred to P3).

### Dimensions (Amber vocabulary, not the reference's)

Effectiveness is scored across five dimensions. The dimension names are drawn
from Amber's existing control layers (see CLAUDE.md "Control Layers"), not from
any external project's workflow model:

| Dimension | Amber layer | What it asks |
|---|---|---|
| **Context Adequacy** | Context | Do plans, feature state, and routes give an agent enough to understand the task? |
| **Lifecycle Discipline** | Lifecycle | Did execution stay on a declared controlled path (routes, gates, policies, worktrees, approvals)? |
| **Verification Coverage** | Verification | Is there evidence that checks actually ran and failures were preserved? |
| **Delivery Integrity** | (handoff/approval surface) | Was the result delivered through approval and handoff with risks recorded? |
| **Improvement Loop** | (evolution/distill/maintenance) | Is recurring friction captured and later validated against outcomes? |

### P1 boundary — repository-only, static shape

The first implementation slice (P1) is **repository-only**: it reads static
repository artifacts plus `.amber` non-session telemetry artifacts only.
Specifically in scope: `feature_list.json`, `docs/plans/*.md`, `routes/*.route.json`,
`.amber/governance/rules.json`, `workflow-packs/*.pack.json`, `.amber/handoff/latest/`,
`.amber/executions/*/evidence.json`, `docs/wiki/engineering/harness-evolution.md`,
`docs/AGENTS.md`, `package.json`.

**Explicitly out of scope for P1:** parsing `.amber/sessions/<id>/timeline.jsonl`
event sequences or correlating `manifest.json` goals with runtime events. P1's
Lifecycle Discipline and Verification Coverage dimensions check **static shape**
(route declares a gate; verify command is discoverable; execution evidence
records commands) — not whether a gate was actually triggered in a specific
session. Session-event correlation is P2 (Amber-native sessions and ledgers) and
P3 (optional host transcripts).

### Read-only and action-bridged

Effectiveness commands are read-only by default. Findings may bridge only to
dry-run `amber plan` or `maintenance propose` inputs — never direct edits to
code, rules, skills, hooks, or configuration. This inherits ADR-0003's and
ADR-0005's execution boundaries.

### Provenance boundary (no external expression import)

The Workflow Effectiveness Review borrows the **general idea** of separating
pre-work guidance from post-work evidence, but does **not** adopt the external
reference's expression. Concretely:

1. **Dimension names** are Amber's own (Context Adequacy, Lifecycle Discipline,
   Verification Coverage, Delivery Integrity, Improvement Loop) — not the
   reference's "Agent Work Loop" part names. Where a name shares a generic
   English word root with the reference (e.g. "Delivery"), the name is a
   common-word combination, not the reference's proprietary term or structure;
   the protection is the Amber-specific naming and the Amber control-layer
   anchor, not the avoidance of ordinary English words.
2. **Report contract** (`schemas/workflow-assessment.schema.json`) follows
   Amber's existing schema style (JSON Schema draft-07, `schemaVersion`
   const, `$id` under `amber-protocol.dev`, nested `definitions` for reusable
   sub-shapes — aligned to `knowledge-plan.schema.json` /
   `loop-contract.schema.json`), not the reference's report-source structure.
3. **Provider capability fields** are described in Amber's existing
   governance/readiness vocabulary, not the reference's capability enum.
4. **Evidence lanes** (repository / session / delivery / agentAssets) are
   Amber's own coverage decomposition keyed to Amber's control layers; the
   reference's project/session/delivery/configured-agent lane names are not
   imported. Session observations flow through a provider-neutral observation
   contract (`scripts/lib/workflow-assessment/internal/observation-contract.js`) whose
   field names are Amber's, not the reference's.
5. **Learning intervention linkage** (P3) reuses Amber's evolution log +
   feature_list `accepted` state as the intervention→outcome trail, not a
   port of the reference's intervention ledger structure.
6. Generic, widely-used concepts (covered/partial/unavailable/not-applicable
   states; nullable scores; low/medium/high confidence; evidence references)
   are not proprietary to any one project and are used where they fit.

If any future contribution copies the reference's terms, structure, or field
names verbatim, it violates this ADR and must be re-expressed in Amber
vocabulary before merge.

## Consequences

**Positive:** The 100/100 readiness score stops being misleading — a second
honest assessment can show effectiveness gaps or insufficient evidence without
contradicting readiness. A clean provenance boundary keeps the feature
defensible as Amber-original work.

**Negative:** Two scorecards means two things to render (CLI and web). The web
visualization is deferred to P2; P1 ships CLI Markdown/JSON only. Providers
beyond amber-native are `unsupported` in P1 — users on Claude/Codex/Cursor see
explicit "unsupported" coverage, not fabricated scores.

**Neutral:** No combined overall score until P3 calibration. Dimensions may
report `null` with "insufficient evidence" — this is honest, not a failure
state, and must display distinctly from a readiness 0.

## Related

- ADR-0003 (governance-gated execution — the five preconditions)
- ADR-0004 (evidence-grade verification — evidence references and confidence)
- ADR-0005 (experimental execution removal — no live agent dispatch)
- ADR-0007 (web viewer role — supervised action viewer; web visualization deferred)
- `docs/quality/better-harness-reference-improvement-plan.md` — research input
- `schemas/workflow-assessment.schema.json` — report contract (P0)
- `scripts/lib/workflow-assessment/` — assessment core (P1)
