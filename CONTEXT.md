# Amber Protocol

A repository-local governance protocol. Its Governance Console is the CLI and artifact surface that constrains, verifies, audits, and hands off AI-assisted engineering work inside a git repository.

## Language

**Amber Protocol**:
The product: a repository-local governance layer for AI-assisted engineering that installs, audits, validates, and maintains agent-facing project state.
_Avoid_: Coding Harness, framework, platform

**Governance Console**:
Amber's operable surface in a target repository: CLI commands and artifact output. Not a hosted service or live agent runtime.
_Avoid_: hosted platform, live agent runtime, dashboard

**Wiki**:
Stable project knowledge under `docs/wiki/` in a target repository: architecture, runbooks, verification, and agent rules. Agents consult it rather than inventing facts.
_Avoid_: docs, knowledge base, README

**Agent Entrypoint**:
A file in a target repository that tells an agent where project context, working rules, and verification live (e.g. `AGENTS.md`, `CLAUDE.md`). Read at agent startup.
_Avoid_: prompt file, instruction blob, system prompt

**Target Repository**:
A git repository that has an Amber scaffold and `.amber/` state and is subject to Amber governance. The CLI addresses it via `--target`.
_Avoid_: target project, project, codebase

**Amber Setup**:
The complete installed Amber footprint in a target repository: root-level starter files plus the `.amber/` state directory. Validated by `doctor`.
_Avoid_: Harness, installation, bootstrap

**Scaffold**:
The starter files that `init` creates from `templates/` at the root of a target repository. A subset of an Amber Setup, not the whole thing.
_Avoid_: setup, bootstrap files, harness files

**Session**:
A repository-local continuity record for one unit of governed work: goal, selected route, stage progress, timeline events, and checkpoints, stored under `.amber/sessions/`. Evidence for handoff and complete-check, not a live agent runtime or chat session.
_Avoid_: chat session, agent session, execution session

**Session transition (edge graph)**:
Canonical states and edges live in `scripts/lib/session-state-machine.js` (`STATES`, `TRANSITIONS`, `isLegalTransition` / `legalTargets` / `isFinal`). CLI is authoritative: `created → executing` is illegal (must go `created → routed → executing`). The web console must not keep a second allow-table; it may hold only a local action→target map and pre-normalize legacy `idle`/`running` before calling the SSOT. Action semantics still matter on the web: `resume` is pause-only (`paused → executing`); `routed → executing` is `start`, not `resume`, even though that edge is legal in the graph.
_Avoid_: ALLOWED_TRANSITIONS (web-local copy), dual state machines, resume-from-routed

**Route**:
A declarative delivery template that defines the stages and approval gates for a class of work goals. Selected when a session starts; describes structure, does not execute stage content.
_Avoid_: workflow, pipeline, playbook, path

**Journey affinity**:
An optional preference or constraint connecting a Route to a Journey. When absent, the Route does not constrain Journey selection.
_Avoid_: route family, route category

**Route/Journey Decision**:
A deterministic selection record that explains the Route and Journey chosen for an objective, including explicit overrides, defaults, mismatches, and tie-breaking.
_Avoid_: routing result, matcher output

**Decision Evidence**:
The compact facts supporting a Route/Journey Decision, such as matched terms, scores, tie-breaking, fallback reason, or explicit-route mismatch. It explains a deterministic decision without becoming a separate artifact by default.
_Avoid_: scoring details, diagnostic dump

**Stage Reference**:
The identifier naming which skill, pack, or command a route stage invokes.
_Avoid_: stage target, step target

**Plan**:
A durable governance artifact linking one feature to goal, vertical slices, verification steps, evidence schema, and approval state. Survives chat loss; advanced through Plan Gate, Review, and Accept.
_Avoid_: prompt, spec, ticket, design doc

**Source Bundle**:
The structured set of inputs that informed a plan, each with provenance, freshness, confidence, and inspection status.
_Avoid_: context pile, attachments, references

**Context Page**:
A persisted unit of distilled project knowledge under `.amber/context/pages/`, stored as block-structured JSON where every block cites the sources it rests on. Produced by an agent under a Distillation Contract and admitted only by `amber context ingest`.
_Avoid_: memory, note, doc, wiki page, article

**Distillation Contract**:
The request artifact Amber emits at `.amber/context/requests/<id>.json`: hash-bearing source references, the target schema, the instructions, the hard constraints, and the acceptance error codes. Amber writes it and judges the result; a host agent executes it. Amber never calls a model.
_Avoid_: prompt, job, task, request payload

**Mutable Source** / **Immutable Source**:
The two source classes a Context Page may cite. Mutable sources (code, live documents) carry a `rawHash` and a `normHash` and are staleness-checked; only a `normHash` change raises a refresh. Immutable sources (append-only ledger ranges, archived sessions, accepted ADRs) are hashed for tamper detection only.
_Avoid_: static/dynamic source, fixed reference

**Loadout**:
The task-scoped context artifact Amber assembles at `.amber/context/loadouts/<route>[-<feature>].json`: a deterministic, budgeted set of Required Artifacts plus pinned and fresh Context Pages, with separate accounting and hashes for load-time verification. Amber governs the agent's context window without retrieving semantically — the host agent loads the contract. (ADR-0010, ADR-0015)
_Avoid_: prompt bundle, context pack, RAG result

**Required Artifact**:
A target-local governance artifact that every Loadout must include and verify: the Operating Manual, the selected Route manifest, and the Loadout Definition. Required Artifacts are not Context Pages and fail closed when missing, changed, or outside the target repository. (ADR-0015)
_Avoid_: pinned page, required reference, built-in context

**Context Budget**:
The word-count cap (default ≈ 4000, `--budget`) that bounds a Loadout. Pages fill tiers in stable order — required → priority → recency → pageId — and out-of-budget exclusions are recorded with reasons; a required-tier overflow fails fast. (ADR-0010)
_Avoid_: token limit, truncation window

**Scope Tag**:
Optional per-page `scope` metadata (route or feature ids) stamped by `amber context ingest`, used by `amber context load` to select pages mechanically. Single source of truth lives in the page, not a sidecar. (ADR-0010)
_Avoid_: category, label, tag cloud

**Feature**:
A tracked unit of user-visible work in `feature_list.json`, with status, verification steps, and evidence records.
_Avoid_: task, story, ticket, work item

**Feature Slice**:
The smallest safe increment of work within a feature, listed in a plan's Vertical Slices section. A planning unit, not a separate `feature_list.json` entry.
_Avoid_: vertical slice, sub-task, step

**Feature State**:
The machine-readable record of all features in `feature_list.json`.
_Avoid_: task list, project status, backlog

## Governance

**Gate**:
A governed checkpoint that must be satisfied—by human approval or evidence—before work proceeds. Qualified by kind: Route Gate, Plan Gate, Adoption Gate.
_Avoid_: checkpoint, barrier, approval step

**Route Gate**:
An approval point between route stages, defined in a route template (e.g. user-approval).
_Avoid_: stage gate, middleware

**Plan Gate**:
Validation of a plan artifact before implementation proceeds.
_Avoid_: review, pre-flight

**Adoption Gate**:
A readiness assessment of whether a target repository is safe to modify with Amber. Produced by `adoption gate`; does not write to the target.
_Avoid_: onboarding gate, init check

**Completion Check**:
A report-only assessment of whether a session has sufficient goal, timeline, verification, approval, and handoff evidence. Not a gate.
_Avoid_: completion gate, done gate

**Adoption**:
A read-only readiness review of an existing target repository before Amber writes to it. Produces evidence artifacts without installing a scaffold or running target-repository commands.
_Avoid_: onboarding, migration, installation

**Adoption Report**:
A read-only artifact summarizing audit, dry-run, and readiness findings for a target repository. Output of `adoption report`; input to Adoption Gate.
_Avoid_: migration report, onboarding report, audit report

**Review**:
A static assessment of a plan against standards and required user action. Produced by the `review` command; does not modify the plan.
_Avoid_: QA, audit, code review

**Accept**:
The operation that records a reviewed plan as accepted and appends an Amber evolution entry. Succeeds only when review passes.
_Avoid_: merge, approve, ship

**Standard**:
A reusable set of review checks that plans and reviews are assessed against. Selected by profile.
_Avoid_: rule, checklist, lint rule

**Rule Pack**:
An installable bundle of standards and team policy rules distributed via team presets.
_Avoid_: ruleset, lint pack, policy file

**Amber Evolution**:
A record of accepted lessons from work that passed Accept. May later inform Wiki, standards, or workflow pack updates, but does not modify them automatically.
_Avoid_: changelog, retrospective, lesson learned

**Artifact**:
An inspectable, version-controlled governance record in a repository (plan, report, timeline, approval record). Amber's primary output, not a live-execution side effect.
_Avoid_: output, file, document

**Evidence**:
Concrete proof that a claim was verified: command, result, date, and notes. A kind of artifact recorded in features and plans.
_Avoid_: proof, output, log

**Verification**:
Explicit steps an agent or human can run or inspect to validate that behavior meets expectations. Describes what to check, not the check results.
_Avoid_: testing, validation, QA

## Continuity

**Handoff**:
A human-readable snapshot that lets a person or agent resume governed work without chat history. The canonical handoff artifact is `session-handoff.md`, validated by the `handoff` command.
_Avoid_: transfer, delegation, swap

**Continuity Surface**:
A durable file in a target repository that preserves context across agent sessions (e.g. `session-handoff.md`, `PROGRESS.md`, `feature_list.json`).
_Avoid_: context file, memory file, state file

## Observability

**Live Activity Feed**:
The Governance Console's near-real-time rendered view of a Session's timeline events: the web console polls `timeline.jsonl` as the single source of truth while a session is active and uses SSE only as an invalidation signal. It presents recorded evidence; it is not a runtime interception of the agent.
_Avoid_: live log, console stream, runtime trace

## Agent Integration

**Skill**:
An instruction document that tells an AI agent how to perform a specific Amber task. Loaded by agent platforms, not executed by the Amber CLI.
_Avoid_: command, plugin, tool

**Workflow Pack**:
A declarative bundle describing skills, standards, scripts, and approval gates for a repeatable workflow. Amber validates and inspects packs; does not execute them autonomously.
_Avoid_: workflow, plugin pack, automation

**Profile**:
A declarative configuration expressing a target repository's workflow intent: which workflow packs, standards, and environment constraints apply. Validated by `profile inspect`, not executed.
_Avoid_: config, preset, settings

**Loop Contract**:
A declarative description of a repeated agent workflow: trigger, cadence, state spine, hard stops, and review gates. Embedded in workflow packs; dry-run and record-only in V1; live scheduling is outside the product boundary.
_Avoid_: loop, scheduler, cron job

**Integration Contract**:
A declarative description of an external connector's permissions, side effects, redaction requirements, and approval gates. Embedded in workflow packs; validated in V1, not invoked.
_Avoid_: connector, MCP tool, API call

## Loop Design

**State Spine**:
A durable artifact recording loop progress and resume point: what was tried, what passed, what remains.
_Avoid_: memory, state file, checkpoint

**Hard Stop**:
A declared loop termination condition: maximum iterations, timeout, no-progress detection, or budget ceiling.
_Avoid_: guardrail, limit, ceiling

**Triage Output**:
A classification produced by discovery work (e.g. archive, candidate-task, needs-human, blocked, regression-proposal).
_Avoid_: finding, queue item, ticket

## Execution Artifacts

**Task Preparation**:
The creation of replayable task artifacts—a worktree path, execution ledger, task evidence, and replay file—without executing commands.
_Avoid_: task run, execution, dispatch

**Execution Ledger**:
The durable record of a prepared task: linked plan, worktree path, command list, and failure attribution.
_Avoid_: log, trace, run record

**Task Evidence**:
The replayable evidence bundle and replay requirements for a prepared task. Paired with the execution ledger.
_Avoid_: evidence pack, results folder, proof bundle

**Replay**:
An artifact that lets a person or agent re-inspect a task result without chat history. Carried by `replay.md`; depends on the execution ledger and task evidence.
_Avoid_: rerun, reproduction, retry

**Orchestration Record**:
An artifact-only record of worker assignment, reviewer assignment, dispatch status, and reviewer evidence for a prepared task. Created by `agent dispatch`; does not invoke live agents. Workers cannot self-approve.
_Avoid_: dispatch, agent run, subagent execution

**Review Bandwidth**:
The practical limit on how much candidate work can proceed because a human or reviewer must evaluate it. A signal on orchestration records, not a concurrency setting.
_Avoid_: concurrency, capacity, throughput

**Worker**:
The agent role assigned in an orchestration record to produce or draft work.
_Avoid_: implementer, subagent, executor

**Reviewer**:
The separate role assigned in an orchestration record to evaluate worker output and record evidence. Must differ from the worker.
_Avoid_: checker, verifier, approver

**Maintenance Proposal**:
A reviewable artifact suggesting updates for stale knowledge, upgrade guidance, drift, repeated findings, or regression candidates. Produced by `maintenance propose`; does not automatically modify wiki, standards, or tests.
_Avoid_: auto-fix, cleanup task, maintenance run

**Regression Proposal**:
A reviewable suggestion to turn a real failure into a repeatable assertion or test. Does not automatically modify the test suite; requires human approval.
_Avoid_: regression test, bug fix, auto-fix

## Product Boundary

**Dynamic Workflow**:
Live multi-step agent orchestration with runtime dispatch and execution. Outside Amber's product boundary in V1.
_Avoid_: workflow (when meaning live execution), orchestration

## Navigation

**Service Package**:
A documentation grouping that maps a user outcome to existing CLI commands. Not a command namespace, hosted service, or execution mode.
_Avoid_: module, suite, package (when meaning an npm package)

**Product Repository**:
The target repository that develops and distributes Amber Protocol itself. Audit and adoption use product-repo rules and skip consumer starter-file checks.
_Avoid_: host repo, toolkit repo, source repo

**Team Preset**:
A named team distribution bundle that pins profile, workflow packs, and rule packs for `team install`. Not a CLI namespace or synonym for Profile.
_Avoid_: preset, config, template

**Team Distribution**:
Local metadata for installing, pinning, updating, rolling back, and inspecting Amber versions and team presets in a target repository.
_Avoid_: marketplace, release channel, package manager

**Progress State**:
The human-readable record of current progress and next actions, typically in `PROGRESS.md`.
_Avoid_: notes, scratchpad, status update

**Human Feedback**:
Recorded judgment explaining why work was accepted, redirected, narrowed, or rejected during review.
_Avoid_: comment, opinion, review note

**Control Layer**:
One of seven priority layers that frame how Amber capabilities are organized: Governance, Verification, Observability, Lifecycle, Context, Tooling, Execution. A documentation positioning frame, not a runtime module or command namespace.
_Avoid_: tier, level, stack
