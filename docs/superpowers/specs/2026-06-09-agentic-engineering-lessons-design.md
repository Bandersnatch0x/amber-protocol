# Agentic Engineering Lessons Design

Date: 2026-06-09
Status: approved for documentation update

## Context

The pasted Matt Van Horn article describes an agentic engineering workflow built around `plan.md`, voice input, multi-session work, recent-context research, raw transcript ingestion, reusable skills, and human review. The useful lesson for Coding Harness is not the specific tool stack. The useful lesson is the shape of the workflow: durable plans, rich source context, explicit human judgment, and compounding reusable workflows.

Coding Harness should absorb those lessons without changing its product boundary. The project remains a repository-local operating toolkit with safe scaffold, audit, doctor, handoff, planning, review, workflow-pack, evidence, orchestration-record, team-distribution, and maintenance artifacts. It must not become a live agent runner or external automation platform.

## Adopted Design

### Durable Plan Checkpoints

Plans should be treated as agent-readable recovery checkpoints, not just human prose. A plan should carry enough state for a fresh session to resume: feature tie-back, source bundle, constraints, implementation slices, verification, acceptance criteria, current blockers, and next action.

### Plan Source Bundles

Planning should support a structured source bundle. Sources can include issue URLs, screenshots, terminal errors, meeting transcripts, historical plans, research summaries, and codebase findings. Each source should record provenance, freshness when known, confidence, and whether it was directly inspected or supplied by the user.

### Human Feedback Loop

Review and acceptance should capture human judgment as first-class evidence. The important signal is not only "approved" or "rejected"; it is the reason for redirecting work, preferring one option over another, accepting a risk, or asking for a narrower slice.

### Workflow-Pack Promotion

Repeated work should have an explicit promotion path. A recurring plan/review finding can become a proposed Wiki update, standard/rule-pack update, or workflow-pack candidate. The proposal remains reviewable and does not automatically rewrite project files or publish external packages.

## Non-Goals

- Do not add remote/email task ingress that starts live agents.
- Do not recommend permission-bypass or YOLO execution modes as product defaults.
- Do not call external services while validating plans or packs.
- Do not dispatch workers, run task commands, or operate user accounts from the core Harness.

## Documentation Impact

- `SPEC.md`: clarify the adopted agentic-engineering mechanisms and safety boundaries.
- `ROADMAP.md`: add source bundles, durable checkpoints, human feedback evidence, and workflow-pack promotion to the relevant phases.
- `README.md`: describe the plan and review surfaces in terms of source bundles, recovery checkpoints, and human-readable artifacts.
