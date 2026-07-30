# Research: Better Harness reference and Amber improvement plan

**Date:** 2026-07-30  
**Amber baseline:** `58be40b0fcd51da6c2edbb214f5cacd39f48168d`  
**Better Harness baseline:** [`205d4e04c2021b830bba1bea1c9a1a92746c7f2e`](https://github.com/QoderAI/better-harness/tree/205d4e04c2021b830bba1bea1c9a1a92746c7f2e)  
**Research scope:** product positioning, assessment model, evidence collection, host adapters, report contracts, session analysis, learning capture, and delivery roadmap.

## Decision

Amber should not become a Better Harness clone or a general coding-agent runtime.

The useful move is to add a read-only **Workflow Effectiveness Review** beside the existing **Governance Readiness Report**:

- Governance readiness answers: "Are the required controls, evidence surfaces, and safety boundaries present?"
- Workflow effectiveness answers: "Did the agent understand the task, use a controlled path, validate the result, deliver safely, and preserve learning?"

These are different claims. Amber currently measures the first one well. Better Harness provides a useful model for the second one.

The recommended product shape is:

> Keep Amber as the repository-local governance and evidence protocol, then add a deterministic, evidence-bounded effectiveness assessor that turns findings into reviewable Amber plans and maintenance proposals. Do not add live agent dispatch, automatic repair, or implicit target-project execution.

## Evidence snapshot

### Better Harness

At the pinned upstream commit, Better Harness:

- defines a five-part Agent Work Loop: Task Understanding, Controlled Execution, Change Validation, Reliable Delivery, and Learning Capture;
- combines feedforward assets such as `AGENTS.md`, specs, skills, and acceptance criteria with feedback sensors such as tests, hooks, reviews, and session evidence;
- keeps project, session, and configured-agent evidence separate before reconciliation;
- models partial and unavailable evidence explicitly instead of inventing coverage;
- uses host capability boundaries rather than assuming Claude Code, Codex, Cursor, Qoder, and other hosts expose identical data;
- has a versioned report-source contract with evidence references, confidence, diagnostic coverage, and learning-capture fields;
- treats report generation and mutation as separate phases.

Primary sources:

- [README](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/README.md)
- [Agent Work Loop model](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/models/agent-work-loop.md)
- [Better Harness skill workflow](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/skills/better-harness/SKILL.md)
- [Architecture](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/docs/ARCHITECTURE.md)
- [Host adapter matrix](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/docs/adapters/README.md)
- [Report-source implementation](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/scripts/harness-analysis/report-source/source.mjs)
- [Roadmap](https://github.com/QoderAI/better-harness/blob/205d4e04c2021b830bba1bea1c9a1a92746c7f2e/roadmap.md)

The upstream repository was created on 2026-07-21 and had no published GitHub releases at the research baseline. Its ideas and contracts are useful references, but its age argues against copying its full implementation surface wholesale.

The upstream CLI was not executed against Amber because Better Harness declares Node `>=22.20.0`, while the local runtime is Node `22.19.0`. Conclusions here are source-based, not derived from an upstream-generated report.

### Amber

Amber's self-checks at the local baseline reported:

- `doctor`: product repository, zero errors and warnings;
- `governance report`: ready, 100/100 overall, no next actions;
- evidence: three sessions, three executions, five commands, and five approvals;
- maintenance: no stale docs or wiki errors, with three failure-derived regression proposals.

Relevant local sources:

- [`scripts/lib/core/governance-report.js`](../../scripts/lib/core/governance-report.js)
- [`scripts/lib/core/governance-readiness.js`](../../scripts/lib/core/governance-readiness.js)
- [`scripts/lib/core/maintenance.js`](../../scripts/lib/core/maintenance.js)
- [`scripts/lib/distill-candidates.js`](../../scripts/lib/distill-candidates.js)
- [`scripts/lib/session-timeline.js`](../../scripts/lib/session-timeline.js)
- [`schemas/session-manifest.schema.json`](../../schemas/session-manifest.schema.json)
- [`schemas/timeline-event.schema.json`](../../schemas/timeline-event.schema.json)
- [`apps/web/server/lib/claude-transcript-reader.ts`](../../apps/web/server/lib/claude-transcript-reader.ts)
- [`apps/web/server/lib/redaction.ts`](../../apps/web/server/lib/redaction.ts)

The important gap is not readiness. It is that a fully ready repository can still have an ineffective agent workflow, and the current 100/100 report has no vocabulary for expressing that difference.

## Capability comparison

| Area | Amber today | Better Harness reference | Recommended treatment |
| --- | --- | --- | --- |
| Governance controls | Strong: policies, routes, gates, approvals, worktrees, ledgers | Evaluates whether controls exist and are used | Keep Amber as source of truth |
| Task understanding | Plans, feature state, behavior and verification fields | Dedicated dimension with evidence and confidence | Add effectiveness checks over existing artifacts |
| Controlled execution | Amber's strongest area | Dedicated dimension across skills, commands, MCP, and sandboxing | Reuse Amber evidence, do not add a new runtime |
| Change validation | Strong for governed Amber execution | Correlates repository and session validation signals | Add evidence normalization and coverage states |
| Reliable delivery | Handoff, approvals, recovery, clean-state checks | Dedicated delivery dimension | Map existing evidence into a separate scorecard |
| Learning capture | Evolution log, distill candidates, maintenance and regression proposals | Structured recurring-issue and intervention loop | Replace text-only recurrence with structured episodes over time |
| Session evidence | Amber timeline plus Claude transcript reader in the web app | Provider-aware session analysis | Add explicit provider capabilities and normalized observations |
| Reporting | Governance Markdown/JSON and web views | Versioned report source plus Markdown/HTML output | Add a schema-first effectiveness report consumed by CLI and web |
| Follow-up action | `next`, `plan`, `maintenance propose`, approval gates | Finding-bound repair planning | Bridge findings to dry-run Amber artifacts only |
| Automatic execution | Narrow, explicit, governed one-shot execution | Separates planning from mutation | Do not broaden Amber's execution boundary |

## Adopt, adapt, reject

### Adopt directly

- The five effectiveness dimensions as a stable review vocabulary.
- Separate project, session, delivery, and configured-agent evidence lanes.
- Explicit `covered`, `partial`, `unavailable`, and `not-applicable` states.
- Evidence references and confidence on every conclusion.
- A versioned, renderer-independent report contract.
- Provider capability declarations that fail closed.
- Learning interventions linked to later validation.

### Adapt to Amber

- Use deterministic CLI collectors and schemas as the primary assessor. Optional host agents may interpret evidence, but they must not own authoritative scores.
- Convert findings into `amber plan` or `maintenance propose` inputs, never direct edits.
- Reuse Amber timelines, execution ledgers, approvals, handoffs, and regression proposals as high-grade evidence.
- Render the same report contract through CLI Markdown/JSON and the existing web viewer.
- Treat host transcripts as optional evidence with safe redaction and workspace binding.

### Reject

- Requiring multiple live reviewer agents to generate a normal report.
- Reading user-home memories or raw transcripts by default.
- Automatic fix/apply from a finding.
- A second workflow runner, scheduler, model router, or agent dispatcher.
- Combining readiness and effectiveness into one headline number.
- Claiming equal support across hosts when their evidence APIs differ.

## Target product surface

Add a new read-only command family without changing the semantics of `governance report`:

```text
amber workflow assess --target <repo> [--no-sessions] [--provider <id>]
                      [--since <date>] [--format json|markdown]
                      [--output-dir <path>]

amber workflow findings --report <report.json>
amber workflow plan --report <report.json> --finding <id> --dry-run
amber workflow compare --baseline <old.json> --current <new.json>
```

Command rules:

- `assess`, `findings`, and `compare` are read-only except for an explicit report output directory.
- `plan` produces a proposed Amber plan or maintenance proposal and never edits target code or agent configuration.
- `--no-sessions` must produce a valid repository-only baseline.
- Unsupported or inaccessible providers must return explicit coverage, not fallback to another host's cache.
- Machine modes keep stdout parser-safe and put diagnostics on stderr.

Suggested artifacts:

```text
.amber/reports/workflow-assessment/<timestamp>/
  report.json
  report.md
  evidence-manifest.json
```

## Two scorecards, not one

The UI and CLI should show two independent panels.

| Scorecard | Owner | Meaning |
| --- | --- | --- |
| Governance Readiness | Existing governance report | Required controls and evidence surfaces are installed and valid |
| Workflow Effectiveness | New workflow assessor | Available evidence supports effective execution across the five dimensions |

Rules for effectiveness scoring:

- A dimension score may be `null` when minimum evidence is unavailable.
- Confidence is independent from score: `low`, `medium`, or `high`.
- Static asset counts never directly create a score.
- Finding count never directly determines a score.
- Missing evidence lowers coverage or confidence; it does not automatically prove failure.
- `not-applicable` does not penalize a dimension.
- No combined overall score should ship until calibration fixtures demonstrate that it adds meaning.

## Dimension mapping

| Dimension | Existing Amber evidence | First additional checks |
| --- | --- | --- |
| Task Understanding | `AGENTS.md`, feature behavior, verification, plans, route trigger | Goal and done criteria present; scope boundaries explicit; verification linked to the task; relevant context source recorded |
| Controlled Execution | routes, gates, policies, worktrees, approvals, command ledger | Selected route matches task; required gates were exercised; execution stayed within declared boundaries; retries and bypasses are visible |
| Change Validation | verification events, execution evidence, CI references, complete checks | Relevant checks actually ran; failures are preserved; claims distinguish self-report from command evidence; changed surface has validation coverage |
| Reliable Delivery | acceptance records, handoff bundle, recovery commands, clean state | Reviewer decision present; unresolved risks preserved; recovery path exists; delivery did not bypass required approval |
| Learning Capture | evolution log, distill candidates, regression proposals, maintenance proposals | Recurring friction is structured; an owner and intervention are selected; later work validates whether the intervention helped |

## Report contract

Add a public schema such as `schemas/workflow-assessment.schema.json`.

Minimum shape:

```json
{
  "schemaVersion": "1.0.0",
  "target": ".",
  "scope": {
    "repository": true,
    "sessions": "partial",
    "providers": ["amber-native"]
  },
  "coverage": {
    "repository": "covered",
    "session": "partial",
    "delivery": "covered",
    "agentAssets": "covered"
  },
  "dimensions": {
    "taskUnderstanding": {
      "score": 78,
      "confidence": "medium",
      "evidenceRefs": ["repo:feature:F011"]
    }
  },
  "findings": [
    {
      "id": "learning-intervention-not-validated",
      "dimension": "learningCapture",
      "severity": "warning",
      "confidence": "high",
      "summary": "Recurring failures produce proposals but no later outcome check.",
      "evidenceRefs": ["amber:maintenance:regression-proposals"],
      "owner": "maintenance",
      "verifier": "A later assessment links the intervention to a changed outcome.",
      "actionKind": "maintenance-proposal"
    }
  ]
}
```

Every finding must include:

- stable ID and dimension;
- severity and confidence;
- concise consequence and cause;
- evidence references;
- smallest responsible owner;
- verifier;
- allowed action kind;
- coverage limitations or disagreements when relevant.

Raw prompts, assistant text, transcript bodies, secrets, and full command output must not enter the report contract.

## Architecture

```text
CLI / Web
   |
workflow-assessment facade
   |
   +-- repository evidence provider
   +-- Amber session and ledger provider
   +-- optional host session providers
   +-- delivery evidence provider
   +-- configured-agent asset provider
   |
normalized evidence bundle
   |
deterministic checks and scoring
   |
versioned report source
   |
Markdown / JSON / Web renderers
   |
dry-run plan and maintenance-proposal bridge
```

Suggested ownership:

| Owner | Responsibility |
| --- | --- |
| `scripts/lib/workflow-assessment/` | Evidence contracts, checks, scoring, findings, and report assembly |
| `scripts/lib/workflow-commands.js` | CLI orchestration and output selection |
| `schemas/workflow-assessment.schema.json` | Public report contract |
| `scripts/lib/workflow-assessment/providers/` | Capability-scoped evidence providers |
| `apps/web/` | Read-only report visualization and comparison |
| `scripts/lib/core/maintenance.js` | Consume accepted structured interventions, not own assessment logic |

Do not couple the CLI directly to `apps/web/server/lib/claude-transcript-reader.ts`. Define a provider-neutral observation contract first, then let CLI and web adapters implement it independently or share a deliberately extracted module.

## Delivery slices

### P0: Semantics and contract

Deliver:

- ADR separating governance readiness from workflow effectiveness;
- five-dimension vocabulary and evidence-grade definitions;
- report JSON schema, finding schema, and coverage states;
- fixture reports for complete, partial, unavailable, and not-applicable evidence.

Acceptance:

- existing `governance report` output and scores remain backward compatible;
- a report cannot validate without evidence references and confidence;
- insufficient coverage produces `null` score rather than fabricated certainty.

### P1: Repository-only assessment

Deliver:

- `amber workflow assess --no-sessions`;
- repository evidence provider for agent docs, feature state, plans, routes, gates, validation commands, hooks, and handoff surfaces;
- deterministic Markdown and JSON renderers;
- focused unit and fixture tests.

Acceptance:

- works without an installed coding-agent host;
- same repository state produces stable normalized JSON;
- report lists both strengths and prioritized findings;
- no writes occur unless `--output-dir` is supplied.

### P1: Provider capability registry

Deliver:

- explicit capabilities per provider: configured assets, session evidence, usage evidence, permission evidence, output modes, and mutation support;
- `supported`, `partial`, and `unsupported` states;
- consistency tests across CLI help, provider registry, docs, and report coverage.

Acceptance:

- no provider silently reads another provider's cache or home directory;
- missing model, token, hook, or session data stays unavailable;
- adding a provider requires discovery, evidence, privacy, output, packaging, and smoke contracts.

### P2: Session evidence

Deliver in this order:

1. Amber-native sessions and ledgers.
2. Existing Claude transcript support with workspace binding and default redaction.
3. Codex or Cursor only after a stable, documented source is available.

Use a derived `session-observation` contract instead of expanding the generic timeline `data` object without bounds.

Initial normalized signals:

- task goal and completion claim;
- route and stage transitions;
- validation commands and outcomes;
- failures, retries, and recovery;
- approvals and denied or escalated actions;
- duration and usage only when the provider supplies reliable values;
- repeated workflow and friction candidates.

Acceptance:

- raw transcript content is not persisted in reports;
- redaction is on by default;
- workspace mismatch is a hard exclusion;
- partial session evidence lowers coverage and confidence without blocking repository-only output.

### P2: Report UX and action bridge

Deliver:

- web view with five dimensions, coverage, evidence drill-down, findings, and comparison;
- finding-bound `workflow plan --dry-run`;
- links from findings to existing Amber plans, maintenance proposals, or regression proposals.

Acceptance:

- users can distinguish missing evidence from a confirmed gap;
- every proposed action names its owner and verifier;
- no finding can directly apply a code, rule, skill, hook, or configuration change.

### P3: Structured learning capture

Current learning is useful but fragmented: `distill-candidates` counts text recurrence, maintenance counts evolution findings, and transcript failures can create regression proposals. Add a structured episode and intervention ledger that links them.

Deliver:

- recurring issue candidate with normalized signature and evidence refs;
- intervention record with selected mechanism: rule, skill, hook, gate, command, test, spec, or documentation;
- later validation state: pending, improved, unchanged, regressed, or inconclusive;
- maintenance proposal generation from structured records, retaining the existing Markdown path for compatibility.

Acceptance:

- recurrence is not based only on matching prose;
- an intervention cannot be marked successful without later evidence;
- rejected and inconclusive interventions remain visible;
- worker output cannot self-approve the learning outcome.

### P3: Longitudinal comparison

Deliver:

- `workflow compare` across compatible report schema versions;
- dimension, coverage, finding, and intervention deltas;
- a small trend view in the web app.

Acceptance:

- reports compare normalized evidence, not raw transcript text;
- schema migration is explicit;
- a higher score with lower coverage is flagged, not presented as an unconditional improvement.

## Recommended first implementation slice

Start with repository-only assessment. It has the best value-to-risk ratio and avoids host privacy and compatibility work.

The first slice should contain only:

1. ADR and vocabulary.
2. `workflow-assessment.schema.json`.
3. Repository evidence inventory.
4. Ten to fifteen deterministic checks across the five dimensions.
5. `amber workflow assess --no-sessions --format json|markdown`.
6. Fixture-based scoring, coverage, privacy, and determinism tests.

Do not include session ingestion, HTML rendering, automatic plans, or longitudinal storage in the first slice.

Definition of done:

- Amber can remain 100/100 ready while the new report honestly shows effectiveness gaps or insufficient evidence;
- each finding is traceable to repository evidence;
- unsupported claims remain explicit;
- existing safety boundaries and command behavior are unchanged;
- `npm test`, `npm run manifests`, `npm run doctor`, and `npm run gen:agents:check` pass.

## Risks and controls

| Risk | Control |
| --- | --- |
| Scoring theater | Keep score nullable, publish confidence and coverage, calibrate with fixtures before an overall score |
| Duplicate product concepts | Preserve governance readiness semantics and name effectiveness separately |
| Privacy leakage | Workspace binding, default redaction, metadata-first collection, no raw transcript in report artifacts |
| Host coupling | Capability registry and provider-owned adapters |
| Scope creep into orchestration | Deterministic core, read-only default, action bridge only to dry-run Amber artifacts |
| Noisy recommendations | Stable finding IDs, consequence/cause/owner/verifier gates, capped prioritized output |
| False learning claims | Intervention ledger plus later outcome evidence |
| Report contract churn | Versioned schema and fixture compatibility tests |

## Priority summary

| Priority | Initiative | Why now |
| --- | --- | --- |
| P0 | Separate readiness from effectiveness | Prevents misleading interpretation of the existing 100/100 score |
| P0 | Versioned report and evidence contract | Makes every later adapter and renderer converge on one truth |
| P1 | Repository-only workflow assessment | High value, low privacy risk, works on every target repository |
| P1 | Provider capability registry | Prevents unsupported host claims before session integrations expand |
| P2 | Amber-native and Claude session evidence | Reuses evidence already present in the product |
| P2 | Web report and dry-run action bridge | Turns diagnosis into reviewable Amber work without auto-fixing |
| P3 | Structured learning interventions | Completes the loop from recurring friction to verified improvement |
| P3 | Longitudinal comparison | Shows whether interventions actually improve future work |

## Final recommendation

The highest-leverage lesson from Better Harness is not its plugin count or report UI. It is the separation of pre-work guidance, post-work evidence, provider coverage, and learning outcomes.

Amber already owns stronger governance, approval, ledger, handoff, and safe-execution primitives. The improvement is to make those primitives answer a second question: not only "is this repository governed?", but also "is this agent workflow effective, and is it getting better?"

Implement that as a separate read-only assessment layer, beginning with repository evidence and adding session evidence only through explicit provider contracts. This extends Amber's value without violating the boundaries that make Amber trustworthy.

## Confidence

**High** on the product gap and architectural direction because the conclusion is supported by Amber's current score semantics and Better Harness's source contracts.  
**Medium** on exact provider sequencing because host session APIs and local data formats can change.  
**Medium** on upstream implementation maturity because Better Harness was new and unreleased at the pinned baseline.
