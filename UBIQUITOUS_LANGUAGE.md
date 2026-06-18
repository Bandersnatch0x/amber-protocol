# Ubiquitous Language

> **Deprecated.** `CONTEXT.md` at the repo root is the canonical glossary. This file is retained for reference during migration; new terms and conflict resolutions belong in `CONTEXT.md` only. See `docs/agents/domain.md`.

## Amber domain

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| Amber Protocol | The product: a repository-local governance layer for coding agents that installs, audits, validates, and maintains agent-facing project state. | Coding Harness (legacy name), framework, platform |
| Amber setup | Repository-local operating layer that helps agents find context, track feature state, validate work, and hand off safely. | Harness (legacy term), agent OS |
| Amber state | Runtime state directory `.amber` holding sessions, executions, orchestration records, team metadata, and maintenance proposals. | state folder when ambiguous |
| Legacy Harness state | Pre-rename `.harness` runtime state. Readable for compatibility; never written for new entities. Migrate with `amber migrate state`. | .harness as an active term |
| Target repository | Repository being initialized, audited, validated, or maintained by the Amber setup. | project, app, repo when ambiguous |
| Product repository | This `amber-protocol` repository when `doctor` is validating the toolkit itself. | self repo, harness repo |
| Agent entrypoint | File that tells an agent where project context, rules, and verification live. | prompt file, instruction blob |
| Wiki | Stable project knowledge under `docs/wiki/` that agents should read instead of inventing facts. | docs, knowledge base |
| Feature state | Machine-readable status and evidence for planned or completed work. | task list, project status |
| Progress state | Human-readable current progress and next-action record. | notes, scratchpad |
| Handoff | Session-transition artifact that records repo state, runtime state, blockers, and next actions. | summary, context dump |
| Service package | Documentation and navigation grouping of existing CLI commands and artifacts around a complete governance outcome, such as onboarding, adoption review, delivery, continuity, or security governance. Service packages are not CLI commands themselves. | feature bucket, marketing category, CLI command group |
| Governance console | Repository-local command and artifact surface that records plans, evidence, approvals, verification, and handoff state for AI-assisted coding work. | hosted platform, live agent runtime |
| Continuity surface | Repo-local files that help humans and agents resume work without injecting content into a model automatically. | memory when ambiguous, state spine |
| Completion gate | Deterministic report-only check that explains whether a session has enough goal, timeline, verification, approval, and handoff evidence to be treated as complete. | LLM judgement, auto-accept |
| Evidence bundle | Reviewable set of repo-local artifacts that support a decision, such as a gate, adoption review, completion check, or audit. | chat transcript dump |
| Security governance pack | Declarative workflow pack and standard set for dependency, secret, permission, insecure-code, repair-verification, and high-risk-action review. | scanner implementation, exploit framework |

## Planning and review lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| Plan | Durable agent checkpoint that links a feature to source context, slices, verification, evidence, and approval state. | prompt, spec when used loosely |
| Source bundle | Structured set of inspected inputs that informed a plan, including provenance and confidence. | context pile, attachments |
| Gate | Static validation step that blocks implementation-ready status until required plan evidence exists. | approval step, check |
| Review | Static assessment of plan or work evidence against standards and required user action. | QA, audit when ambiguous |
| Accept | Operation that records a reviewed plan as accepted and appends Amber evolution evidence. | merge, approve |
| Human feedback | Recorded judgment explaining why work was accepted, redirected, narrowed, or rejected. | comment, opinion |
| Evidence | Concrete proof that a claim was verified, including commands, results, dates, and notes. | proof, output |
| Verification | Explicit checks an agent or human can run or inspect to validate behavior. | testing, validation |
| Replay | Artifact that lets a task result be inspected again without relying on chat history. | rerun, reproduction |

## Workflow and loop design

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| Workflow pack | Declarative package describing reusable workflow steps, skills, standards, scripts, contracts, and approval gates. | plugin bundle, automation |
| Profile | Project-specific workflow intent that selects standards, packs, and operating rules. | config, preset |
| Standard | Reusable review criterion selected by profile or changed file type. | rule, checklist |
| Rule pack | Installable group of standards distributed as team policy. | ruleset, lint pack |
| Loop contract | Dry-run-safe declaration of a repeated agent workflow, including trigger, cadence, state spine, hard stops, and review gates. | loop, scheduler |
| State spine | Durable artifact that records what a loop tried, what passed, what remains, and where to resume. | memory, state file |
| Triage output | Classification produced by discovery work: archive, candidate task, needs-human, blocked, or regression proposal. | finding, queue item |
| Hard stop | Declared loop limit such as maximum iterations, timeout, no-progress detection, or budget ceiling. | guardrail, limit |
| Integration contract | Declarative description of an external connector, permissions, redaction, and approval gates. | connector, MCP tool |

## Execution and orchestration artifacts

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| Task preparation | Creation of replayable task artifacts, worktree directory, ledger, and evidence pack without executing commands. | task run, execution |
| Execution ledger | Durable record of a prepared task, its plan, worktree path, commands, and failure attribution. | log, trace |
| Evidence pack | Replayable bundle of task evidence and requirements for inspection. | results folder, proof bundle |
| Orchestration record | Artifact-only record of worker assignment, reviewer assignment, status, and reviewer evidence. | dispatch, agent run |
| Worker | Agent role assigned to produce or draft work. | implementer, subagent |
| Reviewer | Separate role assigned to evaluate worker output and record evidence. | checker, verifier |
| Review bandwidth | Practical limit on how much candidate work can be trusted because someone must review it. | concurrency, capacity |

## Adoption and maintenance

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| Adoption report | Reviewable trial artifact summarizing audit, init dry-run, team status, and maintenance inspection for a target repository. | migration report, onboarding report |
| Adoption gate | Conservative decision artifact that says whether a target repository should wait, proceed, or address risks. | go/no-go, migration gate |
| Team distribution | Local metadata for installing, pinning, updating, rolling back, and inspecting Amber versions and presets. | marketplace, release channel |
| Maintenance proposal | Reviewable proposal for stale knowledge, upgrade guidance, drift, repeated findings, or regression candidates. | auto-fix, cleanup task |
| Amber evolution | Record of accepted lessons that may later update Wiki, standards, rule packs, or workflow-pack candidates. | changelog, retrospective |
| Regression proposal | Reviewable suggestion to turn a real failure into a repeatable assertion or test without modifying the test suite automatically. | regression test, bug fix |

## Relationships

- A **Target repository** may contain one **Amber setup**.
- An **Amber setup** has many **Agent entrypoints**, **Wiki** pages, **Feature state** records, and **Handoff** artifacts.
- A **Plan** belongs to exactly one **Feature state** entry and may reference many **Source bundle** items.
- A **Gate** validates one **Plan** before work is implementation-ready.
- A **Review** evaluates one **Plan** or artifact set against many **Standards**.
- An **Accept** operation records one successful **Review** into **Amber evolution**.
- A **Workflow pack** may include many **Loop contracts**, **Skills**, **Standards**, and **Integration contracts**.
- A **Loop contract** writes to one **State spine** and may produce many **Triage outputs**.
- A **Task preparation** creates one **Execution ledger**, one **Evidence pack**, and one **Replay** artifact.
- An **Orchestration record** links one **Worker** and one **Reviewer**; the **Worker** must not self-approve.
- A **Maintenance proposal** may promote repeated **Amber evolution** findings into **Standards**, **Wiki**, **Workflow pack** candidates, or **Regression proposals**.

## Example dialogue

> **Domain expert:** "Before a worker starts, the **plan** must show its **source bundle**, **verification**, and approval state."
>
> **Developer:** "So `gate` should block the **plan** until the user confirms it, and later `review` records the **human feedback**."
>
> **Domain expert:** "Right. If the work becomes recurring, capture it as a **workflow pack** or **loop contract**, but only as a dry-run artifact."
>
> **Developer:** "And if a real failure appears, we preserve the replay input and create a **regression proposal**, not an automatic test rewrite."
>
> **Domain expert:** "Exactly. The **Amber setup** records evidence and proposals; it does not run unattended automation for the user."

## Flagged ambiguities

- **Project** can mean the toolkit itself or a repository being inspected; use **Product repository** or **Target repository**.
- **Validation** can mean schema checks, plan gates, review, or runtime verification; use **Gate**, **Review**, or **Verification**.
- **Workflow** can mean a declared pack, a live agent process, or a repeated loop; use **Workflow pack** or **Loop contract**.
- **Execution** can mean prepared artifacts or real command execution; use **Task preparation** for artifact creation and reserve execution for future live behavior.
- **Connector** can imply a real external call; use **Integration contract** unless the Amber setup actually calls the external system.
- **Regression test** can imply modifying a test suite; use **Regression proposal** until a human approves the change.
