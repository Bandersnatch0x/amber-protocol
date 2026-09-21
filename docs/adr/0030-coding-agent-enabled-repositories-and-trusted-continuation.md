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
