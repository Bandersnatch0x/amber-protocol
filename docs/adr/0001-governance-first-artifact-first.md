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
or Organization Profile deployment (baseline §Deployment Profiles). These profiles
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

---

## Amendment (0047, 2026-09-16): PEP coverage as an explicit contract over bounded evidence classes

Per ticket 0047 (blind-spot ruling, option A) and the audit correction P1-04, this ADR is
amended to make the policy-enforcement-point (PEP) coverage an explicit contract instead of an
implied blanket guarantee. Amber's PEPs cover **all Amber-mediated side effects** — the
governed-runner four gates, the F052 runner lifecycle, and the F056 external-effect lifecycle
all pass the policy/approval boundary. Unmediated host-agent tool calls do not pass through
Amber; they are a declared blind spot, not an intercepted surface.

The amendment fixes four evidence classes so no record blends them:

1. **Amber-recorded facts** (requests, authorizations, ledger events) are observed facts about
   the mediation itself and claim nothing about external behavior.
2. **Executor self-reports** (runner receipts, adapter declarations) are claims; comparing a
   self-reported scope against an authorized bound is a fail-closed claim check that refuses
   violations — it is never an independent observation.
3. **Independently observed state** (a worktree read performed by an Amber-mediated command,
   classified by `classifyDirtyPaths`) observes file state inside the repository only. It can
   never establish the absence of network or out-of-repository effects, and it cannot attribute
   an unmediated change to a principal.
4. **Unobservable host actions** (direct host tool calls and egress) have no record point in
   Amber — not even a claimed one — and their assurance stays unavailable.

Consequences: out-of-scope post-hoc detection (declared path prefixes vs independently
observed dirty paths) records a FAIL file-state fact under `AMBER_E_RUNNER_EXECUTION_SCOPE`
without asserting actor attribution or network absence; a worktree diff never raises any
statement above observed file state. Runtime interception (PreToolUse-level blocking) remains
a possible future opt-in enhancement — never automatically installed, fail-open, and evaluated
only after the 0059 Runtime Adapter contract is implemented — and this amendment claims no
sandbox, runtime, or host-interception ownership.

Provenance: `issues/0047-runtime-interception-boundary.md` (2026-09-15 ruling; corrected
matrix appended 2026-09-16), audit P1-04 (`.scratch/product-scope-audit/0044-0060-2026-09-16-QjqMvx/REPORT.md` §5),
canonical contract `docs/specs/trusted-control-context-runtime-contract.md` §2. The earlier
amendment draft inside the ticket overstated what a worktree diff can establish; the ADR text
above is the corrected, binding form.