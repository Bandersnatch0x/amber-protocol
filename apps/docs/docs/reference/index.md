---
id: index
title: "Reference & Operator Index"
sidebar_label: "Overview & Operator Index"
description: "Comprehensive index of all Amber CLI commands, schemas, and action contracts."
slug: /reference
---

# Reference & Operator Index

This section provides authoritative reference documentation for experienced developers and operators looking for exact syntax, schemas, and contracts without walking the tutorial pages.

---

## Operator Fast-Lookup Index

| Task / Goal | Primary Command | Read/Write Nature |
| --- | --- | --- |
| **Inspect repository readiness** | [`amber audit --target .`](/reference/cli/audit) | `read-only` |
| **Verify setup and guardrails** | [`amber doctor --target .`](/reference/cli/doctor) | `read-only` |
| **Scaffold missing Amber files** | [`amber init --target .`](/reference/cli/init) | `idempotent-write` |
| **Start a tracked session** | [`amber session start --goal "..."`](/reference/cli/session) | `governed-write` |
| **Inspect active session status** | [`amber session status`](/reference/cli/session) | `read-only` |
| **Request deterministic next advice** | [`amber next --target .`](/reference/cli/next) | `read-only` |
| **Run CI drift gate** | [`amber drift --target .`](/reference/cli/drift) | `read-only` |
| **Evaluate a gate contract** | [`amber gate evaluate --target .`](/reference/cli/gate) | `governed-write` |
| **Record evidence receipt** | [`amber evidence record --target .`](/reference/cli/evidence) | `governed-write` |
| **Generate session handoff bundle** | [`amber handoff bundle --target .`](/reference/cli/handoff) | `idempotent-write` |
| **Validate handoff bundle** | [`amber handoff validate --target .`](/reference/cli/handoff) | `read-only` |
| **Evaluate policy contracts** | [`amber policy evaluate --target .`](/reference/cli/policy) | `governed-write` |
| **Register detector / control band** | [`amber maintain register-detector --target .`](/reference/cli/maintain) | `governed-write` |
| **Evaluate retention policies** | [`amber retention evaluate --target .`](/reference/cli/retention) | `read-only` |
| **Inspect external effect contracts** | [`amber external effects --target .`](/reference/cli/external) | `read-only` |
| **Manage breakglass emergency grants** | [`amber breakglass grants --target .`](/reference/cli/breakglass) | `read-only` |

---

## Reference Sections

- [**CLI Command Reference (54 Commands)**](/reference/cli) — Full, single-source reference generated from `scripts/lib/command-registry.js`.
- [**Declarative JSON Schemas**](/reference/schemas) — Machine-readable contracts for sessions, timelines, routes, manifests, and action types.
- [**Action Types & MCP Integration**](/reference/action-types) — Operational ontology actions and safe read-only tool boundaries.
