# Roadmap

Implementation status: V1 through V5.5 are implemented in this repository as local, auditable flows. V4.5 is an orchestration-record control surface rather than a live subagent runner. V5 uses a local registry rather than external marketplace publishing. V5.5 writes reviewable maintenance proposals rather than applying doc or standards rewrites automatically.

Live loop scheduling is a future execution track, not an implied part of V5.5 maintenance. The current product may describe, validate, dry-run, and record loops, but it must not run always-on scheduled agents until the isolation, evidence, approval, connector, and no-progress controls below are stable.

**V1.1/GLX (2026-06-30):** Governed one-shot loop and route command-stage execution is now available ([ADR-0003](docs/adr/0003-governance-gated-execution.md)). `amber loop run --execute` and `amber route test --execute --stage` run a declared command behind four governance gates (declarative policy, human approval, git worktree isolation, tamper-evident hash-chain ledger). Default `loop run` is still dry-run; execution requires `--execute` + an `amber loop approve`. Per-context rules, honest OWASP-ASI coverage reporting, and session tamper-evidence are also included. This is human-triggered gated execution — NOT scheduling, NOT autonomous loops.

## V1: Safe Amber Bootstrap

Goal: safely install and validate a minimal repository-local Amber setup.

Scope:

- `init`
- `audit`
- `wiki`
- `doctor`
- `handoff`
- Minimal Codex and Claude Code manifests
- Basic validators
- No-overwrite default
- Static continuous-improvement state
- Workflow packet templates

Gate:

- Empty-repo init succeeds
- Old-repo audit is read-only
- Re-running init is idempotent
- Doctor detects missing files, invalid feature state, broken wiki links, and missing handoff information
- Scaffolded continuous-improvement state validates without enabling autonomous execution

## V1.5: Compatibility And Doctor Hardening

Goal: make the dual-plugin shape reliable and make `doctor` understand what kind of repository it is inspecting.

Scope:

- Codex adapter hardening
- Claude Code adapter hardening
- Windows, macOS, and Linux test matrix
- Migration diff preview
- Manifest validation
- Target classification: product repo, harnessed target repo, unharnessed target repo
- Runtime and shell capability detection
- Minimal workflow-pack/profile smoke validation

Gate:

- Both plugin manifests can be locally validated
- `doctor --target .` reports product-repo status for this repository
- A sample pack can be inspected without executing scripts or workflows

## V2: Planning Layer And Human Gates

Goal: add structured planning with explicit approval gates, still without automatic execution.

Scope:

- `plan`
- `gate`
- `Plans.md` or `docs/plans/YYYY-MM-DD-<feature>.md`
- Plan source bundle with provenance, freshness, confidence, and inspection status
- Durable plan checkpoint fields for resume, blockers, next action, and recovery instructions
- Small vertical-slice task breakdown
- Explicit verification per task
- Acceptance criteria and evidence schema
- HLD-like design artifact template
- Human-readable reviewer summary
- User-confirmation gate before implementation

Gate:

- Plans can be generated, validated, and tied back to feature state
- Plans expose inspected sources, unresolved unknowns, and the exact resume point for a fresh agent session
- Missing user-confirmation evidence blocks implementation-ready status

## V2.5: Standards, Review, And Acceptance Gate

Goal: prevent false completion, scope drift, and rule drift.

Scope:

- `review`
- `accept`
- Standards/rule-pack discovery
- Standards selection by profile and changed file type
- Static pre-delivery checklist
- Evidence completeness checks
- Human feedback and redirect log
- Release readiness summary
- Amber evolution log

Gate:

- Review reports loaded standards, applicable checks, non-applicable checks, findings, and required user action
- Review preserves why work was accepted, redirected, narrowed, or rejected
- Completed tasks can append a concise Amber evolution record with reviewable diffs

## V3: Workflow Pack Design Kit

Goal: design installable workflow packs without executing subagents.

Scope:

- `pack inspect`
- `pack validate`
- `profile inspect`
- Workflow-pack manifest schema
- Project profile schema
- Workflow step schema
- Loop contract schema
- Environment variable contract
- External API adapter contract
- Human approval gate schema
- Workflow-pack candidate promotion path for repeated plan/review patterns
- Trigger, cadence, state-spine, triage output, hard-stop, no-progress, and budget declarations
- Trace-to-regression proposal shape with exact replay inputs and plain-English assertions
- Dry-run explanation of steps, risks, standards, inputs, outputs, and stop conditions

Gate:

- Pack validation catches missing skills, broken standards references, unsafe scripts, and undeclared external integrations
- Dry-run explains the workflow without dispatching workers or calling external systems
- Pack validation distinguishes declarative integration contracts from live service calls, account-bearing CLIs, and live agent dispatch
- Loop contract validation explains how work would be discovered, triaged, capped, reviewed, and resumed without scheduling or executing the loop

## V4: Isolated Execution Foundation

Goal: make execution results isolatable and replayable before multi-agent orchestration.

Scope:

- Worktree per task
- Execution ledger
- Evidence pack
- Replayable task result
- Failure attribution
- Original failing input and configuration snapshot for trace-derived work
- Regression-test proposal linked to replay evidence

Gate:

- A task result can be inspected and replayed without relying on chat history
- Trace-derived task results preserve exact replay input and proposed regression assertion before acceptance

## V4.5: Agent Orchestration

Goal: add controlled multi-agent orchestration records only after replayable evidence exists.

Scope:

- Subagent dispatch records
- Worker/reviewer separation
- Backend/model routing metadata
- Concurrency limits
- Stop/resume controls
- Loop orchestration records that reference declarative loop contracts
- Review bandwidth limits for candidate work

Gate:

- Workers cannot self-approve
- Reviewer evidence is separate from worker output
- Loop records include hard-stop status, budget status, and reviewer gate status before any work is considered complete

## V5: Team Distribution

Goal: make the toolkit usable as a team standard.

Scope:

- Local marketplace-style packaging
- Team presets
- Rule packs
- Project profiles
- Pack registry metadata
- Versioned upgrades
- Install, pin, update, rollback, and inspect flows
- Compatibility matrix across Codex, Claude Code, OS, runtime, and profile version

Gate:

- Teams can install, pin, update, and roll back versions
- Teams can preview pack changes before upgrade and keep target-repo customizations intact

## V5.5: Continuous Amber Maintenance

Goal: keep the Amber setup, Wiki, standards, and profiles from becoming stale.

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
- Plain-English assertion candidates from real failures

Gate:

- Stale knowledge can be detected and proposed for repair
- Repeated delivery findings can be proposed for standards, Wiki updates, or workflow-pack candidates with reviewable diffs
- Real failures can be proposed as regression tests without automatically modifying test suites

## Future Track: Live Loop Scheduling Readiness

Goal: make a scheduled or hook-triggered loop safe enough to consider as an explicit future execution layer.

This track is intentionally separate from the implemented roadmap. It turns loop-engineering ideas into prerequisites and readiness checks before any daemon, cron job, CI workflow, hook, or external connector is allowed to run agent work.

Required capabilities:

- Loop contracts with goal, owner, trigger, cadence, input sources, state spine, triage output, mutability class, stop conditions, budget ceiling, reviewer gate, and failure escalation.
- Execution ledger entries for every loop run, including trigger source, resolved profile, workflow pack, loop contract version, input snapshot, tool/action summary, produced artifacts, budget usage, stop reason, approval state, and reviewer outcome.
- Replay evidence for any proposed code, doc, standards, issue-tracker, or regression-test change.
- Approval policy that classifies read-only inspection, report generation, file mutation, command execution, external notification, issue creation, branch/commit/PR creation, and destructive actions separately.
- Worktree or task-workspace isolation for any loop that can run commands, inspect generated diffs, or propose file changes.
- No-progress detection for repeated identical observations, unchanged findings, repeated failed commands, repeated tool calls, empty evidence deltas, and budget exhaustion.
- Connector contracts for GitHub, CI, issue trackers, chat, email, local files, and any account-bearing CLI, including side effects, required credentials, redaction rules, rate limits, and approval gates.
- Notification routing that sends findings to the right owner without treating notification as acceptance.

MVP candidate:

- `loop run --dry-run --contract <file>` resolves the loop contract, explains the planned trigger, inputs, actions, risks, approval gates, budgets, and expected artifacts, and writes a ledger preview without executing scheduled work.
- `loop record --contract <file>` records the result of a manually run or CI-triggered loop using replay evidence supplied by the caller.
- `loop status` and `loop inspect` show recent run records, blockers, stop reasons, no-progress findings, and pending reviewer gates.
- First supported loop class is read-only maintenance proposal generation: stale-doc detection, rule-pack drift, workflow-pack candidate proposals, and failure-to-regression proposals.

Gate:

- A loop can be dry-run, reviewed, recorded, and replayed without relying on chat history.
- A loop cannot self-approve, bypass approval policy, mutate files outside an isolated workspace, or notify external systems without a connector contract.
- A loop stops on budget exhaustion, hard-stop limits, no-progress detection, missing reviewer gates, missing replay evidence, or unresolved connector credentials.
- Scheduled execution remains disabled until the MVP commands above have stable fixtures, schema validation, and reviewable example artifacts.

## Dependency Gates

- V2 cannot start until V1 `doctor` is stable
- V2.5 cannot start until evidence and gate schemas are stable
- V3 cannot start until plan/review data structures are stable
- Workflow-pack execution cannot start until pack validation, profile resolution, environment contracts, and approval gates are stable
- V4 cannot start until workflow dry-run can expose risks
- V4.5 cannot start until isolated execution evidence is replayable
- V5 cannot start until single-project install, upgrade, and rollback are stable
- Live loop scheduling cannot start until the future-track readiness gate is satisfied: loop contracts, execution ledgers, replay evidence, approval policy, connector contracts, budget ceilings, no-progress detection, isolated workspaces, and human/reviewer gates must all be stable
