# ADR-0030: Coding-Agent-Enabled Repositories and Trusted Continuation

**Status:** Accepted  
**Date:** 2026-09-04  
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md),
[ADR-0022](0022-pilot-execution-boundary-and-external-evidence.md),
[F063](../specs/F063-product-closeout-seven-verb-default-surface.md)

## Context

Amber's engineering and governance capabilities are substantially broader than its demonstrated
external use. The product previously named individual developers using specific coding-agent hosts
as its primary user, but that segment includes one-off and low-risk use where continuity and evidence
are not strong enough problems. The product review and value adjudication found a narrower,
testable wedge: real coding-agent work that crosses a session, agent, or person and must still be
reviewed and resumed without reconstructing state from chat history.

## Decision

Amber targets **Coding-Agent-Enabled Repositories**: long-lived software repositories whose
maintainers already use one or more coding agents for recurring, real delivery work subject to
human review. The reader-facing Chinese description is **已接入 Coding Agent 的项目**. A tool merely
being installed, or a one-off experiment, does not qualify.

The repository is the target environment, not the user. Amber's primary users are the Repository
Maintainers, agent-assisted developers, and reviewers responsible for work in that environment.

Amber's core problem is loss of authoritative work state across sessions, agents, and people. Its
core product outcome is **Trusted Continuation**: governed work can be resumed from current Intent,
Evidence, checkpoint, and Handoff without relying on chat history to reconstruct what changed,
what actually ran, or what safe action comes next.

Governance remains the mechanism that makes Trusted Continuation credible; it is not the first-screen
user promise. The Agent router and four deep journeys remain the primary entry, while the seven CLI
verbs are the deterministic fallback. Advanced governance capabilities stay available in expert
surfaces but do not expand or enter the default product promise without repeated external demand.

The next product goal is evidence, not feature count: complete the existing two-independent-repository,
ten-real-task field pilot and re-adjudicate review/handoff time, Evidence completeness, human overhead,
and net benefit. F064 Improvement Suggestions and the Web Viewer remain optional experimental or
inspection surfaces until the core outcome is validated.

## Considered Options

- Continue expanding the advanced trust platform: rejected as the next mainline because external
  demand for the additional objects is unverified.
- Make the Web Viewer and Improvement Suggestions the product: rejected as the next mainline because
  they solve a second-order problem that requires repeated use to exist first.
- Reposition for enterprise compliance: rejected because no buyer, deployment, certification, or
  repeated-team evidence currently supports that promise.

## Consequences

- Product documents distinguish target environment from target users.
- Acquisition and activation material leads with one real Trusted Continuation journey.
- Readiness score, feature count, command count, and download count are not product-value metrics.
- New default-surface or advanced-governance work requires evidence from repeated real tasks or at
  least two independent teams asking for the same capability.
- Existing advanced capabilities are preserved and maintained; this decision does not delete them
  or weaken their safety contracts.

## Amendment (F082, 2026-09-24): §55 first-screen positioning — Governed Agent Harness

**Status:** Accepted (positioning ruling by the user, 2026-09-24, recorded as an explicit scope
override: the earlier prerequisite of an external-pilot signal is replaced by the repository's own
H7 + cancellation acceptance evidence)
**Cites:** Harness v2 proposal §55 (product positioning after v2); ADR-0103/F079 (bounded runtime
and cancellation authority); F080 (bounded maintenance runtime) and F081 (owned execution handles
and truthful cancellation) acceptance evidence

This amendment **amends, and does not supersede**, the 2026-09-04 decision and the 0046 amendment.
Trusted Continuation remains the coding-domain core product outcome; the positioning lifts to the
level the boundary has now actually reached.

### Positioning

> **Governed Agent Harness for real engineering systems.**
>
> **Amber Protocol is the governed execution boundary between AI agents and real systems.**
>
> **面向真实工程系统的受治理 Agent Harness。**
> **Amber Protocol 是 AI Agent 与真实系统之间的治理执行边界。**

The first screen (README, both languages) now leads with this wording. The 0046 sentence is
preserved verbatim above it in spirit: what an agent may see, use, execute, and emit, with whose
approval, and what evidence proves it.

### Scope override recorded

The 0046 amendment and the product boundary required an external signal before a first-screen lift.
This amendment records a user ruling that the **internal acceptance evidence now substitutes for that
signal**: Harness H0–H6 (F065–F074), the bounded maintenance runtime (F080), and owned execution
handles with truthful cancellation (F081) are delivered, reviewed, and green. This is a scope
decision, not an implementation side effect, and it is reversible by a later ruling.

### What does NOT change

The Web Viewer's console title was deliberately left unchanged by the initial ruling (it labels an operational console, not the public first screen). A follow-up within the same positioning decision aligned it: `apps/web` `home.title` is now “Governed Agent Harness Console” / “受治理 Agent Harness 控制台”, so the viewer and the README name the same boundary.

- The safety contract: read-only-first, never overwrite user files, `executesAnything: false` in
  Loop Contracts, no target/agent/workflow scheduling, no external writes, no self-approval.
- The expert-surface clause: the advanced capability remains opt-in and untyped; the default
  seven-verb surface is unchanged.
- Trusted Continuation as the coding-domain outcome and Repository Maintainers as primary users.
- The Charter's Own/Integrate/Exclude split, including every entry F079 kept forbidden.

## Amendment (0046, 2026-09-15): 定位上抬与词汇修订

**Status:** Accepted (positioning ruling by the user, 2026-09-15; appended 2026-09-16 by the D0
contract-consolidation packet of `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4`)
**Cites:** [issue 0046](../../issues/0046-positioning-vocabulary-revision.md) (ruling),
`docs/specs/trusted-control-governance-contract.md` §4 (canonical text)

This amendment **amends, and does not supersede**, the 2026-09-04 decision above. Trusted
Continuation remains the coding-domain core product outcome; the positioning lifts one level.

### Positioning

Amber Protocol is the **trusted control boundary between an agent and the real system**:

> Amber Protocol is the trusted control boundary between an agent and the real system —
> governing what an agent may see, use, execute, and emit, with whose approval, and what
> evidence proves it — so governed work resumes across sessions, agents, and people without
> reconstructing state from chat history.
>
> Amber Protocol 是 Agent 与真实系统之间的可信控制边界：治理 Agent 能看什么、能用什么、在哪
> 执行、能产生什么副作用、谁批准、发生了什么、结果是否可信，使受治工作能跨会话/Agent/人接续，
> 无需从聊天记录重建状态。

The target environment stays the Coding-Agent-Enabled Repository (one implementation domain of
the boundary, not the whole of it). Repository Maintainers remain the primary users; operator,
researcher, and platform-team readers are secondary audiences for vocabulary coverage only —
**no new default product promise** follows from this lift (the expert-surface clause above is
unchanged).

### Vocabulary rulings

| Term | Ruling |
| --- | --- |
| Actor | reads as the existing **Principal**; no rename |
| Intent (action-level) | reads as the existing **runner request** vocabulary (`requestHash`, capability, Stage Verb, Bounded Host Action, Execution Boundary, Runtime Operation); the governance artifact **Intent** (→ Spec → Plan) keeps its name; no new "Capability Request" term |
| Provenance levels | map onto the existing **Assurance** levels without renaming; ATTESTED is a reserved enum value (never recordable until signing/TEE infrastructure exists) |
| Harness | enters the vocabulary as an **architecture role name** — the layer responsibility realized by Amber Core plus its governed adapters; not a product component, not the installer (`Amber Setup`), not a framework/platform |

The seven layers E/T/C/L/O/V/G correspond one-to-one with the seven Control Layers
(Governance-highest preserved); the four planes (Control/Execution/Evidence/Verification) are an
orthogonal grouping of those layers, not a replacement.

### Verb principle

Generic primitives first, domain commands second: the public Core API exposes a small closed
set of generic primitive verbs; domain commands are declarative compositions admitted through
governed seams. The F063 seven-verb default surface (`audit, init, doctor, next, plan, handoff,
session`) is the CLI projection of the primitives and **is not expanded** by this amendment.

### Boundary preservation

This amendment grants no sandbox, no runtime interception, no automatic agent dispatch, and no
scheduled execution. Unmediated host-agent actions remain a declared blind spot of the boundary
(see the ADR-0001 amendment and the context-runtime contract). Upstream v3.1/SHE architecture
documents contribute ideas only; their vocabulary does not enter product text (ADR-0008 §4
provenance boundary).
