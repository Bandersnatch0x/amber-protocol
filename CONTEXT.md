# Amber Protocol

A governance protocol whose Amber Core is repository-local and offline-capable. Its optional distributed contexts synchronize and project governed artifacts without executing target work.

## Language

**Amber Protocol**:
The product: a governance layer for AI-assisted engineering whose Amber Core owns repository-local project state while optional distributed contexts add synchronization, shared projections, governed knowledge, visualization, and administration.
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

**Intent**:
A durable governance artifact stating why a change or investigation is needed, its desired outcome, scope, constraints, non-goals, and origin. An accepted Intent may trigger a Spec; it does not authorize implementation or execution.
_Avoid_: idea, request, ticket, prompt

**Spec**:
A durable governance artifact that refines an accepted Intent into requirements, design constraints, alternatives, and unresolved concerns. A Spec can be approved for planning without authorizing implementation or execution.
_Avoid_: design doc, implementation plan, proposal

**Decision Artifact**:
A canonical planning artifact recording one point-in-time authority act by a registered Principal — acceptance, approval, or review — bound to exactly one committed revision it decides. Its lifecycle is the single state `recorded`; an amended Decision is a new revision, never an in-place edit.
_Avoid_: audit log line, mutable status field, chat message

**Decision Kind**:
The closed set `acceptance | approval | review`. Acceptance and Approval are human-only slots a service identity can never occupy; a Review may be carried by a service Principal.
_Avoid_: sign-off, signoff type, verdict

**Principal Registry**:
The repository-local append-only ledger under `.amber/principals/` registering the humans and service identities that can act with authority, each with kind, role, membership, capability, scope, validity window, issuer, and terminal revocation state. It is the trust root Decision admission verifies against; its events are hash-chained and an in-place edit fails every read closed.
_Avoid_: user database, identity provider, session store

**Evidence Receipt**:
The append-only record under `.amber/evidence/` of one execution's provenance — producer (a registry-verified Principal snapshot), scope, subject, inputs, tools, environment, time, status, and outputs — written once and never rewritten. A receipt is the claim; verification is a separate event by an independent Principal.
_Avoid_: test log, build output, badge, verification record

**Approval Record**:
The append-only record under `.amber/approvals/` of one human authorization a Decision settles under — approver (a registry-verified human Principal snapshot frozen at grant time), scope, subject, and half-open validity window `[validAt, validUntil)`. Single-use, revocable, terminal on consumption; its effective status (`granted|revoked|consumed|expired`) is derived at read time against the reader's clock.
_Avoid_: permission flag, role assignment, session token, mutable approval state

**Approval Consumption**:
The atomic settlement of one Approval and the Decision it authorizes: the Decision is admitted (kind `approval`, principal = the frozen approver) and the single-use `consumed` event is appended binding the Decision's identity and revision, or nothing is written at all. One authorization can never be replayed.
_Avoid_: token redemption, approval check, gate pass

**Assurance Level**:
The closed four-level contract on Evidence: `unavailable | observed | replayable | verified`. Only the first three are recordable; `verified` is reached exclusively through an independent verification event (verifier id ≠ producer id), and `replayable` requires named replay provenance.
_Avoid_: confidence score, trust level, coverage percentage

**Eval**:
A versioned, reproducible assessment definition and its recorded outcome for a declared behavior, artifact, or policy. An Eval supplies Evidence to a Gate; it is not an Approval and cannot widen execution authority.
_Avoid_: benchmark score, model confidence, test log

**Finding**:
A provenance-backed observation produced by an allowed detector or review that identifies a deviation, risk, regression, or control-band breach. A Finding may propose an Intent but never silently creates one or mutates the target.
_Avoid_: alert, ticket, bug, inference

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

## Distributed Governance

**Amber Core**:
The repository-local, offline-capable bounded context that owns canonical governance artifacts, their admission rules, and governed Actions. It is not a hosted service or agent runtime.
_Avoid_: core service, local runtime, execution engine

**Sync Runtime**:
The optional non-executing bounded context that synchronizes typed immutable Domain Facts and Domain Events across Source Replicas and owns Sync Control Records for delivery, replay, Checkpoint, subscription, fencing, rejection, and Conflict recording. It validates and transports records but never owns source-domain facts, resolves their Conflicts, or executes target work.
_Avoid_: agent runtime, orchestration runtime, worker runtime

**Runtime Protocol**:
The single transport-neutral, versioned contract through which Amber Core and other bounded contexts negotiate and use Sync Runtime capabilities. It exposes only statically registered synchronization operations, queries, subscriptions, diagnostics, and typed settlements; it never exposes generic invocation, arbitrary commands, filesystem access, or domain authority.
_Avoid_: wire format, adapter API, execution protocol

**Component Type**:
An immutable, statically registered definition of one Runtime adapter contract, including its category, versions, schemas, integrity identity, capabilities, compatible ranges, allowed scopes and effects, dependencies, lifecycle contract, and upgrade class. It contains neither executable configuration nor mutable instance state.
_Avoid_: plugin package, discovered module, Component Instance

**Component Instance**:
An explicitly configured, scoped use of one Component Type with a stable logical identity, validated non-secret configuration, opaque Secret References, deterministic dependency bindings, and successive Component Generations.
_Avoid_: loaded plugin, process, Component Type

**Component Generation**:
One immutable admitted activation of a Component Instance, bound to exact configuration, dependency, contract, capability, policy, and fence evidence. Replacement is a forward fenced handoff to a new Component Generation; it is distinct from Source Generation and never rewrites synchronized lineage.
_Avoid_: Source Generation, retry, hot reload

**Secret Reference**:
An opaque, scoped reference to secret material resolved only inside its owning deployment boundary. Runtime records may carry its non-secret identity, version, freshness, lease, and resolution outcome, but never the secret material itself or a derivable value.
_Avoid_: credential value, redacted secret, configuration string

**Runtime Session**:
A stable, resumable Runtime Protocol context with one immutable negotiated and admitted identity, scope, protocol, capability, policy, and fence snapshot. Connections and Transport Bindings are replaceable routing details and never become authority or settlement identity.
_Avoid_: connection, process session, agent session

**Runtime Operation**:
One typed, scoped Runtime Protocol request with a caller idempotency identity, canonical input hash, deadline, admitted snapshot, progress evidence, and exactly one durable terminal settlement. Cancellation, deadline expiry, disconnect, and wait timeout do not imply rollback or settlement.
_Avoid_: command, transport request, agent task

**Degraded Read-Only**:
The explicit Runtime posture used when mutation authority, integrity, compatibility, required capability, policy, fence, dependency, or lifecycle state cannot be proven. It permits only proven scoped inspection, verification, diagnostics, durable-record lookup, and immutable export; it never becomes a stale-read or alternate-write fallback.
_Avoid_: best effort, fallback mode, partial authority

**Domain Fact**:
An immutable, content-hashed, provenance-bearing assertion emitted by the bounded context authoritative for its type. Synchronization may deliver or reject it but cannot change its meaning or authority.
_Avoid_: mutable object, projection row, synchronized truth

**Domain Event**:
An immutable record of a domain transition, decision, or Resolution with an explicit actor, valid time, recorded time, and causal parents. Source sequence orders it only within one Source Replica generation and stream.
_Avoid_: global sequence, mutable status, transport message

**Sync Control Record**:
An immutable Runtime-owned record for negotiation, Delivery, Checkpoint, acknowledgement, rejection, Conflict recording, or Ownership Handoff. It settles synchronization state without becoming a source-domain fact.
_Avoid_: Domain Fact, command, authority grant

**Sync Envelope**:
The single versioned immutable wrapper used by every Deployment Profile for a Domain Fact or Domain Event. It carries type and protocol versions, Tenant and governed-subject scope, explicit Repository scope state, stream and Source Replica generation, local sequence, actor, time, content hash, provenance, and causal identity.
_Avoid_: transport frame, global log entry, unscoped payload

**Source Replica**:
A stable identified copy of synchronized governance state. A connection, process, clone path, or device handle is not a Source Replica identity.
_Avoid_: connection, process, Repository Identity

**Source Generation**:
One admitted writer epoch for a Source Replica and stream. Checkpoints and cursors are pinned to it; an accepted Ownership Handoff or fenced recovery starts a new generation and leaves prior generations readable but unable to publish.
_Avoid_: retry count, schema version, connection generation

**Checkpoint**:
The last durably settled position for one Tenant, governed subject, Repository scope, stream, Source Replica, and Source Generation, bound to its schema and hash-chain state. It advances only after every delivered record has a durable outcome.
_Avoid_: cursor alone, acknowledgement request, best-effort offset

**Ownership Handoff**:
A governed transfer of mutation authority between Source Replicas that binds an accepted Checkpoint to a new fence and Source Generation. It never implies rollback, deletion, or implicit writer replacement.
_Avoid_: Delivery, reconnect, Continuity Handoff

**Governance Graph**:
A rebuildable, tenant- and repository-scoped projection of governance entities and their causal, provenance, temporal, and policy relationships. It is never a graph store authority or independent source of truth.
_Avoid_: graph database, system of record, memory graph

**Decision**:
An immutable, scoped governance record of a question, chosen outcome, rationale, alternatives and trade-offs, supporting and contradicting Evidence, actor and approver, lifecycle status, valid and recorded time, affected Artifacts, content hash, and provenance. It never records private reasoning.
_Avoid_: hidden reasoning, mutable choice, graph edit

**Claim**:
A provenance-bearing statement that can be supported, contradicted, superseded, or preserved in a Conflict. A Claim does not become accepted knowledge or domain truth merely because it is projected into the Governance Graph.
_Avoid_: accepted fact, inference, search result

**Action**:
A typed governed operation together with its invocation receipt, actor, scope, approval disposition, outcome, and Evidence. A projected Action describes governed activity; it does not grant the Governance Graph execution authority.
_Avoid_: raw command, graph mutation, execution engine

**Approval**:
An immutable authorization decision naming the approver, capability or Policy, explicit scope, outcome, valid and recorded time, and provenance. Approval never widens scope implicitly or overrides a deny-wins rule.
_Avoid_: implicit consent, permission flag, Resolution

**Decision Owner**:
The named role accountable for a governed decision at a Gate. A Decision Owner may rely on Evidence and other Approval records, but cannot delegate the decision to a model or infer it from an Artifact status field.
_Avoid_: assignee, reviewer, approver (when the role is broader than an authorization)

**Provenance Envelope**:
The mandatory provenance carried by every durable Governance Graph node, edge, Domain Fact/Event projection, and Inference: source and Resolution owners, source identity and content hash, actor, originating Action or causal parent, explicit scope, derivation kind, confidence or assurance, valid and recorded time, correlation/causal metadata, and source-stream predecessor metadata when available. An Inference also records its rule/version and every input identity and hash.
_Avoid_: citation string, optional metadata, source label

**Inference**:
A rebuildable conclusion produced by a versioned deterministic rule from explicitly identified, content-hashed inputs. It is always distinct from authored or observed facts and never becomes authoritative through projection.
_Avoid_: Claim, accepted knowledge, hidden rule

**Graph Projection Freshness**:
The per-scope status of a Governance Graph projection, proven by its source Checkpoint or sequence, schema and projection-rule versions, build and last-applied times, and integrity evidence. The status is fresh, stale, rebuilding, or blocked; stale or unprovable state fails closed to read-only inspection.
_Avoid_: cache age, best-effort current, timestamp alone

**Governance Graph Projection Bundle**:
A versioned, scoped, read-only internal interchange form containing projected node and edge records, Provenance Envelopes, source hashes, schema and projection-rule versions, Checkpoint and freshness metadata, and integrity evidence. Import is always governed admission followed by rebuild validation; the bundle is never an authoritative graph write.
_Avoid_: backup authority, direct graph import, mutable snapshot

**Governed Knowledge Base**:
The bounded context that governs Knowledge Record admission, review, freshness, refresh, supersession, retirement, and cross-repository discovery. It is distinct from the Wiki, and its catalogs and indexes are rebuildable.
_Avoid_: Wiki, document store, generic ingestion platform

**Knowledge Record**:
A provenance-backed, reviewed, freshness-aware unit of durable knowledge with an explicit lifecycle and owning repository. A Context Page is Amber Core's distilled form of a Knowledge Record, not a competing concept.
_Avoid_: raw event, generated summary, Wiki page

**Visualization Workbench**:
The distributed exploration surface for temporal, relationship, and knowledge projections. It is distinct from the repository-local Governance Console and never acts as an authoritative write path.
_Avoid_: Governance Console, visualization store, source of truth

**Organization Control Plane**:
The service-side bounded context that owns tenants, principals, membership, repository registration, tenant configuration, assigned policy, and administrative audit. It does not own repository work state or execute target work.
_Avoid_: Organization Profile, execution plane, repository authority

**Principal**:
A Tenant-scoped authorization subject. A Principal is exactly one Person or Agent Identity; Amber does not create a cross-Tenant Principal identity.
_Avoid_: account, global user, actor alias

**Person**:
A Tenant-scoped Principal representing a human. The same human in different Tenants is represented by distinct Persons that Amber does not automatically link.
_Avoid_: user account, global person, operator identity

**Agent Identity**:
A Tenant-scoped Principal representing a non-human actor. It never impersonates a Person, has independent Membership and Role Assignments, and names an accountable Person Membership or Team in the same Organization.
_Avoid_: bot user, Person alias, execution worker

**Tenant**:
The hard boundary for identity, authorization, assigned policy, and distributed governance data. Each Tenant has exactly one root Organization and never shares a Principal, Membership, or authoritative fact with another Tenant implicitly.
_Avoid_: Organization, Deployment Profile, hosted instance

**Organization**:
The root governance subject inside one Tenant. It contains the Tenant's Teams and Repository Registrations but is distinct from the Tenant isolation boundary and from the Organization Profile Deployment Profile.
_Avoid_: Tenant, Organization Profile, Organization Control Plane

**Team**:
An optional flat governance group inside one Organization. A Team never crosses a Tenant or contains another Team, and its authority comes only from explicit Membership and Role Assignments.
_Avoid_: Tenant, nested group, permission boundary

**Repository Identity**:
The stable identity of one Target Repository across clones and synchronization replicas. It belongs to one Tenant and Organization at a time; replicas are distinguished by source replica and generation rather than becoming new Repositories.
_Avoid_: clone identity, replica identity, Repository Registration

**Membership**:
An explicit lifecycle relationship between a Principal and an Organization or Team in the same Tenant. Membership establishes belonging but grants no capability by itself; Amber does not define Repository Membership.
_Avoid_: permission, Role Assignment, Repository access

**Role**:
A named, versioned capability bundle defined within one Tenant. A Role has no subject or resource scope until a Role Assignment applies it.
_Avoid_: Membership, Policy, permission grant

**Role Assignment**:
A lifecycle relationship that binds one Role to a Person, Agent Identity, or Team at exactly one Organization, Team, or Repository scope. Effective Role Assignments require active Membership and remain subject to deny-wins policy evaluation.
_Avoid_: Membership, Role, Policy Assignment

**Policy Assignment**:
A lifecycle relationship that binds an immutable Policy version to an explicit subject selector and resource scope. It can restrict capabilities but never independently grant them or relax Amber Core safety invariants or Repository rules.
_Avoid_: Policy, Role Assignment, capability grant

**Deployment Profile**:
A supported composition of distributed-governance bounded contexts that shares one protocol and artifact model. Profiles change deployment shape and governance scope, not Tenant count, commercial tier, or repository artifact semantics.
_Avoid_: bounded context, product tier, protocol variant

**Personal Node**:
A single-operator, offline-first Deployment Profile centered on Amber Core, with one deterministic local Tenant, Organization, and Person scope, optional local projections, one or more Repositories, and no required service.
_Avoid_: single-user mode, local runtime

**Team Hub**:
A self-hosted Deployment Profile for one Tenant and one Organization that adds synchronization, shared projections, and the minimum administrative authority needed for Person and Agent Identity, Team, Membership, Repository Registration, Role Assignment, and Policy Assignment.
_Avoid_: central source of truth, hosted organization service

**Organization Profile**:
A Deployment Profile using the same identity and authorization semantics for organization-wide administration and cross-Repository governance without changing Amber Core artifact authority. A service may host multiple isolated Organization Profile Tenants without creating another Deployment Profile.
_Avoid_: Organization Control Plane, enterprise edition, protocol variant

**Conflict**:
A first-class record of structurally valid, provenance-bearing competing claims that cannot all become domain truth because they violate an explicit invariant. It is distinct from Rejection and Corruption, preserves every claim, and remains visible after the context owning the invariant records an explicit governed Resolution.
_Avoid_: last-write-wins, merge failure, silent overwrite

**Rejection**:
A durable typed settlement for a record that cannot enter synchronization state because its type, scope, capability, authority, policy, fence, or provenance is invalid or unprovable. A Rejection is acknowledged as settled receipt but is not semantic acceptance or a Conflict.
_Avoid_: Conflict, retry forever, silent drop

**Corruption**:
An identity, content-hash, source-sequence, hash-chain, or Checkpoint-lineage contradiction that makes the affected write stream untrustworthy. Corruption fails closed to read-only inspection until governed repair and is never resolved by choosing a competing claim.
_Avoid_: Conflict, duplicate, recoverable warning

**Resolution**:
An immutable governed event recorded by the bounded context owning a violated invariant. It links the Conflict and every preserved claim to the decision, approver, outcome, evidence, valid and recorded time, and provenance without editing or deleting prior records.
_Avoid_: overwrite, deletion, Runtime merge

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

**Canonical Artifact**:
The authoritative governance record formed by one human-readable Artifact Body and its machine-actionable Artifact Envelope, bound by revision, content hash, and provenance. A projection or adapter may reference it but cannot become a competing authority.
_Avoid_: artifact pair, rendered document, graph node

**Artifact Body**:
The human-readable content of a Canonical Artifact. Its meaning is governed together with the corresponding Artifact Envelope; neither side may carry an independent mutable status.
_Avoid_: markdown file, document body, description

**Artifact Envelope**:
The machine-actionable metadata for a Canonical Artifact, including identity, type, revision, source owner, provenance, content hash, and lifecycle references. It is not a second artifact authority.
_Avoid_: header, metadata blob, status file

**Admission**:
The one atomic CLI operation (`artifact admit`) that binds an Artifact Body and its Artifact Envelope into one immutable revision, settles it through durable prepared/committed/aborted journal records, and returns a receipt. Only committed revisions are visible to reads; retries and supersession go through admission, never in-place edits.
_Avoid_: upload, import, save

**Canonical Owner**:
The one bounded context or registered external system responsible for the authoritative revision and lifecycle of a record. Other surfaces may project or adapt it only with an explicit linkage and freshness state.
_Avoid_: primary copy, source file, latest writer

**Evidence**:
Concrete proof that a claim was verified: command, result, date, and notes. A kind of artifact recorded in features and plans.
_Avoid_: proof, output, log

**Evidence Assurance**:
A bounded statement of how strongly an Evidence record can support a Gate: `unavailable`, `observed`, `replayable`, or `verified`. Each Gate declares its minimum assurance and required receipt fields; an assurance label never substitutes for those fields.
_Avoid_: confidence score, pass/fail, trust level

**Verification**:
Explicit steps an agent or human can run or inspect to validate that behavior meets expectations. Describes what to check, not the check results.
_Avoid_: testing, validation, QA

**Control Band**:
A versioned deterministic rule over declared observations that defines an allowed operating range and the response to a breach. A breach produces a Finding with Evidence; it does not directly authorize remediation or release.
_Avoid_: alert threshold, model score, health check

**Trigger Proposal**:
A request to consider the next governed stage, carrying its source Artifact and Evidence. It is not a Gate decision, Approval, or execution command.
_Avoid_: approval request, automatic transition, job

**Triage Decision**:
An explicit service-owner disposition of a Finding: `fix`, `schedule`, or `dismiss`. Only `fix` may create a candidate Intent, which still passes the ordinary Intent Gate.
_Avoid_: auto-remediation, severity score, classifier output

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

**Execution Boundary**:
The policy and capability boundary separating Amber's governance actions from target-repository or environment side effects. In 2.0, Amber may inspect, validate, plan, and record externally performed results; Evidence of an action does not grant Amber authority to perform it.
_Avoid_: runner permission, automation mode, sandbox alone

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

**Adapter**:
A read-only compatibility surface that maps a legacy or external record to a Canonical Artifact while preserving source bytes, hashes, provenance, and the external system's Canonical Owner until an explicit cutover.
_Avoid_: importer, synchronizer, migration rewrite

**Cutover**:
An explicit, bounded, reversible decision that changes the Canonical Owner for a declared artifact type or scope after compatibility and rollback evidence pass. Cutover never silently rewrites historical records.
_Avoid_: migration complete, takeover, sync

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

## Storage And Read Model

**Canonical Record**:
An immutable, schema-versioned Domain Fact, Domain Event, or Sync Control Record that retains one source owner and one Resolution owner. Canonical records and their governed Artifact bodies are authoritative; mutable rows, snapshots, indexes, and caches are not.
_Avoid_: source row, mutable record, projection authority

**Content-Addressed Artifact**:
An immutable Artifact body identified by its content hash and owned by the bounded context that admits it. Its identity and hash are distinct from any Domain Event identity, and references to it do not authorize arbitrary file or secret transfer.
_Avoid_: blob store, file authority, attachment

**Projection**:
A rebuildable read model derived from authoritative canonical records, admitted events, or Sync Control Records under declared schema and projection-rule versions. A Projection never becomes a source-domain authority or an independent mutation path.
_Avoid_: materialized truth, replica authority, mutable view

**Projection Freshness**:
The per-scope evidence state of a Projection, including its source Checkpoint or watermark, applied schema and projection-rule versions, build and last-applied times, and integrity evidence. Its status is fresh, stale, rebuilding, or blocked; it cannot support an unproven currentness or authority claim.
_Avoid_: cache age, current by timestamp, best-effort freshness

**Query Contract**:
A statically registered, typed, finite, and scoped read definition that declares exact scope, capability and Policy checks, filtering, sorting, direction, bounds, truncation, and result evidence. It does not expose arbitrary query languages, server-side code, unbounded scans, or scope-widening joins.
_Avoid_: query string, database query, free-form search

**Read Cursor**:
An opaque position bound to a Query Contract, exact scope, Projection identity and versions, source Checkpoint or watermark, sort/filter hash, direction, and declared expiry or retention. A changed binding or lineage invalidates it; it never silently restarts.
_Avoid_: offset, page number, global cursor

**Read Snapshot**:
An explicit per-scope immutable observation bound to canonical or Projection watermark, schema and rule versions, and integrity evidence. It remains usable only while its source lineage is verifiable and never promises global or cross-scope atomicity.
_Avoid_: global snapshot, mutable view, timestamp snapshot

**Subscription**:
A durable accepted Runtime Operation with an immutable typed filter, exact scope, capability hash, receiver credit, receiver Checkpoint, at-least-once replay, and one terminal settlement. A filter, scope, or contract change creates a new Subscription.
_Avoid_: live feed, implicit listener, best-effort stream

**Consistency Level**:
An explicitly proven per-scope read posture: canonical-local, causally-complete, checkpoint-bounded, projection-fresh, or degraded-read-only. Profiles advertise only levels they can prove and never silently upgrade or fall back to a stronger posture.
_Avoid_: eventual consistency, read preference, freshness mode

**Retention Policy**:
An explicit governed policy for retaining canonical history, Artifact bodies, provenance, causal lineage, Resolution lineage, and Conflict, Rejection, and Corruption evidence. Expiry is a typed unavailable or blocked posture, never a silent gap; compaction is limited to rebuildable or disposable material after replay proof.
_Avoid_: cleanup, automatic deletion, archive shortcut

**Backpressure**:
A typed non-admission posture caused by bounded item, byte, or outstanding-work capacity. Producers pause or receive Backpressured outcomes while control capacity remains available for fencing, cancellation, flow control, and terminal settlement; records are not dropped, reordered, or silently rerouted.
_Avoid_: overflow, lossy queue, hidden spillover

## Security, Privacy, And Isolation

**Trust Boundary**:
An explicit boundary inside which a named bounded context, authenticated Principal, admitted Policy and capability Evidence, exact scope, and integrity-checked state may support an authority claim. A transport, Projection, cache, local operator assertion, or administrative assertion outside its proven authority never becomes a trust root.
_Avoid_: implicit trust, service trust, administrator override

**Authorization Evidence**:
The immutable evidence for one deny-wins authorization decision: Principal, active Membership, Role Assignment, Policy Assignment, capability, exact scope and effect, validity window, policy and schema versions, source pointers and hashes, fence and generation inputs, decision time, and outcome. Missing, stale, ambiguous, or unverifiable evidence fails closed.
_Avoid_: permission flag, token claim, cached allow

**Tenant Isolation**:
The non-crossable separation of identity, authorization, Policy, administrative data, synchronized data, Projections, audit, and retention by Tenant. Organization, Team, Repository, Source Replica, Source Generation, cursor, Checkpoint, Subscription, export, and audit scopes remain explicit and never blur through joins, caches, or fallback.
_Avoid_: tenant filter, namespace convention, best-effort separation

**Privacy Minimization**:
The rule that an operation, Projection, query, Subscription, export, log, audit record, or Evidence bundle receives only the fields necessary for its declared capability, exact scope, and purpose. Identifiers and content hashes do not substitute for authorization.
_Avoid_: collect then redact, broad visibility, metadata exception

**Redaction State**:
A deterministic bounded result that records which unauthorized or unnecessary fields were omitted without exposing them through values, counts, ordering, errors, indexes, caches, logs, or Projection metadata. It never falls back to an unredacted result.
_Avoid_: masked success, hidden omission, best-effort redaction

**Audit Anchor**:
The owning context's append-only canonical Artifact or ledger lineage to which a provenance-bearing audit record is bound by content hash and predecessor or hash-chain state. A Projection may expose the record but cannot rewrite its authority; failed verification blocks the affected operation.
_Avoid_: audit view, mutable log, external authority

**Deletion Tombstone**:
An immutable owner-governed record proving that scoped content was deleted and preventing replicas, Projections, indexes, caches, exports, or Subscriptions from resurrecting it. It preserves only minimum privacy-minimized deletion and prior-authority Evidence, contains no secret material, and is not a restore source.
_Avoid_: soft delete, hidden backup, empty record

**Retention Hold**:
An explicit scoped Policy or Resolution that prevents destruction of governed content and its required Evidence until the owning context records release or replacement. It does not silently widen access or suspend privacy minimization.
_Avoid_: permanent retention, administrator note, backup lock

**Security Incident Posture**:
The fail-closed response to compromise, replay, downgrade, cross-scope reuse, or Corruption: preserve claims and Evidence, expose affected scope and uncertainty, revoke or fence impacted identities, bindings, and generations, and require the owning context's Resolution or governed recovery. Unaffected scopes continue only when their checks pass.
_Avoid_: silent repair, destructive reset, automatic branch selection

**Administrative Separation**:
The ownership rule that Organization Control Plane governs Tenant administration, identity, Membership, Repository Registration, assigned Policy, capability, fencing, revocation, retention directives, and administrative audit while Amber Core retains Repository work authority and Sync Runtime retains only synchronization-operational authority. Administrative authority cannot rewrite Repository work or resolve its Conflict.
_Avoid_: superuser ownership, service authority, administrative override

## Compatibility And Migration

**Compatibility Relation**:
A proven, directional relation among a Runtime Protocol version, contract and schema versions, required capability identities and hashes, Policy and fence state, dependencies, lifecycle state, and exact scope. Transport reachability or parseability alone never proves compatibility or authority.
_Avoid_: generic semver compatibility, best-effort interoperability, transport compatibility

**Version Domain**:
An independently versioned identity space whose meaning cannot be substituted by another: Runtime Protocol, contract/schema, capability, projection rule, Component Generation, or Source Generation. Each admitted Runtime Session and Runtime Operation binds the domains it uses explicitly.
_Avoid_: single version, release number, generation alias

**Compatibility Matrix**:
A deterministic, scope-bound record of supported Version Domains, compatible ranges, required capability hashes, upgrade classes, policy and fence prerequisites, and unknown-version outcomes used by a profile gate. It never authorizes an unproven combination.
_Avoid_: compatibility guess, fallback table, feature flag list

**Migration Checkpoint**:
A durable position after a bounded migration step has a settled outcome, validation evidence, and idempotency identity. Repeating the same identity returns the existing settlement or performs no operation; it never duplicates or rewrites canonical history.
_Avoid_: progress marker, best-effort offset, rollback point

**Source-Generation Fence**:
An integrity-checked boundary that prevents a superseded Source Generation from publishing or resuming writes. Recovery or Ownership Handoff creates a new generation while preserving prior lineage for read-only evidence and replay.
_Avoid_: reconnect flag, retry counter, schema version

## Governance Tracer Scenario

**Governance Tracer Scenario**:
A decision-complete architecture fixture that follows one scoped Decision, Evidence, Context/Knowledge candidate, causal lineage, and Provenance Envelope from Personal Node capture through bounded Team Hub synchronization to Organization Profile audit. It validates contracts and acceptance gates without implementing a prototype or claiming production readiness.
_Avoid_: demo runtime, production prototype, execution scenario

**Evidence Receipt**:
A deterministic, replayable record of one tracer outcome containing stable identities, canonical serialization, exact scope, versions, lineage, hashes, causal parents, authorization or redaction references, and the durable outcome. Applied, duplicate, Rejection, Conflict, Corruption, unsettled, and Degraded Read-Only outcomes are explicit and never silently replaced.
_Avoid_: success log, transport acknowledgement, test screenshot

**Knowledge Candidate**:
A provenance-backed, scoped proposal for Governed Knowledge Base admission that names its owning Repository, source identities and hashes, confidence, freshness policy, and review state. Synchronization, projection, raw events, logs, transcripts, summaries, and inferences cannot admit it as accepted Knowledge.
_Avoid_: accepted Knowledge Record, generated summary, raw event

**Knowledge Admission**:
An explicit governed transition that creates an immutable Knowledge Record version from an eligible Knowledge Candidate only after authorized human review/approval, complete Provenance Envelope, exact scope, source/Resolution owner, confidence/assurance, freshness policy, valid/recorded time, privacy/retention decision, and a durable receipt. It never promotes raw events, logs, transcripts, generated summaries, inferences, search results, or projections automatically.
_Avoid_: automatic acceptance, implicit promotion, projection authority

**Knowledge Record Version**:
One immutable content-hashed version of a Knowledge Record's canonical assertion and provenance, linked to predecessor, refresh, supersession, Conflict, retirement, and tombstone lineage; a changed assertion creates a new version and never rewrites the prior version.
_Avoid_: mutable knowledge record, in-place refresh, projection row

**Knowledge Reuse**:
A governed consumer-Repository proposal and review that references an exact source Knowledge Record Version and hash without transferring source authority; acceptance creates a distinct consumer-owned record/lineage and source retirement, deletion, or Policy change produces explicit invalidation or re-review receipts.
_Avoid_: authority transfer, implicit copy, cross-Tenant reuse

**Knowledge Lifecycle Receipt**:
An immutable deterministic replayable receipt for one knowledge proposal, review, admission, rejection, refresh, no-change, Conflict, supersession, retirement, deletion, reuse, invalidation, or Degraded Read-Only outcome, bound to identity/hash, exact scope, actor and authority evidence, provenance, causal lineage, and valid/recorded time; each item settles independently and identity/hash mismatch is Corruption.
_Avoid_: success log, mutable status, silent fallback

**Audit Query Declaration**:
The immutable scope and purpose declaration for one Organization Profile audit read: Tenant, governed subject, explicit Repository set, Principal and capability, Authorization Evidence, temporal clock, relationship bounds, filter and sort, cursor or snapshot, Checkpoint/watermark, and redaction posture. Continuation revalidates these bindings and cannot widen scope or reuse stale authority.
_Avoid_: unrestricted query, global search, implicit join

**Profile Acceptance Gate**:
A deterministic evidence gate for promoting a Deployment Profile, covering identity, exact scope, authority, offline capture and replay, idempotence, Conflict preservation, Provenance, Knowledge admission, projection rebuild parity, read-only visualization, Tenant Isolation, Privacy Minimization, bounded queries, explicit degradation, and no-execution. A failed or unavailable gate blocks promotion and leaves the prior Profile usable.
_Avoid_: readiness by liveness, soft launch, best-effort promotion

**Tracer Scenario Frontier**:
The numbered set of unresolved architecture decisions for the Governance Tracer Scenario. The frontier is empty only after explicit round-by-round confirmation of the three-profile flow, canonical records, deterministic Evidence Receipts, acceptance gates, non-claims, and deferred implementation fog.
_Avoid_: implementation backlog, prototype TODOs, implied technology choice

**Projection Identity**:
The deterministic identity of one rebuildable read model: view kind, canonicalized Query Contract, Tenant and exact Repository/Profile scope, schema and projection-rule versions, source generation vector, and Policy/Redaction revision. It never grants source authority or mutation capability.
_Avoid_: view URL, cache key alone, visualization authority

**Projection Generation**:
The generation and watermark evidence produced by rebuilding a Projection from declared canonical snapshot, schema, projection-rule, Policy, Redaction, and source inputs. A mismatch or unverifiable input makes the Projection stale or Degraded Read-Only, never silently fresh.
_Avoid_: cache timestamp, refresh hint, inferred currentness

**Projection Read Receipt**:
An immutable deterministic record of one read-only projection operation containing its canonicalized request, exact scope, Read Snapshot, generation vector, policy/redaction and schema revisions, ordered identifiers, lineage, and explicit uncertainty, conflict, redaction, freshness, or degradation state. It is not mutation authorization.
_Avoid_: UI event, success log, command authorization

**Projection Evidence Package**:
A versioned integrity-protected export of a Projection and its read evidence, including canonicalized request, immutable snapshot, exact scope, authorization, generation/watermark vector, schema and projection-rule versions, policy/redaction revision, ordered identifiers, lineage, receipts, and non-fresh states. Import is governed admission input, not authority restoration.
_Avoid_: backup restore, authority copy, unverified export

**Temporal Projection**:
A rebuildable Projection of authorized canonical facts and lifecycle transitions ordered by recorded-time, effective-time under a fixed null rule, stable identity, and revision/content hash. Each item retains source/Resolution ownership, Provenance, lineage, freshness, Conflict or uncertainty state, and an evidence reference; it never becomes authority or mutable history.
_Avoid_: event log, wall-clock timeline, mutable history

**Relationship Projection**:
A rebuildable Projection of declared, Provenance-bearing relationships among authorized canonical records, including Decision-to-Evidence, Resolution-to-Knowledge, supersession, refresh, dependency, Conflict, and Context links. It never infers causality from adjacency, similarity, ranking, or layout, and never becomes graph authority.
_Avoid_: inferred graph, adjacency truth, layout authority

**Projection Query Envelope**:
The normalized deterministic result of one authorized Projection read, containing Read Snapshot, Projection Identity and Generation, canonical query echo/hash, ordered nodes/items and edges, exact-scope omission or redaction reasons, freshness or Degraded Read-Only state, and a Projection Read Receipt. It is read evidence, not mutation authorization.
_Avoid_: query response, view state, mutation result

**Projection Decision Tree**:
The deterministic sequence that validates a Workbench Fixture, schema, exact scope, Policy, authorization, source lineage, and Projection Generation; applies deny-wins privacy; builds or degrades projections; bounds read operations; rejects mutation-shaped requests; and requires rebuild parity before acceptance. It has no execution or heuristic fallback authority.
_Avoid_: UI workflow, Runtime execution, heuristic fallback

**Implementation Acceptance Contract**:
The decision-complete internal-language criteria and phase-gate evidence required before implementation mutations begin: architecture ownership, ADR and invariant traceability, contracts and versions, compatibility, profile tracers, threat-model evidence, deterministic fixtures and outputs, operational boundaries, rollback and promotion, and explicit authorization. It selects no implementation technology and grants no execution authority.
_Avoid_: release checklist, implementation plan, technology choice

**Implementation Handoff Bundle**:
The bounded internal-language handoff record that separates accepted decisions, required implementation evidence, deferred fog, non-claims, unresolved risks, and exact authorized next mutations. It is a governance input, not implementation, production readiness, or a transfer of authority.
_Avoid_: deployment package, project dump, execution grant

**Phase Gate**:
A staged promotion checkpoint requiring complete deterministic evidence, compatibility proof, invariant non-regression, and explicit authorization. Rollback preserves append-only lineage and returns to the last fully evidenced generation or Checkpoint without destructive or silent fallback.
_Avoid_: sprint boundary, release approval, silent rollback
