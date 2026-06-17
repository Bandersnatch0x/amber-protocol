---
type: agent
title: Amber
description: How agents use the Amber setup in this repository.
tags: [agent]
updated: 2026-06-17
---

# Amber

The Amber Protocol setup keeps agent work bounded and recoverable.

## V1 Scope

- Init
- Audit
- Wiki
- Doctor
- Handoff
- Continuous-improvement state templates
- Static workflow packet templates

## V1 Non-Goals

- Dynamic workflow execution
- Subagent dispatch
- Worktree orchestration
- Model/backend routing
- Automatic rewrite of existing project documents

## Continuous Improvement

The Amber setup can describe and track a continuous-improvement loop without executing it autonomously.

- Use `.workflow/continuous-improvement/state.json` for queue, approval gates, and result notes.
- Use [Continuous improvement](continuous-improvement.md) for the operating loop.
- Use [Workflow packets](workflow-packets.md) when research, implementation, and review need separation.
- Stop at approval gates before destructive, external, expensive, broad, or security-sensitive work.
