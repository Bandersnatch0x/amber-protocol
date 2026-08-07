---
type: agent
title: Amber
description: How agents use the Amber setup in this repository.
tags: [agent]
updated: 2026-08-07
---

# Amber Operating Manual

The Amber Protocol setup keeps agent work bounded and recoverable.

## Operating Boundary

- Amber governs repository-local artifacts, gates, evidence, and handoff state.
- Amber does not dispatch agents, schedule work, or run project commands automatically.
- Read or dry-run before mutation. Never overwrite project-authored files without approval.

## Standard Lifecycle

`audit -> init -> governance report -> next -> plan -> gate -> verify -> approve -> handoff bundle -> handoff validate`

- Treat every Gate as a real stop condition.
- Record the command, result, date, and remaining risk before claiming completion.
- Keep stable knowledge in the wiki and current state in Feature State, Progress, and handoff artifacts.

## Context Loadouts

- A Loadout must include this Operating Manual, its selected Route manifest, and the [Loadout Definition](context-loadout.md).
- Run `amber context verify --loadout <file>` immediately before loading it.
- Missing, changed, or non-local required artifacts block the Loadout.
- Context Pages supplement the required artifacts; they do not replace them.

## Handoff

A handoff must let another person continue without chat history: goal, work completed, Feature State, verification evidence, blockers, next action, and recovery instructions.

## Continuous Improvement

The Amber setup can describe and track a continuous-improvement loop without executing it autonomously.

- Use `.workflow/continuous-improvement/state.json` for queue, approval gates, and result notes.
- Use [Continuous improvement](continuous-improvement.md) for the operating loop.
- Use [Workflow packets](workflow-packets.md) when research, implementation, and review need separation.
- Stop at approval gates before destructive, external, expensive, broad, or security-sensitive work.
