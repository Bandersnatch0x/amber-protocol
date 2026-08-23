# Governance-first, artifact-first protocol

Amber Protocol is a repository-local governance layer, not a live agent execution platform. It produces inspectable artifacts (plans, reports, timelines, approval records) and validates declarative contracts (routes, workflow packs) without executing Dynamic Workflows, dispatching live subagents, running target-repository commands automatically, or rewriting existing project documents.

We chose trust and inspectability over automation velocity. Live orchestration could ship faster demos but would blur safety boundaries, make adoption riskier, and turn Amber into a general agent OS competing with Codex and Claude Code runtimes rather than complementing them.

---

## Amendment (ADR-0019, 2026-08-23): Repository-local Core vs. optional non-executing distributed contexts

Per the distributed-governance baseline (`docs/architecture/distributed-governance-baseline.md`)
and ADR-0019, this ADR is amended to distinguish the **repository-local Amber Core** from
**optional non-executing distributed contexts**.

The Amber Core remains repository-local, offline-capable, inspectable, and authoritative for work
state, decisions, evidence, approvals, context, and accepted knowledge. This is unchanged.

The amendment adds that the Core may be *progressively configured* as a Personal Node, Team Hub,
or Organization Control Plane deployment profile (baseline §Deployment Profiles). These profiles
add optional distributed contexts — Sync Runtime, Governance Graph, Governed Knowledge Base,
Visualization Workbench, and Organization Control Plane — that are:

- **Non-executing.** No bounded context intercepts tools, dispatches workers, executes
target-repository work, or grants execution authority (baseline §Authority Boundaries, item 6).
- **Optional.** Personal Node runs with zero distributed contexts. Team Hub adds Sync Runtime and
minimum Organization Control Plane. Organization expands administrative scope.
- **Never authoritative.** Sync Runtime owns only synchronization-operational facts. Projections
(Governance Graph, Governed Knowledge Base, Visualization Workbench) are rebuildable read-only
models that never become canonical authority (baseline §Authority Boundaries, items 3-4).

This amendment preserves ADR-0001's governance-first, artifact-first posture: every mutation
returns to exactly one owning context through a versioned governed command or Action. Adapters
contain no independent domain rules. The distributed contexts extend the surface; they do not
introduce a second authority or execution platform.

The invariant traceability matrix (baseline rows 1, 2, 3, 12) directs this amendment.