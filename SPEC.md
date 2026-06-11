# Amber Protocol SPEC

Status: draft v1

This spec defines the first shippable shape of `amber-protocol`: a Codex + Claude Code Amber integration and verification toolkit.

It is based on:

- The current Harness Engineering operating manual (legacy name) in `docs/legacy/guide.md`
- OpenAI's repository-as-system-of-record pattern
- Anthropic's Dynamic Workflows direction
- Roundtable review using product-boundary grilling and technical review
- Matt Van Horn's agentic-engineering workflow notes, interpreted as workflow mechanisms rather than tool dependencies
- Loop-engineering and agent-observability notes, interpreted as declarative contracts, replay evidence, and regression proposals rather than live automation

## 1. Product Positioning

`amber-protocol` is a plugin-first toolkit for safely installing, auditing, validating, and maintaining an Agent-readable Amber setup inside real code repositories.

It is not a general Agent operating system.

It is not a dynamic multi-agent orchestration platform in V1.

It is not a project management SaaS, CI replacement, GitHub workflow manager, or generic app scaffold.

## 2. Target Users

Primary users:

- Individual developers using Codex or Claude Code on real repositories
- Small teams adopting AI-heavy coding workflows
- Engineering teams that need repeatable Agent onboarding, verification, and handoff

Primary project types:

- Existing or new code repositories
- JS/TS, Python, CLI, static site, app, and ordinary monorepo projects

V1 does not promise deep framework-specific understanding. Framework packs can be added later.

## 3. Core Product Boundary

V1 is:

> A pluginized Amber installer, auditor, Wiki scaffold, doctor, handoff validator, and static continuous-improvement state template.

V1 is not:

- A full dynamic workflow runner
- A real multi-agent dispatcher
- A model router
- A worktree orchestration engine
- A complete MCP server
- A GitHub/CI automation platform
- A tool that automatically rewrites old project documents

The first version should build trust by being safe, inspectable, idempotent, and verifiable.

V1.x may validate workflow-pack shape, standards references, profile metadata, and human approval gates. It must still stop before executing dynamic workflows, dispatching workers, or calling project-specific external systems on the user's behalf.

Article-inspired capabilities such as remote task ingress, always-on control, permission-bypass modes, account-bearing CLIs, or live multi-session dispatch are outside the core Amber Protocol. They may be represented later only as explicit integration contracts, dry-run checks, redacted evidence, and human approval gates.

Loop-inspired capabilities such as scheduled discovery, goal loops, connector-backed triage, trace diagnosis, auto-fix proposals, and regression-test generation are allowed only as declarative contracts and reviewable artifacts until an explicit future execution layer exists. The core Amber Protocol must not run cron jobs, open PRs, update external trackers, or apply trace-derived fixes.

Live loop scheduling is outside the current product boundary. The Amber setup may define readiness requirements for a future execution layer, but it must not imply support for always-on agents, daemonized work, hook-triggered mutation, autonomous notifications, or scheduled external-system updates until loop contracts, execution ledgers, replay evidence, approval policy, connector contracts, no-progress detection, isolated workspaces, budget ceilings, and human/reviewer gates are stable.

## 4. V1 Command Surface

V1 keeps the command surface narrow.

### `init`

Initialize a new or empty project with a minimal Amber setup.

Creates, when safe:

- `AGENTS.md`
- `CLAUDE.md`
- `feature_list.json`
- `PROGRESS.md`
- `session-handoff.md`
- `clean-state-checklist.md`
- `evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- `.workflow/continuous-improvement/packets/README.md`
- `docs/wiki/` skeleton

Rules:

- Do not overwrite existing files.
- Re-running `init` must be idempotent.
- Existing files trigger skipped-file records or patch suggestions.

### `audit`

Inspect an existing project without modifying it.

Outputs a migration report describing:

- Existing Agent instructions
- Existing docs and Wiki-like files
- Available install/start/test/build commands
- Missing Amber files
- Conflicts
- Suggested safe additions
- Suggested patches that require user approval
- Files that will not be touched

Rules:

- Default mode is read-only.
- No automatic merge of `AGENTS.md`, `CLAUDE.md`, or existing docs in V1.

### `wiki`

Create or validate a repository-local Wiki skeleton.

Default target:

```text
docs/wiki/
  index.md
  product/overview.md
  architecture/system-map.md
  architecture/module-boundaries.md
  engineering/runbook.md
  engineering/verification.md
  agent/amber.md
  agent/failure-patterns.md
  features/
  glossary.md
```

Rules:

- Generated pages must distinguish known facts from "needs confirmation".
- Do not invent architecture, business rules, or commands.
- Stable knowledge lives in Wiki.
- Current state lives in `feature_list.json`, `PROGRESS.md`, and handoff files.

### `doctor`

Validate whether the Amber setup is actually usable.

Checks:

- Required files exist
- `feature_list.json` schema is valid
- At most one feature is `in_progress`
- `passing` features have evidence
- Wiki links resolve
- `AGENTS.md` / `CLAUDE.md` route to the Wiki
- Verification commands are present
- Handoff/progress files contain next-action information
- The target is classified as an Amber setup product repo, an already-harnessed repo, or an unharnessed target repo
- Profile, standards, and workflow-pack references resolve when present
- Required local runtimes and environment variables are reported as available, missing, or not applicable
- Continuous-improvement state is valid when present

V1 doctor validates the Amber setup itself. It does not promise to run full CI or end-to-end tests for the target project.

### `handoff`

Generate or validate the session handoff.

Checks:

- Repo state is recorded
- Runtime/verification state is recorded
- Feature state is consistent
- Blockers are explicit
- Next actions are actionable

## 5. Deferred Command Surface

These names can be reserved in docs, but V1 must not claim full execution support.

### Deferred to V2

- `plan`
- `gate`

### Deferred to V2.5

- `review`
- `accept`
- `standards`

### Deferred to V3

- `pack`
- `profile`
- workflow-pack validation beyond local structural checks

### Deferred to V3+

- `work`
- dynamic workflow execution
- subagent dispatch
- worktree orchestration
- model/backend routing
- observability runtime integration

### Deferred to a future execution track

- `loop run`
- `loop record`
- `loop status`
- `loop inspect`
- live loop scheduling through cron, hooks, CI, or daemon processes
- connector-backed notifications or issue-tracker updates

Future loop commands must start as dry-run and record-only surfaces. They may resolve contracts, explain planned actions, write ledger previews, and inspect prior records before they are allowed to execute scheduled work.

If these appear in V1 docs, they must be described as future extension points or lightweight checklist workflows.

## 6. Architecture

The toolkit is split into platform adapters and shared core.

```text
amber-protocol/
  .codex-plugin/
    plugin.json
  .claude-plugin/
    plugin.json
    settings.json
    hooks.json
  skills/
    amber-init/
    amber-audit/
    amber-wiki/
    amber-doctor/
    amber-handoff/
  profiles/
    default/
      profile.json
      workflow.md
      standards.md
  standards/
    common/
      delivery.md
      testing.md
      security.md
  workflow-packs/
    workflow-pack.schema.json
    profile.schema.json
  templates/
    AGENTS.md
    CLAUDE.md
    feature_list.json
    PROGRESS.md
    session-handoff.md
    clean-state-checklist.md
    evaluator-rubric.md
    .workflow/continuous-improvement/state.json
    .workflow/continuous-improvement/packets/README.md
    docs/wiki/...
  scripts/
    scaffold-amber.js
    audit-project.js
    validate-feature-list.js
    validate-wiki.js
    doctor.js
  tests/
    fixtures/
    validate-feature-list.test.js
    validate-wiki.test.js
    scaffold-amber.test.js
  docs/legacy/guide.md
  SPEC.md
  ROADMAP.md
  README.md
```

Responsibilities:

- Plugin manifests expose the toolkit to Codex and Claude Code.
- Skills describe when and how Agents invoke workflows.
- Profiles describe project-specific workflow intent without hard-coding it into the core CLI.
- Standards/rule packs provide reusable review and delivery criteria selected by profile or file type.
- Workflow-pack schemas describe installable packs, their skills, standards, scripts, environment contracts, and approval gates.
- Loop contracts describe repeated agent workflows: trigger, cadence, goal, input sources, skills, connectors, state spine, triage outputs, hard stops, budget, and review gates.
- Loop ledgers record future or manual loop runs: trigger source, resolved profile, workflow-pack version, loop-contract version, input snapshot, action summary, produced artifacts, replay evidence, budget usage, stop reason, approval state, and reviewer outcome.
- Connector contracts describe external integrations as capabilities with side effects, credentials, redaction rules, rate limits, mutability class, and approval requirements. A connector declaration is not permission to call the connector.
- Templates are files copied or suggested into target repositories.
- Scripts perform deterministic scaffold, audit, validate, and doctor operations.
- Tests protect idempotency, schema rules, and migration safety.

Keep plugins thin. Put repeatable behavior in scripts and templates.
Keep workflow packs declarative until V3+. A pack can describe steps, inputs, outputs, gates, scripts, and standards; V1/V2 tooling can validate and preview those declarations, but not run them as autonomous work.

Agentic-engineering lessons are adopted as product mechanisms, not as required third-party tools:

- Planning artifacts are durable Agent checkpoints that survive chat/session loss.
- Plan inputs are captured as source bundles with provenance, freshness, confidence, and inspection status.
- Human judgment is part of the evidence trail: direction changes, accepted risks, and review decisions should be recorded.
- Repeated work can be promoted into Wiki updates, standards/rule-pack changes, or workflow-pack candidates through reviewable diffs.
- Loops are adopted as declarative contracts: they can describe discovery, triage, verification, and continuation rules, but they do not schedule or execute themselves.
- Trace and failure records can be promoted into regression-test proposals with exact replay inputs and plain-English assertions.

Live-loop readiness is modeled as a separate future execution track:

- A loop contract is required before any loop can be dry-run, recorded, or scheduled.
- A loop must have an owner, goal, cadence, input sources, state spine, triage output, mutability class, hard stops, budget ceiling, approval gates, and failure escalation.
- Every loop run must create an execution-ledger entry that can be inspected without chat history.
- Every change proposal must link to replay evidence; unsupported evidence means report-only status.
- No-progress detection must stop repeated identical observations, unchanged findings, repeated failed commands, repeated tool calls, empty evidence deltas, and budget exhaustion.
- Scheduling remains disabled until dry-run, record-only, status, and inspect flows are stable.

## 7. Safety Rules

Safety is a core product feature.

Default behavior:

- Never overwrite existing `AGENTS.md`, `CLAUDE.md`, `docs/`, `feature_list.json`, or progress files.
- For old projects, generate migration reports before edits.
- Every proposed modification must be visible as a file list or patch preview.
- Unknown project facts must be marked as unknown.
- Do not fabricate commands.
- Prefer reversible additions over destructive changes.
- Do not turn remote-control, email-ingress, or permission-bypass patterns into default product behavior.
- Do not call external services from plan, review, or pack validation unless an explicit integration contract and approval gate require it.
- Do not validate loop contracts by running scheduled jobs, dispatching live agents, opening PRs, or mutating external systems.
- Every loop contract must declare hard stops: maximum iterations, timeout or no-progress detection, budget ceiling, and human/reviewer approval gates.
- Do not treat connector configuration as approval. External connectors require explicit contracts that describe side effects, credentials, redaction, rate limits, and approval gates.
- Do not let loop output approve itself. Worker output, reviewer evidence, approval state, and acceptance decision must be separate records.
- Do not run mutating loop work in the user's main checkout. Any future mutating loop must use an isolated worktree or task workspace.
- Stop any future loop run when budget, hard-stop, no-progress, missing replay evidence, missing reviewer gate, or unresolved connector credentials are detected.

Required old-project output:

- Will add
- Suggest modifying
- Will not touch
- Conflicts
- Unknowns
- Next safe command

## 8. Feature State Model

V1 uses a Git-friendly state model:

- `feature_list.json` for machine-readable feature status
- `PROGRESS.md` for current progress and next actions
- `session-handoff.md` for session transition
- Wiki feature pages for richer stable feature context

`feature_list.json` rules:

- Status values: `not_started`, `in_progress`, `blocked`, `passing`
- At most one feature can be `in_progress`
- `passing` requires non-empty evidence
- Verification steps must be explicit enough for an Agent to run or inspect

Complex task planning is deferred to V2 through durable plan artifacts. A plan should be sufficient for a fresh Agent session to recover the feature tie-back, source bundle, current reasoning, next action, verification, and approval state without relying on chat history.

## 9. V1 Acceptance Criteria

V1 is acceptable when:

- Running `init` in an empty repository creates the minimal Amber file set.
- Running `audit` in an existing repository does not modify files by default.
- Re-running `init` does not duplicate content or overwrite user files.
- `doctor` detects missing files, schema failures, multiple `in_progress` features, empty evidence on `passing`, Wiki broken links, and missing verification commands.
- The generated Wiki skeleton can be used by a fresh Agent to find product, architecture, engineering, verification, and Amber guidance.
- Plugin manifests pass local structural validation.
- Scripts work on Windows and do not assume bash-only execution.
- README explains new-project setup, old-project audit, validation, rollback/uninstall boundaries, and V1 non-goals.
- V1 documentation does not claim Dynamic Workflow execution support.

## 10. Open Assumptions To Verify

- Exact Codex plugin manifest schema and install behavior.
- Exact Claude Code plugin manifest, skills, commands, and hooks boundaries.
- Whether shared skills need platform-specific wrappers.
- Whether slash commands are plugin commands, markdown command files, or skill triggers on each platform.
- The safest cross-platform script runtime. Node.js is the current default candidate.
- License boundaries for reference implementations. Ideas can be referenced; code reuse requires license review.
- Workflow-pack manifest shape, including skills, standards, profile metadata, scripts, required environment variables, and install/upgrade behavior.
- How to separate an Amber setup product repository from a target repository during `doctor`.
- How to model external-system integrations safely: environment contract, dry-run checks, redacted logs, and no implicit network calls.
- How to model plan source bundles for issues, screenshots, terminal errors, meeting transcripts, prior plans, recent research summaries, and codebase findings.
- How much human feedback evidence is required before a redirected or accepted task can be considered reviewable.
- Whether standards/rule packs should be copied into target repos, referenced from installed plugins, or both.

## 11. Revised Roadmap

### V1: Safe Amber Bootstrap

Goal: Safely install and validate a minimal repository-local Amber setup.

Scope:

- `init`
- `audit`
- `wiki`
- `doctor`
- `handoff`
- Minimal Codex and Claude Code manifests
- Basic validators
- No-overwrite default
- Static continuous-improvement state and packet templates

Gate:

- V1 must pass empty-repo init, old-repo audit, idempotency, and doctor checks.
- Scaffolded continuous-improvement state validates without enabling autonomous execution.

### V1.5: Compatibility Hardening

Goal: Make the dual-plugin shape reliable across supported platforms and make the Amber setup self-aware enough to distinguish the toolkit repo from target repos.

Scope:

- Codex adapter hardening
- Claude Code adapter hardening
- Windows/macOS/Linux test matrix
- Migration diff preview
- Re-run safety
- Manifest validation
- Target classification in `doctor`
- Runtime and shell capability detection
- Pack-shape smoke validation for manifests, skills, standards, scripts, and environment contracts

Gate:

- Both platform adapters can be locally validated.
- Shared core works without duplicating logic.
- Running `doctor --target .` in this repository reports product-repo status instead of treating the toolkit as a broken target Amber setup.
- A sample workflow pack can be structurally inspected without executing its workflow.

### V2: Planning Layer

Goal: Add structured planning and explicit human gates without automatic execution.

Scope:

- `Plans.md` or `spec.md`
- Plan schema
- Plan source bundle schema
- Feature-to-plan linking
- Acceptance criteria schema
- Evidence schema
- Approval gate schema
- Plan storage convention such as `docs/plans/YYYY-MM-DD-<feature>.md`
- Design-artifact templates for HLD-like context, impact analysis, and implementation plans
- Durable resume/checkpoint fields for next action, blockers, source provenance, and recovery instructions
- Human-readable summary for reviewers who do not live in the terminal

Gate:

- Plans can be generated, validated, and tied back to feature state.
- A plan can require user confirmation before implementation and `doctor` can detect missing gate evidence.
- A plan can show the inspected source bundle, unresolved unknowns, current blockers, and exact resume point for a fresh session.

### V2.5: Review And Acceptance Gate

Goal: Prevent false completion and scope drift.

Scope:

- `review`
- `accept`
- Ship/wait/reject report
- Missing-evidence detection
- Scope-creep detection
- Human feedback and redirect log
- Reviewer output schema
- Standards/rule-pack selection by profile and changed file type
- Static pre-delivery checklist output
- Amber evolution log for lessons that should update project rules or Wiki

Gate:

- Review can block empty evidence, false `passing`, and unresolved blockers.
- Review can report which standards were loaded, which checks passed, which checks were not applicable, and which findings require user action.
- Review can preserve the human signal behind a decision: why work was accepted, redirected, narrowed, or rejected.
- A completed task can append a concise Amber evolution record without inventing future-facing rules.

### V3: Workflow Pack Design Kit

Goal: Design installable workflow packs without executing subagents.

Scope:

- Workflow-pack manifest schema
- Project profile schema
- Workflow spec schema
- Loop contract schema
- Task graph
- Role separation
- Budget limits
- Stop conditions
- Trigger, cadence, triage output, state-spine, and no-progress detection declarations
- Trace-to-regression proposal shape with exact replay inputs and plain-English assertions
- Dry-run validation
- Environment variable contract
- External API adapter contract
- Human approval gates
- Workflow-pack candidate promotion from repeated plan/review patterns
- Pack inspect/validate commands

Gate:

- Dry-run can explain planned steps, workers, reviewers, inputs, outputs, standards, environment requirements, risks, approval gates, and stop conditions.
- Pack validation catches missing skills, broken standards references, unsafe scripts, and undeclared external integrations.
- Pack validation distinguishes declarative integration contracts from live service calls or live agent dispatch.
- Loop validation can explain trigger/cadence, state spine, triage outputs, hard stops, budget, connector declarations, and review gates without scheduling or executing the loop.

### V4: Isolated Execution Foundation

Goal: Make execution results isolatable and replayable.

Scope:

- Worktree per task
- Execution ledger
- Evidence pack
- Replayable task result
- Failure attribution
- Original failing input and configuration snapshot when a task comes from a trace or production failure
- Reviewable regression-test proposal linked to the replay evidence

Gate:

- A task result can be inspected and replayed without relying on chat history.
- Trace-derived task results preserve the exact replay input and proposed regression assertion before acceptance.

### V4.5: Agent Orchestration

Goal: Add controlled multi-agent orchestration records only after replayable evidence exists.

Scope:

- Subagent dispatch records
- Worker/reviewer separation
- Backend/model routing metadata
- Concurrency limits
- Stop/resume controls
- Review bandwidth limits for loops that would otherwise overproduce candidate work
- Loop orchestration records that point to declarative loop contracts and replayable evidence

Gate:

- Workers cannot self-approve.
- Reviewer evidence is separate from worker output.
- Loop orchestration records cannot mark work complete unless reviewer evidence and hard-stop status are recorded.

### V5: Team Distribution

Goal: Make the toolkit usable as a team standard.

Scope:

- Marketplace packaging
- Team presets
- Rule packs
- Project profiles
- Versioned upgrades
- Pack registry metadata
- Install, pin, update, rollback, and inspect flows
- Compatibility matrix across Codex, Claude Code, OS, runtime, and profile version

Gate:

- Teams can install, pin, update, and roll back versions.
- Teams can preview pack changes before upgrade and keep target-repo customizations intact.

### V5.5: Continuous Amber Maintenance

Goal: Keep the Amber setup and Wiki from becoming stale.

Scope:

- Doc-gardening workflows
- Wiki lint in CI
- Stale-doc detection
- Migration assistant
- Upgrade assistant
- Amber evolution rollups
- Rule-pack drift detection
- Workflow-pack candidate proposals from repeated work
- Failure-to-regression proposals from trace or execution evidence
- Plain-English assertion candidates derived from real failures

Gate:

- Stale knowledge can be detected and proposed for repair.
- Repeated delivery findings can be promoted into standards, Wiki updates, or workflow-pack candidates with reviewable diffs.
- Real failures can be promoted into regression-test proposals without automatically modifying test suites.

### Future Track: Live Loop Scheduling Readiness

Goal: Prepare, but not yet enable, scheduled or hook-triggered agent loops.

Scope:

- Loop contract readiness checks
- Loop execution-ledger schema
- Replay-evidence requirements for loop-produced proposals
- Approval policy for read-only inspection, report generation, file mutation, command execution, external notification, issue creation, branch/commit/PR creation, and destructive actions
- Connector contract schema for GitHub, CI, issue trackers, chat, email, local files, and account-bearing CLIs
- Worktree/task-workspace isolation requirement
- No-progress detection
- Budget and quota ceilings
- Reviewer-gate and notification-routing rules
- Dry-run, record-only, status, and inspect command candidates

Gate:

- A loop can be dry-run, recorded, inspected, and replayed without relying on chat history.
- Loop records show trigger source, resolved profile, workflow pack, loop contract version, input snapshot, tool/action summary, produced artifacts, budget usage, stop reason, approval state, and reviewer outcome.
- Scheduled execution remains disabled until the dry-run and record-only surfaces have stable fixtures, schema validation, reviewable examples, and explicit user approval.
- The first eligible loop class is read-only maintenance proposal generation: stale-doc detection, rule-pack drift, workflow-pack candidate proposals, and failure-to-regression proposals.

## 12. Phase Dependency Gates

- V2 cannot start until V1 `doctor` is stable.
- V2.5 cannot start until evidence schema is stable.
- V3 cannot start until plan/review data structures are stable.
- V4 cannot start until workflow dry-run can expose risks.
- V4.5 cannot start until isolated execution evidence is replayable.
- V5 cannot start until single-project install, upgrade, and rollback are stable.
- Workflow-pack execution cannot start until pack validation, profile resolution, environment contracts, and approval gates are stable.
- Live loop scheduling cannot start until the future-track readiness gate is satisfied: loop contracts, execution ledgers, replay evidence, approval policy, connector contracts, budget ceilings, no-progress detection, isolated workspaces, and human/reviewer gates must all be stable. Live scheduling remains outside the current roadmap.

## 13. First Implementation Cut

The first implementation cut should create:

- Minimal plugin manifests
- Amber templates
- `scaffold-amber.js`
- `audit-project.js`
- `validate-feature-list.js`
- `validate-wiki.js`
- `doctor.js`
- target classification in `doctor`
- minimal workflow-pack/profile schema validation
- continuous-improvement state template and validator
- Fixture tests for empty repo, old repo, and broken Amber setup

The first cut should not implement dynamic workflows.
