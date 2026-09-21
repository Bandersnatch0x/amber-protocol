---
id: route
title: "Routes & Governance Pipelines"
sidebar_label: "Routes"
description: "Predefined and custom delivery routes, stage sequences, and gate points."
---

# Routes & Governance Pipelines

A **Route** defines a deterministic sequence of stages, required artifacts, verification commands, and human gate points that a session must satisfy.

## Standard Built-in Routes

Amber includes standard route configurations in `routes/*.route.json`:

| Route ID | Typical Use Case | Required Stages |
| --- | --- | --- |
| `bugfix-quick` | Fast regression and defect fixes | Reproduce → Fix → Verify |
| `feature-standard` | Standard vertical slice feature work | Plan → Review → Implement → Test → Accept |
| `refactor-safe` | Code restructuring with zero behavior change | Baseline Tests → Refactor → Parity Check |

## Route Auto-Matching

When starting a session with `amber session start --goal "..."`, Amber automatically pattern-matches the goal against route regex triggers:
- `^(fix|resolve|patch|repair)\s+.*(bug|defect|issue|error|crash)` → `bugfix-quick`
- `^(add|implement|create|build)\s+.*feature` → `feature-standard`
- `^(refactor|restructure|clean\s*up|simplify|extract)\b` → `refactor-safe`

You can also explicitly specify a route with `--route <route-id>`.

## Route Inspection

```bash
# List all available routes
amber route list

# Inspect a specific route's stage pipeline
amber route inspect feature-standard
```
