# Declarative Loop Contract Design

Date: 2026-06-09
Status: approved for documentation update

## Context

The loop-engineering articles describe a shift from prompting agents one turn at a time to designing systems that discover work, call skills, isolate execution, verify results, record state, and decide whether to continue. They also warn that production loops fail when they lack hard stops, verification, replayability, and human review bandwidth.

Coding Harness should absorb this as a declarative artifact model, not as a live autonomous runner. A Harness loop contract can describe how a loop should work and how it should be reviewed. It must not schedule itself, dispatch live workers, write to external systems, or apply fixes without approval.

## Adopted Design

### Loop Contract

A loop contract is a dry-run-safe declaration of a repeated agent workflow. It describes:

- Trigger and cadence: manual, scheduled, goal-based, or external-signal-based.
- Goal and stop conditions: success checks, maximum iterations, timeout, no-progress detection, and token or dollar budget.
- Inputs: source bundles, traces, issue queues, CI results, recent commits, or other declared sources.
- Skills and standards: reusable skills, rule packs, and review criteria used by the loop.
- Connectors: declared MCP or external integrations, with permissions, redaction, and approval gates.
- State spine: the markdown, JSON, board, or `.harness` artifact that records what happened and what is next.
- Triage output: archive/no-op, candidate task, needs-human, blocked, or regression-test proposal.

### Trace-To-Regression Loop

Agent observability should not stop at traces. A failure record should be able to become a reviewable regression proposal:

Trace -> diagnosis -> proposed fix -> human approval -> exact replay -> regression assertion -> maintenance/evolution record.

The Harness should preserve original inputs, relevant configuration, evidence, and proposed plain-English assertions. It should not treat an LLM judge as sufficient proof by itself.

### Review Bandwidth

The limiting resource in loop orchestration is not the number of workers that can run. It is the amount of trustworthy review a human or reviewer agent can actually absorb. Loop contracts should declare concurrency limits and review gates before any future execution layer can rely on them.

## Non-Goals

- Do not add a scheduler, cron runner, or live loop daemon.
- Do not open PRs, write issue-tracker updates, or send Slack messages from core Harness commands.
- Do not apply code fixes from traces automatically.
- Do not make LLM-as-judge assertions the only acceptance evidence.
- Do not promote connector declarations into external calls during validation.

## Documentation Impact

- `SPEC.md`: introduce loop contracts, state spines, hard stops, and trace-to-regression proposals.
- `ROADMAP.md`: place loop contracts in V3/V4/V4.5/V5.5 as declarative, replayable, reviewable artifacts.
- `README.md`: explain loop contracts as dry-run design records rather than live autonomous execution.
